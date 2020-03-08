import PitchShift = require('soundbank-pitch-shift');

/* tslint:disable:unified-signatures */

type PlayStatePlaying = {
  state: 'playing';
  source: AudioBufferSourceNode;
  suppressEndedEvent: boolean;
  /**
   * Millisecond timestamp (based on the AudioContext clock) that the song
   * started playing at the current playback rate
   */
  effectiveStartTimeMillis: number;
};

type PlayState =
  {
    state: 'paused';
    positionMillis: number;
  } | PlayStatePlaying;

type Listener = EventListener | EventListenerObject | null;

type ErrorListener = (err: ErrorEvent) => void;

type EventTypes =
    'canplay'
  | 'canplaythrough'
  | 'ended'
  | 'error'
  | 'loadeddata'
  | 'play'
  | 'pause'
  | 'ratechange'
  | 'seeked'
  | 'timeupdate'
  | 'volumechange';

type TrackSource = {
  type: 'src';
  src: string;
} | {
  type: 'file';
  file: File | Blob;
}

type Track = {
  source: TrackSource;
  /**
   * Set once successfully loaded
   */
  data?: {
    buffer: AudioBuffer;
    state: PlayState;
  }
};

/**
 * An event triggered by a
 * {@link @synesthesia-project/precise-audio.PreciseAudio} object.
 */
export class PreciseAudioEvent extends Event {

  private readonly _target: PreciseAudio;

  public constructor(eventType: EventTypes, target: PreciseAudio) {
    super(eventType);
    this._target = target;
  }

  /**
   * @inheritdoc
   */
  public get target() {
    return this._target;
  }

  /**
   * @inheritdoc
   */
  public get currentTarget() {
    return this._target;
  }
}

/**
 * An audio player that can seek and provide timestamps with millisecond
 * accuracy.
 *
 * In contrast to the `<audio>` tag, this class will load an entire track
 * into memory as a raw waveform, as otherwise, with most codecs,
 * it's impossible to seek to accurate locations in songs.
 *
 * **ExampleUsage:**
 *
 * ```ts
 * import PreciseAudio from '@synesthesia-project/precise-audio';
 *
 * const audio = new PreciseAudio();
 * audio.loadAudioFile(...);
 * ```
 *
 * Motivation, more usage instructions, and other details can be found
 * [in the project GitHub repository](https://github.com/synesthesia-project/synesthesia/tree/master/precise-audio)
 */
export default class PreciseAudio extends EventTarget {

  private readonly context: AudioContext;
  private readonly gainNode: GainNode;
  private _animationFrameRequest: null | number = null;
  private _playbackRate = 1;
  private _adjustPitchWithPlaybackRate = true;
  private readonly _volume = {
    volume: 1,
    muted: false
  };
  private track: Track | null = null;

