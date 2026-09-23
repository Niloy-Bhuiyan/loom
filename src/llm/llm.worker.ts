import {
  InterruptableStoppingCriteria,
  pipeline,
  TextStreamer,
  type TextGenerationPipeline,
} from '@huggingface/transformers';
import type { ModelProgressEvent } from '../core/progress';
import type { ChatMessage } from '../pipeline/types';
import { reportCacheStatus } from '../workers/cache-status';
import { serveWorker } from '../workers/host';

export interface LlmConfig {
  model: string;
  dtype: string;
}

export interface LlmRequest {
  messages: ChatMessage[];
  maxNewTokens: number;
}

let generator: TextGenerationPipeline | null = null;
const stopping = new InterruptableStoppingCriteria();

serveWorker<LlmConfig, LlmRequest, string, string>({
  async load({ model, dtype }, ctx) {
    await reportCacheStatus('text-generation', model, { dtype: dtype as never, device: 'webgpu' }, ctx);
    generator = (await pipeline('text-generation', model, {
      device: 'webgpu',
      dtype: dtype as never,
      progress_callback: (info) => ctx.progress(info as ModelProgressEvent),
    })) as TextGenerationPipeline;

    ctx.phase('Warming up GPU');
    await generator([{ role: 'user', content: 'Hi' }], { max_new_tokens: 1 });
    return 'webgpu';
  },

  async run({ messages, maxNewTokens }, ctx) {
    if (!generator) throw new Error('Language model is not loaded');
    stopping.reset();

    let reply = '';
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        reply += text;
        ctx.partial(text);
      },
    });

    await generator(messages, {
      max_new_tokens: maxNewTokens,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      streamer,
      stopping_criteria: stopping,
    });
    return { result: reply.trim() };
  },

  interrupt() {
    stopping.interrupt();
  },
});
