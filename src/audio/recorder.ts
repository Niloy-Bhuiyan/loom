import { concatChunks, resample } from './pcm';

/**
 * Copies raw microphone samples out of the audio thread. Inlined so no extra
 * file needs serving. By default chunks go to the main thread; if given a
 * `sink` port (hands-free mode) they are batched and streamed there instead.
 */
const CAPTURE_WORKLET = `
class LoomCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sink = null;
    this.batch = new Float32Array(2048);
    this.filled = 0;
    this.port.onmessage = (e) => { if (e.data && e.data.sink) this.sink = e.data.sink; };
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    if (!this.sink) {
      this.port.postMessage(channel.slice(0));
      return true;
    }
    if (this.filled + channel.length > this.batch.length) {
      this.sink.postMessage(this.batch.slice(0, this.filled));
      this.filled = 0;
    }
    this.batch.set(channel, this.filled);
    this.filled += channel.length;
    return true;
  }
}
registerProcessor('loom-capture', LoomCapture);
`;

/**
 * Records the microphone as raw PCM and exposes an analyser for the live
 * waveform. In push-to-talk mode the mic is released after every turn, so the
 * browser's recording indicator is only on while you are actually talking.
 */
export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  analyser: AnalyserNode | null = null;

  /** The mic's native sample rate (valid after start()). */
  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48_000;
  }

  /**
   * Open the mic. With a `sink` port, audio is streamed to it continuously
   * (hands-free); otherwise it's buffered until stop().
   */
  async start(sink?: MessagePort): Promise<void> {
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
    if (sink) this.node.port.postMessage({ sink }, [sink]);
    else this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.chunks.push(e.data);
    // Chain everything to the destination so the browser keeps pulling audio through it.
    // The worklet never writes its output, so nothing is audible.
    source.connect(this.analyser);
    this.analyser.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  /** Stop recording; resolves with 16 kHz mono audio ready for Whisper (empty when streaming). */
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
