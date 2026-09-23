import type { LlmPreset } from '../config/models';
import type { ChatMessage, LanguageModel, ProgressListener } from '../pipeline/types';
import { WorkerClient } from '../workers/client';
import type { LlmConfig, LlmRequest } from './llm.worker';

/** Spoken replies should be short; this also bounds latency on slow GPUs. */
const MAX_NEW_TOKENS = 256;

/** A small instruction-tuned LLM via Transformers.js on WebGPU, in its own worker. */
export class TransformersLLM implements LanguageModel {
  private client = new WorkerClient<LlmConfig, LlmRequest, string, string>(
    new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module', name: 'loom-llm' }),
  );

  constructor(
    private preset: LlmPreset,
    private shaderF16: boolean,
  ) {}

  async load(onProgress: ProgressListener): Promise<void> {
    const dtype = pickDtype(this.preset, this.shaderF16);
    await this.client.load({ model: this.preset.model, dtype }, onProgress);
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
export function pickDtype(preset: LlmPreset, shaderF16: boolean): string {
  if (shaderF16) return preset.dtypeF16;
  if (preset.dtypeF32) return preset.dtypeF32;
  throw new Error(`${preset.label} needs a GPU with 16-bit float (shader-f16) support`);
}
