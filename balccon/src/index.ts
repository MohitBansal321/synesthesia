import { DownstreamEndpoint } from '@synesthesia-project/core/lib/protocols/broadcast';
import { PlayStateData } from '@synesthesia-project/core/lib/protocols/broadcast/messages';
import { CueFile } from '@synesthesia-project/core/lib/file';
import * as usage from '@synesthesia-project/core/lib/file/file-usage';
import { DEFAULT_SYNESTHESIA_PORT } from '@synesthesia-project/core/lib/constants';

import { LocalCommunicationsConsumer } from '@synesthesia-project/core/lib/local';

import { RGBAColor, Compositor, PixelInfo } from '@synesthesia-project/compositor';
import { SynesthesiaPlayState } from '@synesthesia-project/compositor/lib/modules';
import FillModule from '@synesthesia-project/compositor/lib/modules/fill';
import AddModule from '@synesthesia-project/compositor/lib/modules/add';
import ScanModule from '@synesthesia-project/compositor/lib/modules/scan';
import SynesthesiaModulateModule from '@synesthesia-project/compositor/lib/modules/modulate';

import * as fs from 'fs';
import * as WebSocket from 'ws';

const LEDS = 90;

export class Display {

  private state: {
    playState: PlayStateData;
    files: Map<string, CueFile>;
  } = {
      playState: { layers: [] },
      files: new Map()
    };

  private buffer: Buffer;
  private compositor: Compositor<number, { synesthesia: SynesthesiaPlayState }>;
  private stream: fs.WriteStream;

  public constructor() {
    this.frame = this.frame.bind(this);

    this.buffer = Buffer.alloc(LEDS * 3);
    const pixels: PixelInfo<number>[] = [];

    for (let i = 0; i < LEDS; i++) {
      pixels[i] = {
        x: i,
        y: 0,
        data: i
      };
    }


    this.compositor = new Compositor<number, { synesthesia: SynesthesiaPlayState }>(
      {
        root: new SynesthesiaModulateModule(
          new AddModule([
            new FillModule(new RGBAColor(96, 0, 160, 1)),
            new ScanModule(new RGBAColor(160, 0, 104, 1), { delay: 0, speed: -0.1 }),
            new ScanModule(new RGBAColor(160, 0, 104, 1), { speed: 0.5 }),
            new ScanModule(new RGBAColor(160, 0, 104, 1), { delay: 0, speed: 0.2 }),
            new ScanModule(new RGBAColor(247, 69, 185, 1), { delay: 0, speed: -0.3 }),
            new ScanModule(new RGBAColor(247, 69, 185, 1), { delay: 1, speed: 0.3 })
          ])
        ),
        pixels
      },
      { synesthesia: this.state }
    );

    this.stream = fs.createWriteStream('/tmp/leds');

    const local = new LocalCommunicationsConsumer();

    local.on('new-server', port => {
      console.log(`New server started on port ${port}`);
      const endpoint = this.connectToServer(port);
      endpoint
        .then(() => console.log(`Connected to server on port: ${port}`))
        .catch(err => console.error(`Could not connect to server on port: ${port}`));
    });

    const endpoint = this.connectToServer(DEFAULT_SYNESTHESIA_PORT);
    endpoint.catch(err => console.error(`Could not connect to server on port: ${DEFAULT_SYNESTHESIA_PORT}`));
  }

  private connectToServer(port: number): Promise<DownstreamEndpoint> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/listen`);
      ws.addEventListener('open', () => {
        const endpoint = new DownstreamEndpoint(
          msg => ws.send(JSON.stringify(msg)),
          async playState => {
            console.log('play state!', playState);
            if (playState) {
              const nextFiles = new Map<string, CueFile>();
              await Promise.all(playState.layers.map(async l => {
                const existing = this.state.files.get(l.fileHash);
                if (existing) {
                  nextFiles.set(l.fileHash, existing);
                } else {
                  return endpoint.getFile(l.fileHash).then(f => { nextFiles.set(l.fileHash, usage.prepareFile(f)); });
                }
              }));
              this.state = { playState, files: nextFiles };

              this.compositor.updateState({ synesthesia: this.state });
            }
          }
        );
        ws.addEventListener('message', msg => {
          console.log('message', msg);
          endpoint.recvMessage(JSON.parse(msg.data));
        });
        resolve(endpoint);
      });
      ws.addEventListener('error', err => {
        reject(err);
      });
      ws.addEventListener('close', err => {
        // TODO
      });
    });
  }

  public async start() {
    setInterval(this.frame, 20);
  }

  private frame() {

    const frame = this.compositor.renderFrame();
    for (const p of frame) {
      const i = p.pixel.data * 3;
      this.buffer[i] = p.output.r;
      this.buffer[i + 1] = p.output.g;
      this.buffer[i + 2] = p.output.b;
    }

    this.stream.write(this.buffer);
  }
}

const display = new Display();
display.start();
