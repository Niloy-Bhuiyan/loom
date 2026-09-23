import { concatChunks, resample } from './pcm';

/** Copies raw microphone samples to the main thread. Inlined so no extra file needs serving. */
const CAPTURE_WORKLET = `
class LoomCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('loom-capture', LoomCapture);
`;

/**
 * Records the microphone as raw PCM and exposes an analyser for the live
 * waveform. The mic is released after every turn so the browser's recording
 * indicator is only on while you are actually talking.
 */
export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  analyser: AnalyserNode | null = null;

  get recording(): boolean {
    return this.stream !== null;
  }

  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    // Record at the device's native rate and resample later: some browsers refuse
    // to connect a mic stream to a context running at a different rate.
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
    }
    await this.ctx.resume();

    this.chunks = [];
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.node = new AudioWorkletNode(this.ctx, 'loom-capture');
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.chunks.push(e.data);
    source.connect(this.analyser);
    source.connect(this.node);
  }

  /** Stop recording; resolves with 16 kHz mono audio ready for Whisper. */
  async stop(): Promise<Float32Array> {
    if (!this.stream || !this.ctx) return new Float32Array();
    this.node?.port.close();
    this.node?.disconnect();
    this.analyser?.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
    this.node = null;
    this.analyser = null;
    return resample(concatChunks(this.chunks), this.ctx.sampleRate);
  }
}
