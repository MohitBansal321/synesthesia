import {CueFile, CueFileLayer, CueFileEvent, CueFileEventState, AnyLayer} from '../shared/file/file';
import * as selection from './selection';
import * as util from '../shared/util/util';

function convertLayer<L, K, V>(l: CueFileLayer<L, K, V>, f: (l: CueFileLayer<L, K, V>) => CueFileLayer<L, K, V>): AnyLayer {
  return f(l as any as CueFileLayer<L, K, V>) as any as AnyLayer;
}

/*
 * Build up a data structure for quick lookup of selected events
 * layer -> {set of event ids}
 */
function buildUpSelectionSet(selection: selection.Selection) {
  const selectedEvents = new Map<number, Set<number>>();
  for (const e of selection.events) {
    let layerSet = selectedEvents.get(e.layer);
    if (!layerSet)
      selectedEvents.set(e.layer, layerSet = new Set<number>());
    layerSet.add(e.index);
  }
  return selectedEvents;
}

function modifyEvents(
    cueFile: CueFile,
    selection: selection.Selection,
    f: {f<K, S, V>(e: CueFileEvent<V>, layer: CueFileLayer<K, S, V>): CueFileEvent<V>}): CueFile {
  const selectedEvents = buildUpSelectionSet(selection);

  function doConvertLayer<K, S, V>(
      selectedEvents: Set<number>,
      layer: CueFileLayer<K, S, V>): CueFileLayer<K, S, V> {
    return {
      kind: layer.kind,
      settings: layer.settings,
      events: layer.events.map((e, i) => {
        if (selectedEvents.has(i)) {
          return f.f(e, layer);
        } else {
          return e;
        }
      })
    };
  }

  const newLayers = cueFile.layers.map((layer, i) => {
    const layerSet = selectedEvents.get(i);
    if (!layerSet)
      // Layer unchanged
      return layer;
    return convertLayer(layer, l => doConvertLayer(layerSet, l));
  });

  return util.deepFreeze({
    lengthMillis: cueFile.lengthMillis,
    layers: newLayers
  });
}

export function updateStartTimeForSelectedEvents(
    cueFile: CueFile,
    selection: selection.Selection,
    newStartTime: number): CueFile {

  // Ignore empty selections
  if (selection.events.length === 0)
    return cueFile;

  function events() {
    return selection.events.map(e => cueFile.layers[e.layer].events[e.index]);
  }

  // Get the current earliest start time for any event of the selection
  const start = Math.min.apply(null, events().map(e => e.timestampMillis));

  // Make sure the start time is no less than 0
  newStartTime = Math.max(0, newStartTime);

  // Don't change the file if the start time hasn't changed
  if (start === newStartTime)
    return cueFile;

  const shift = newStartTime - start;
  // Don't change the file if shifting less than 0.1 ms
  if (shift < 0.1 && shift > 0.1)
    return cueFile;

  function shiftEvent<V>(e: CueFileEvent<V>): CueFileEvent<V> {
    return {
      timestampMillis: e.timestampMillis + shift,
      states: e.states
    };
  }

  return modifyEvents(cueFile, selection, {f: shiftEvent});
}

export function updateDurationForSelectedEvents(
    cueFile: CueFile,
    selection: selection.Selection,
    newDuration: number): CueFile {

  // Ignore empty selections
  if (selection.events.length === 0)
    return cueFile;

  function setEventDuration<K, S, V>(e: CueFileEvent<V>, layer: CueFileLayer<K, S, V>): CueFileEvent<V> {
    const states = e.states.length > 0 ? e.states : defaultEventStates(layer);
    const currentDuration = Math.max.apply(null, states.map(s => s.millisDelta));
    const stretch = newDuration / currentDuration;
    return {
      timestampMillis: e.timestampMillis,
      states: states.map(s => ({
        // TODO: ensure that s.millisDelta * (newDuration / currentDuration) === newDuration
        // for the maximum s.millisDelta (i.e. s.millisDelta === currentDuration)
        millisDelta: Math.round(s.millisDelta * stretch),
        values: s.values
      }))
    };
  }

  return modifyEvents(cueFile, selection, {f: setEventDuration});
}

export function deleteSelectedEvents(
    cueFile: CueFile,
    selection: selection.Selection): CueFile {

  // Ignore empty selections
  if (selection.events.length === 0)
    return cueFile;

  const selectedEvents = buildUpSelectionSet(selection);

  const newLayers = cueFile.layers.map((layer, i) => {
    const layerSet = selectedEvents.get(i);
    if (!layerSet)
      // Layer unchanged
      return layer;
    return convertLayer(layer, l => ({
      kind: layer.kind,
      settings: layer.settings,
      events: layer.events.filter((e, i) => !layerSet.has(i))
    }));
  });

  return util.deepFreeze({
    lengthMillis: cueFile.lengthMillis,
    layers: newLayers
  });
}


export function setLength(file: CueFile, lengthMillis: number): CueFile {
  return util.deepFreeze({
    lengthMillis,
    layers: file.layers
  });
}

export function addLayer(file: CueFile): CueFile {
  const layers = file.layers.slice();
  layers.push({
    kind: 'percussion',
    settings: {defaultLengthMillis: 200},
    events: []
  });
  return util.deepFreeze({
    lengthMillis: file.lengthMillis,
    layers
  });
}

function defaultEventStates<K, S, V>(layer: CueFileLayer<K, S, V>): CueFileEventState<V>[] {
  // Type HACK
  const l = layer as any as AnyLayer;
  if (l.kind === 'percussion') {
    return [
      {millisDelta: 0, values: {amplitude: 1} as any as V},
      {millisDelta: l.settings.defaultLengthMillis, values: {amplitude: 0} as any as V}
    ];
  } else {
    throw new Error('no default states for layer kind ' + l.kind);
  }
}

export function addLayerItem(file: CueFile, layer: number, timestampMillis: number): CueFile {
  return util.deepFreeze({
    lengthMillis: file.lengthMillis,
    layers: file.layers.map((l, i) => {
      if (i !== layer)
        return l;
      // Add item
      const events = l.events.slice();
      events.push({
        timestampMillis,
        states: []
      });
      return {
        kind: l.kind as any,
        settings: l.settings,
        events
      };
    })
  });
}
