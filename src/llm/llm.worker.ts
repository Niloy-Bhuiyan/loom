import {
  InterruptableStoppingCriteria,
  pipeline,
  TextStreamer,
  type TextGenerationPipeline,
} from '@huggingface/transformers';
import type { ModelProgressEvent } from '../core/progress';
import { reportCacheStatus } from '../workers/cache-status';
import { serveWorker } from '../workers/host';
import { SELF_TEST_FAILED, type LlmConfig, type LlmRequest, type LlmResult } from './protocol';

let generator: TextGenerationPipeline | null = null;
const stopping = new InterruptableStoppingCriteria();

serveWorker<LlmConfig, LlmRequest, LlmResult, string>({
  async load({ model, dtype, selfTest }, ctx) {
    await reportCacheStatus('text-generation', model, { dtype: dtype as never, device: 'webgpu' }, ctx);
    generator = (await pipeline('text-generation', model, {
      device: 'webgpu',
      dtype: dtype as never,
      progress_callback: (info) => ctx.progress(info as ModelProgressEvent),
    })) as TextGenerationPipeline;

    // The warm-up doubles as a sanity check: some GPU/driver combos advertise
    // shader-f16 but compute garbage with it, which shows up as nonsense replies.
    ctx.phase('Warming up GPU');
    const [output] = (await generator([{ role: 'user', content: 'What is 2 + 2? Reply with just the number.' }], {
      max_new_tokens: 6,
      do_sample: false,
    })) as { generated_text: { content: string }[] }[];
    const answer = output?.generated_text.at(-1)?.content ?? '';
    if (selfTest && !/\b4\b|four/i.test(answer)) {
      await generator.dispose();
      generator = null;
      throw new Error(`${SELF_TEST_FAILED}: ${JSON.stringify(answer)}`);
    }
    return 'webgpu';
  },

  async run({ messages, maxNewTokens }, ctx) {
    if (!generator) throw new Error('Language model is not loaded');
    stopping.reset();

    let reply = '';
    let tokens = 0;
    let firstTokenAt = 0;
    const started = performance.now();
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        reply += text;
        ctx.partial(text);
      },
      token_callback_function: () => {
        tokens++;
        firstTokenAt ||= performance.now();
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
    const ended = performance.now();
    return {
      result: {
        text: reply.trim(),
        stats: { tokens, firstTokenMs: (firstTokenAt || ended) - started, totalMs: ended - started },
      },
    };
  },

  interrupt() {
    stopping.interrupt();
  },
});
