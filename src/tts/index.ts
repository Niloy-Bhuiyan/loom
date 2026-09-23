import type { Settings } from '../config/settings';
import type { ProgressListener, TextToSpeech } from '../pipeline/types';
import { SupertonicTTS } from './supertonic';
import { WebSpeechTTS } from './web-speech';

export { SupertonicTTS, WebSpeechTTS };

/** Pick the TTS engine from settings. Swap engines here. */
export function createTts(settings: Settings): TextToSpeech {
  return settings.tts === 'supertonic' ? new SupertonicTTS(settings.voice) : new WebSpeechTTS();
}

/** Last resort when no voice can load: replies are still shown in the transcript. */
export class SilentTTS implements TextToSpeech {
  async load(onProgress: ProgressListener): Promise<void> {
    onProgress({ fraction: 1, loadedBytes: 0, totalBytes: 0, phase: 'Text only' });
  }
  speak(): void {}
  stop(): void {}
  async drain(): Promise<void> {}
  dispose(): void {}
}

export function describeTts(tts: TextToSpeech): string {
  if (tts instanceof SupertonicTTS) return `Supertonic neural voice (${tts.voice})`;
  if (tts instanceof WebSpeechTTS) return `Built-in voice${tts.voiceName ? ` (${tts.voiceName})` : ''}`;
  return 'None (text only)';
}
