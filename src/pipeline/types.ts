/**
 * The three swappable stages of Loom's voice pipeline.
 *
 *   microphone ─▶ SpeechToText ─▶ LanguageModel ─▶ TextToSpeech ─▶ speakers
 *
 * Each stage is an interface so an implementation can be replaced
 * (a different Whisper size, another LLM, Web Speech instead of a neural
 * voice…) without touching the conversation logic or the UI.
 */

/** Progress for one stage while its model downloads / initializes. */
export interface LoadProgress {
  /** 0..1 fraction of bytes fetched, or null when the total is unknown. */
  fraction: number | null;
  loadedBytes: number;
  totalBytes: number;
  /** Human-readable phase, e.g. "Downloading", "Warming up GPU". */
  phase: string;
}

export type ProgressListener = (progress: LoadProgress) => void;

export interface LoadableStage {
  /** Download (or read from cache) and initialize the model. */
  load(onProgress: ProgressListener): Promise<void>;
  /** Free workers / GPU memory. */
  dispose(): void;
}

export interface SpeechToText extends LoadableStage {
  /** Transcribe mono PCM audio sampled at 16 kHz. Aborting skips the work if it hasn't started. */
  transcribe(audio: Float32Array, signal?: AbortSignal): Promise<string>;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LanguageModel extends LoadableStage {
  /**
   * Generate a reply, calling `onToken` with each new piece of text.
   * Resolves with the full reply (possibly partial if interrupted).
   */
  generate(messages: ChatMessage[], onToken: (text: string) => void): Promise<string>;
  /** Stop the in-flight generation as soon as possible. */
  interrupt(): void;
}

export interface TextToSpeech extends LoadableStage {
  /** Queue a chunk of text (typically one sentence) to be spoken. */
  speak(text: string): void;
  /** Stop speaking and drop anything still queued. */
  stop(): void;
  /** Resolves once everything queued so far has finished playing. */
  drain(): Promise<void>;
  /** Optional live level of the output audio, 0..1, for visualisation. */
  level?(): number;
}