  public constructor() {
    super();
    this.context = new AudioContext();
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);
  }

  private updateGain() {
    this.gainNode.gain.value = this._volume.muted ? 0 : this._volume.volume;
  }

  private async loadFile(track: Track, file: File | Blob) {
    const fileBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => {
        resolve(ev.target?.result as ArrayBuffer);
      };
      reader.onerror = () => {
        reader.abort();
        reject(reader.error);
      };
      reader.readAsArrayBuffer(file);
    });
    const buffer = await this.context.decodeAudioData(fileBuffer);
    if (track === this.track) {
      track.data = {
        buffer,
        state: {
          state: 'paused', positionMillis: 0
        }
      };
      this.sendEvent('loadeddata');
      this.sendEvent('canplay');
      this.sendEvent('canplaythrough');
      this.sendEvent('timeupdate');
    }
  }

  private sendEvent(eventType: EventTypes) {
    const event = new PreciseAudioEvent(eventType, this);
    this.dispatchEvent(event);
  }

  private dispatchError(error: Error) {
    const event = new ErrorEvent('error', {
      error
    });
    this.dispatchEvent(event);
  }

  private stopWithoutEnding(state: PlayStatePlaying) {
    state.suppressEndedEvent = true;
    state.source.stop();
  }

  /**
   * Used with requestAnimationFrame to dispatch timeupdate events
   */
  private timeUpdated = () => {
    this.sendEvent('timeupdate');
    if (this.track?.data?.state.state === 'playing') {
      this.scheduleTimeUpdated();
    }
  }

  private scheduleTimeUpdated() {
    if (this._animationFrameRequest !== null)
      cancelAnimationFrame(this._animationFrameRequest);
    this._animationFrameRequest = requestAnimationFrame(this.timeUpdated);
  }

  /**
   * Create a listener that should get called when the currently playing track
   * has ended
   *
   * @param track - the track that should be playing
   */
  private createTrackEndedListener(state: PlayStatePlaying) {
    return () => {
      if (this.track?.data?.state !== state) return;
      if (state.state === 'playing' && !state.suppressEndedEvent) {
        this.sendEvent('ended');
        this.track.data.state = {
          state: 'paused',
          positionMillis: 0
        }
      }
    }
  }

  /**
   * Read and load a new audio file.
   *
   * The loaded audio file will be paused once it's loaded,
   * and will not play automatically.
   *
   * @param file A [File](https://developer.mozilla.org/en-US/docs/Web/API/File)
   *             or [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
   *             object representing the audio file to be played.
   * @returns A [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
   *          that resolves once the audio file has been successfully loaded.
   */
  public async loadAudioFile(file: File | Blob) {
    if (this.track?.data?.state.state === 'playing') {
      this.stopWithoutEnding(this.track.data.state);
    }
    const track: Track = this.track = {
      source: {
        type: 'file', file
      }
    }
    await this.loadFile(track, file).catch(e => {
      this.dispatchError(e);
      throw e;
    });
  }

  /**
   * @returns a double indicating the audio volume,
   * from 0.0 (silent) to 1.0 (loudest).
   */
  public get volume() {
    return this._volume.volume;
  }

  public set volume(volume: number) {
    const v = Math.max(0, Math.min(1, volume));
    if (v !== this._volume.volume) {
      this._volume.volume = v;
      this.updateGain();
      this.sendEvent('volumechange');
    }
  }

  /**
   * @returns A Boolean that determines whether audio is muted.
   * `true` if the audio is muted and `false` otherwise.
   */
  public get muted() {
    return this._volume.muted;
  }

  public set muted(muted: boolean) {
    if (muted !== this._volume.muted) {
      this._volume.muted = muted;
      this.updateGain();
      this.sendEvent('volumechange');
    }
  }

  /**
   * @returns the URL of the track to play
   */
  public get src(): string {
    return this.track?.source.type === 'src' && this.track.source.src || '';
  }

  public set src(src: string) {
    if (this.track?.data?.state.state === 'playing') {
      this.stopWithoutEnding(this.track.data.state);
    }
    if (src === '') {
      this.track = null;
      return;
    }
    const track: Track = this.track = {
      source: {
        type: 'src', src
      }
    }
    fetch(src).then(async r => {
      const blob = await r.blob();
      await this.loadFile(track, blob);
    }).catch(e => {
      this.dispatchError(e);
    });
  }

  private playFrom(positionMillis: number) {
    if (this.track?.data) {
      const nowMillis = this.context.currentTime * 1000;
      const source = this.context.createBufferSource();
      source.playbackRate.value = this._playbackRate;
      if (this._playbackRate !== 1 && this._adjustPitchWithPlaybackRate) {
        const pitchShift = PitchShift(this.context);
        pitchShift.connect(this.gainNode);
        // Calculate the notes (in 100 cents) to shift the pitch by
        // based on the frequency ration
        pitchShift.transpose = 12 * Math.log2(1 / this._playbackRate);
        source.connect(pitchShift);
      } else {
        source.connect(this.gainNode);
      }
      source.buffer = this.track.data.buffer;
      source.start(0, positionMillis / 1000);
      this.track.data.state = {
        state: 'playing',
        suppressEndedEvent: false,
        source,
        effectiveStartTimeMillis:
          nowMillis - positionMillis / this._playbackRate
      };
      source.addEventListener('ended',
        this.createTrackEndedListener(this.track.data.state));
      this.scheduleTimeUpdated();
    }
  }

  /**
   * Begins playback of the audio.
   */
  public play() {
    if (this.context.state === 'suspended')
      this.context.resume();
    if (this.track?.data && this.track.data.state.state === 'paused') {
      this.playFrom(this.track.data.state.positionMillis);
      this.sendEvent('play');
    }
  }

  /**
   * Pauses the audio playback.
   */
  public pause() {
    if (this.context.state === 'suspended')
      this.context.resume();
    if (this.track?.data?.state?.state === 'playing') {
      const nowMillis = this.context.currentTime * 1000;
      this.stopWithoutEnding(this.track.data.state);
      this.track.data.state = {
        state: 'paused',
        positionMillis:
          (nowMillis - this.track.data.state.effectiveStartTimeMillis) *
          this._playbackRate
      };
      this.sendEvent('pause');
    }
  }

  /**
   * @returns a boolean that indicates whether the audio element is paused.
   */
  public get paused() {
    return this.track?.data?.state.state !== 'playing';
  }

  /**
   * Similar to
   * {@link @synesthesia-project/precise-audio.PreciseAudio.currentTime},
   * but returns the time in milliseconds rather than seconds.
   *
   * @returns The current playback time in milliseconds
   */
  public get currentTimeMillis() {
    if (this.track?.data) {
      if (this.track.data.state.state === 'paused') {
        return this.track.data.state.positionMillis;
      } else {
        const nowMillis = this.context.currentTime * 1000;
        return (nowMillis - this.track.data.state.effectiveStartTimeMillis) *
          this._playbackRate;
      }
    }
    return 0;
  }

  /**
   * The current playback time in seconds
   *
   * If the media is not yet playing,
   * the value of `currentTime` indicates the time position within the track
   * at which playback will begin once the
   * {@link @synesthesia-project/precise-audio.PreciseAudio.play}
   * method is called.
   *
   * @returns The current playback time in seconds
   */
  public get currentTime() {
    return this.currentTimeMillis / 1000;
  }

  public set currentTime(positionSeconds: number) {
    if (this.track?.data) {
      const positionMillis = positionSeconds * 1000;
      if (this.track.data.state.state === 'paused') {
        this.track.data.state.positionMillis = positionMillis;
        this.sendEvent('timeupdate');
      } else {
        this.stopWithoutEnding(this.track.data.state);
        this.playFrom(positionMillis);
      }
      this.sendEvent('seeked');
    }
  }

  /*
   * Pause playback if neccesary,
   * make some adjustments to the configuration,
   * and then resume (if previously playing).
   *
   * This should be used when making a change to how you initialize the
   * web audio pipeline (e.g. changing the pitch).
   */
  private changeConfiguration(callback: () => void) {
    let resume = false;
    if (this.track?.data?.state.state === 'playing') {
      this.pause();
      resume = true;
    }
    callback();
    if (resume) {
      this.play();
    }
  }

  public set adjustPitchWithPlaybackRate(adjust: boolean) {
    this.changeConfiguration(() => {
      this._adjustPitchWithPlaybackRate = adjust;
    });
  }

  /**
   * Should this class attempt to adjust the pitch of the audio when changing
   * playback rate to compensate.
   *
   * This is the usual behaviour for `HTMLAudioElement`
   *
   * @default true
   *
   */
  public get adjustPitchWithPlaybackRate() {
    return this._adjustPitchWithPlaybackRate;
  }

  public set playbackRate(playbackRate: number) {
    this.changeConfiguration(() => {
      this._playbackRate = playbackRate;
    });
    this.sendEvent('ratechange');
  }

  /**
   * @returns a number indicating the rate at which the media is being played back.
   */
  public get playbackRate() {
    return this._playbackRate;
  }

  /**
   * @returns The length of the currently loaded audio track in seconds
   */
  public get duration() {
    if (this.track?.data) {
      return this.track.data.buffer.duration;
    }
    return 0;
  }

  /**
   * @returns The length of the currently loaded audio track in milliseconds
   */
  public get durationMillis() {
    return this.duration * 1000;
  }

  /**
   * Sets the ID of the audio device to use for output and returns a `Promise`.
   * This only works when the application is authorized to use
   * the specified device.
   *
   * *Note: this is currently not implemented in PreciseAudio*
   *
   * @param sinkId The
   * [`MediaDeviceInfo.deviceId`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDeviceInfo/deviceId)
   * of the audio output device.
   */
  public async setSinkId(sinkId: string) {
    throw new Error('Not implemented: ' + sinkId);
  }

  /**
   * Fired when the user agent can play the media, and estimates that enough
   * data has been loaded to play the media up to its end without having to stop
   * for further buffering of content.
   *
   * Note: in contrast to `HTMLAudioElement`, `PreciseAudio` will always fire
   * this event at the same time as `canplaythrough` and `loadeddata`,
   * as all tracks are always fully preloaded.
   *
   * @param listener an [EventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventListener)
   *                 that expects a {@link @synesthesia-project/precise-audio.PreciseAudioEvent}
   *                 as a parameter
   */
  public addEventListener(event: 'canplay', listener: Listener): void;

  /**
   * Fired when the user agent can play the media, and estimates that enough
   * data has been loaded to play the media up to its end without having to stop
   * for further buffering of content.
   *
   * Note: in contrast to `HTMLAudioElement`, `PreciseAudio` will always fire
   * this event at the same time as `canplay` and `loadeddata`,
   * as all tracks are always fully preloaded.
   *
   * @param listener an [EventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventListener)
   *                 that expects a {@link @synesthesia-project/precise-audio.PreciseAudioEvent}
   *                 as a parameter
   */
  public addEventListener(event: 'canplaythrough', listener: Listener): void;

  /**
   * Fired when playback stops when end of the track is reached
   *
   * @param listener an [EventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventListener)
   *                 that expects a {@link @synesthesia-project/precise-audio.PreciseAudioEvent}
   *                 as a parameter
   */
  public addEventListener(event: 'ended', listener: Listener): void;

  /**
   * Fired when the track could not be loaded due to an error.
   *
   * @param listener an [EventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventListener)
   *                 that expects a {@link @synesthesia-project/precise-audio.PreciseAudioEvent}
   *                 as a parameter
   */
  public addEventListener(event: 'error', listener: ErrorListener): void;

  /**
   * Fired when the first frame of the media has finished loading.
   *
   * Note: in contrast to `HTMLAudioElement`, `PreciseAudio` will always fire
   * this event at the same time as `canplay` and `canplaythrough`,
   * as all tracks are always fully preloaded.
   *
   * @param listener an [EventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventListener)
   *                 that expects a {@link @synesthesia-project/precise-audio.PreciseAudioEvent}
   *                 as a parameter
   */
  public addEventListener(event: 'loadeddata', listener: Listener): void;

  /**
   * Fired when the audio starts playing
   *
   * @param listener an [EventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventListener)
   *                 that expects a {@link @synesthesia-project/precise-audio.PreciseAudioEvent}
   *                 as a parameter
   */
  public addEventListener(event: 'play', listener: Listener): void;

  /**
   * Fired when the audio is paused
   *
   * (Notably not fired when the audio is stopped
   * when a new file is being loaded)
   *
   * @param listener an [EventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventListener)
   *                 that expects a {@link @synesthesia-project/precise-audio.PreciseAudioEvent}
   *                 as a parameter
   */
  public addEventListener(event: 'pause', listener: Listener): void;

  /**
   * Fired when a seek operation completes
   *
   * @param listener an [EventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventListener)
   *                 that expects a {@link @synesthesia-project/precise-audio.PreciseAudioEvent}
   *                 as a parameter
   */
  public addEventListener(event: 'seeked', listener: Listener): void;

  /**
   * Fired when the time indicated by the currentTime attribute has been updated
   *
   * Note: this happens continuously, so instead this class will just call this
   * at the framerate of the browser using requestAnimationFrame.
   *
   * @param listener an [EventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventListener)
   *                 that expects a {@link @synesthesia-project/precise-audio.PreciseAudioEvent}
   *                 as a parameter
   */
  public addEventListener(event: 'timeupdate', listener: Listener): void;

  /**
   * Fired when the volume has changed.
   *
   * @param listener an [EventListener](https://developer.mozilla.org/en-US/docs/Web/API/EventListener)
   *                 that expects a {@link @synesthesia-project/precise-audio.PreciseAudioEvent}
   *                 as a parameter
   */
  public addEventListener(event: 'volumechange', listener: Listener): void;

  public addEventListener(event: EventTypes, listener: Listener | ErrorListener) {
    super.addEventListener(event, listener as any);
  }

  public removeEventListener(event: EventTypes, listener: Listener | ErrorListener) {
    super.removeEventListener(event, listener as any);
  }

}
