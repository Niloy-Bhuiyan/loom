import type { ProgressListener, TextToSpeech } from '../pipeline/types';

/**
 * Fallback voice using the browser's built-in SpeechSynthesis.
 *
 * Caveat: some browsers route certain voices through a cloud service
 * (e.g. Chrome's "Google …" voices). We only pick voices that report
 * `localService: true`, and refuse to load if there are none, so this
 * engine never sends your text off the device.
 */
export class WebSpeechTTS implements TextToSpeech {
  private voice: SpeechSynthesisVoice | null = null;
  private pending = 0;
  private idleWaiters: (() => void)[] = [];

  static isAvailable(): boolean {
    return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  async load(onProgress: ProgressListener): Promise<void> {
    onProgress({ fraction: 1, loadedBytes: 0, totalBytes: 0, phase: 'Using built-in voice' });
    if (!WebSpeechTTS.isAvailable()) throw new Error('SpeechSynthesis is not supported in this browser');
    this.voice = pickLocalVoice(await getVoices());
    if (!this.voice) throw new Error('No on-device SpeechSynthesis voice is installed');
  }

  get voiceName(): string {
    return this.voice?.name ?? '';
  }

  speak(text: string): void {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = this.voice;
    utterance.rate = 1.05;
    this.pending++;
    const done = () => {
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) this.notifyIdle();
    };
    utterance.onend = done;
    utterance.onerror = done;
    speechSynthesis.speak(utterance);
  }

  stop(): void {
    speechSynthesis.cancel();
    this.pending = 0;
    this.notifyIdle();
  }

  drain(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  dispose(): void {
    this.stop();
  }

  private notifyIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

/** Voices often load asynchronously; wait briefly for them. */
function getVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = speechSynthesis.getVoices();
  if (voices.length) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const finish = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, 1500);
  });
}

/** Prefer an on-device English voice, then any on-device voice. */
export function pickLocalVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const local = voices.filter((v) => v.localService);
  const english = local.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return english.find((v) => v.default) ?? english[0] ?? local[0] ?? null;
}
