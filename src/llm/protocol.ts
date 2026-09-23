import type { ChatMessage } from '../pipeline/types';

// Shared between the LLM worker and its main-thread client. Kept separate so the
// main thread never imports the worker module (and with it Transformers.js).

export interface LlmConfig {
  model: string;
  dtype: string;
  /** Verify the model produces sane output (catches GPUs with broken 16-bit math). */
  selfTest: boolean;
}

export interface LlmRequest {
  messages: ChatMessage[];
  maxNewTokens: number;
}

/** Thrown by the worker's load() when the self-test fails; the client falls back to 32-bit weights. */
export const SELF_TEST_FAILED = 'LOOM_LLM_SELF_TEST_FAILED';
