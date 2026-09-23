import type { LlmPreset } from '../config/models';
import type { ChatMessage, LanguageModel, ProgressListener } from '../pipeline/types';
import { WorkerClient } from '../workers/client';
import { SELF_TEST_FAILED, type LlmConfig, type LlmRequest } from './protocol';

/** Spoken replies should be short; this also bounds latency on slow GPUs. */
const MAX_NEW_TOKENS = 256;

function createClient() {
  return new WorkerClient<LlmConfig, LlmRequest, string, string>(
    new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module', name: 'loom-llm' }),
  );
}

/** A small instruction-tuned LLM via Transformers.js on WebGPU, in its own worker. */
export class TransformersLLM implements LanguageModel {
  private client = createClient();

  /**
   * @param useF16 whether 16-bit GPU math may be used (shader-f16 present and not known-broken)
   * @param onF16Broken called if the 16-bit weights fail the self-test and 32-bit ones are used instead
   */
  constructor(
    private preset: LlmPreset,
    private useF16: boolean,
    private onF16Broken?: () => void,
  ) {}

  async load(onProgress: ProgressListener): Promise<void> {
    const dtype = pickDtype(this.preset, this.useF16);
    const fallback = dtype === this.preset.dtypeF16 ? this.preset.dtypeF32 : null;
    try {
      await this.client.load({ model: this.preset.model, dtype, selfTest: fallback !== null }, onProgress);
    } catch (err) {
      if (!fallback || !String(err).includes(SELF_TEST_FAILED)) throw err;
      console.warn('[loom] 16-bit weights produced garbage on this GPU; switching to 32-bit', err);
      this.onF16Broken?.();
      // A fresh worker guarantees the broken session's GPU memory is released.
      this.client.terminate();
      this.client = createClient();
      await this.client.load({ model: this.preset.model, dtype: fallback, selfTest: false }, onProgress);
    }
  }

  generate(messages: ChatMessage[], onToken: (text: string) => void): Promise<string> {
    return this.client.run({ messages, maxNewTokens: MAX_NEW_TOKENS }, onToken);
  }

  interrupt(): void {
    this.client.interrupt();
  }

  dispose(): void {
    this.client.terminate();
  }
}

/** q4f16 weights need the `shader-f16` GPU feature; fall back to q4 when it's missing. */
export function pickDtype(preset: LlmPreset, useF16: boolean): string {
  if (useF16) return preset.dtypeF16;
  if (preset.dtypeF32) return preset.dtypeF32;
  throw new Error(`${preset.label} needs a GPU with working 16-bit float (shader-f16) support`);
}
