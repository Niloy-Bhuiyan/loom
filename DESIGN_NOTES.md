# Design notes

Why Loom is built the way it is. Decisions are listed with the reasoning and
the alternatives that were considered, so they're easy to revisit.

## Constraints

- **No server, ever.** The build output is plain static files. Every model runs
  in the browser tab; the network is used only to download model weights once.
- **No API keys.** Nothing is key-gated or paid.
- **Each stage swappable.** STT, LLM and TTS sit behind the interfaces in
  [`src/pipeline/types.ts`](src/pipeline/types.ts). The conversation logic
  ([`src/agent/conversation.ts`](src/agent/conversation.ts)) only sees those
  interfaces.

## Runtime: Transformers.js v4 on WebGPU

- Package: [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers) **4.3.0**
  (the maintained successor of `@xenova/transformers`).
- All three models run with `device: 'webgpu'`, each in its **own Web Worker**
  so inference never blocks the UI thread and each stage can be torn down
  independently.
- **Caching** uses Transformers.js's built-in Cache API storage
  (`transformers-cache`). It also caches the ONNX Runtime WASM binaries
  (`env.useWasmCache`, on by default), so the runtime itself works offline
  after the first visit. Loom additionally caches Supertonic's voice-style
  vectors in its own `loom-voices` cache because they are fetched outside the
  model loader.
- Every worker runs one tiny **warm-up inference** right after loading. The
  first WebGPU run compiles shaders and can take several seconds; doing it
  during the loading screen keeps the first real reply snappy.
- A single message protocol ([`src/workers/protocol.ts`](src/workers/protocol.ts))
  is shared by all workers: `load` / `run` / `interrupt` in, `progress` /
  `phase` / `ready` / `partial` / `result` / `error` out.

## Speech-to-text: Whisper

- **Default:** `onnx-community/whisper-base.en` (~210 MB).
- **Also offered:** `whisper-tiny.en` (~120 MB, fastest) and `whisper-small.en`
  (~590 MB, most accurate).
- **dtypes:** encoder `fp32`, merged decoder `q4` — the combination used by the
  official Transformers.js Whisper WebGPU demo. The fp16 encoder is smaller, but
  fp16 Whisper encoders have a history of numerical problems on some GPUs, so
  the proven setting wins.
- English-only (`.en`) checkpoints are more accurate than the multilingual ones
  at the same size for English speech. For other languages, switch to e.g.
  `onnx-community/whisper-base` in [`src/config/models.ts`](src/config/models.ts).
- Whisper hallucinates on silence ("Thank you.", "you", `[BLANK_AUDIO]`), so
  quiet/short recordings are dropped before transcription and those artefacts
  are filtered afterwards.
- Mic audio is captured at the device's native sample rate via an inline
  AudioWorklet and resampled to 16 kHz with `OfflineAudioContext`. (Creating a
  16 kHz `AudioContext` directly fails in some browsers when connected to a mic.)

## Language model: Qwen2.5 1.5B Instruct

**Chosen model ID: `onnx-community/Qwen2.5-1.5B-Instruct`, dtype `q4f16`
(~1.2 GB), falling back to `q4` (~1.8 GB) on GPUs without `shader-f16`.**

Why:

- **Size:** 1.5B parameters is in the requested ~1–3B range and fits in about
  2 GB of GPU memory at 4-bit, which most discrete GPUs and recent integrated
  GPUs (Apple M-series, Intel Xe/Arc, AMD RDNA) have available.
- **Known to work:** the `onnx-community` export ships `q4f16` weights as a
  single ONNX file built for Transformers.js WebGPU, and Qwen2.5 is a supported
  architecture.
- **Quality for conversation:** Qwen2.5-1.5B-Instruct is one of the strongest
  instruction followers at its size, which matters when every reply is spoken
  and must obey "one to three sentences, no markdown".
- **License:** Apache 2.0.
- **Light fallback:** `onnx-community/Qwen2.5-0.5B-Instruct` (~500 MB) is offered
  in settings and suggested automatically after an out-of-memory failure.

Alternatives considered:

| Model | Why not the default |
| --- | --- |
| `onnx-community/Llama-3.2-1B-Instruct-q4f16` | Same download (~1.2 GB) as Qwen2.5-1.5B with fewer parameters; ships only f16 weights, so it can't run on GPUs without `shader-f16`. |
| `HuggingFaceTB/SmolLM2-1.7B-Instruct` | A solid, WebGPU-proven alternative (it powers the official SmolLM WebGPU demo). Qwen2.5 was preferred for its instruction following and broader knowledge; SmolLM2 is a one-line preset away. |
| `onnx-community/Qwen3-1.7B-ONNX` | Defaults to a "thinking" mode that adds latency before speech starts; not worth it for a voice demo. |
| Phi-3.5-mini (3.8B) | ~2.2 GB+ download and memory, too heavy for integrated GPUs. |

Generation: sampling with `temperature 0.7`, `top_p 0.9`, max 256 new tokens,
history trimmed to the last 12 messages. An `InterruptableStoppingCriteria`
lets the user cut the model off by speaking (barge-in).

The system prompt ([`src/agent/prompt.ts`](src/agent/prompt.ts)) asks for short,
plain spoken sentences, and tells the model it runs locally with no internet.

## Text-to-speech: Supertonic (neural) with a Web Speech fallback

**Default actually used: Supertonic TTS** (`onnx-community/Supertonic-TTS-ONNX`,
~265 MB fp32, 44.1 kHz, 10 voice styles), run through Transformers.js's
`text-to-speech` pipeline on WebGPU.

Why Supertonic:

- It's supported **natively** by Transformers.js v4, so it shares the same
  runtime, cache and worker protocol as the other two stages — no extra
  dependency.
- It's fast (a handful of denoising steps per sentence) and sounds far more
  natural than MMS/VITS or SpeechT5.
- It's genuinely local, which the browser's built-in voices are not always.

Why not **Kokoro** (`kokoro-js`)? Kokoro is excellent, but `kokoro-js` 1.2.x
depends on Transformers.js **v3**; using it would bundle two copies of the
runtime and ONNX Runtime. Supertonic avoids that.

**Fallback: Web Speech `SpeechSynthesis`.** Selectable in settings, and used
automatically if Supertonic fails to load (e.g. out of GPU memory). Important
caveat: some browsers' voices are cloud-backed (for example Chrome's
"Google …" voices send text to Google). Loom only ever picks voices with
`localService === true`, and if none exist it falls back to text-only replies
rather than silently leaking text.

To swap engines, implement `TextToSpeech` and add a branch in
[`src/tts/index.ts`](src/tts/index.ts).

### Latency: speak while generating

LLM tokens are streamed into a sentence chunker
([`src/core/sentences.ts`](src/core/sentences.ts)). As soon as a sentence is
complete it is cleaned of markdown/emoji and handed to TTS, while the model is
still writing the next one. Synthesized sentences are played back-to-back by a
gapless PCM player.

### Broken 16-bit GPU math: a self-test

Found while testing on an Intel UHD (Gen-9) integrated GPU: the adapter
advertises `shader-f16`, but with `q4f16` weights Qwen2.5 produced fluent
nonsense ("Octopuses / Fun Fact About Octopuses / Talk About Talk About…"),
while the **same model with `q4` weights** answered correctly ("The capital of
France is Paris."). The chat template was verified to be applied, so it's the
GPU's f16 arithmetic, not the prompt.

Because a GPU can claim f16 support and still compute it wrongly, Loom doesn't
trust the feature flag alone:

1. The LLM warm-up asks *"What is 2 + 2? Reply with just the number."* with
   greedy decoding.
2. If f16 weights were used and the answer doesn't contain "4", the worker
   reports a self-test failure.
3. The client tears the worker down, reloads the model with 32-bit (`q4`)
   weights, and saves `f16: false` in settings so the next visit goes straight
   to the working weights. The user sees a one-line notice.

Settings also has a manual **"Use 16-bit GPU math"** switch.

## Graceful degradation

- **No WebGPU / no adapter / insecure context** → a friendly screen explaining
  what's needed and which browsers work, instead of a crash.
- **`shader-f16` missing** → automatically use `q4` instead of `q4f16` weights.
- **`shader-f16` present but broken** → caught by the warm-up self-test (above)
  and switched to `q4` automatically.
- **Model load failures** are classified ([`src/core/errors.ts`](src/core/errors.ts))
  into out-of-memory, network, storage, GPU and microphone errors, each with a
  plain-language explanation. Memory-type failures offer a one-click switch to
  the light model (Qwen2.5-0.5B + Whisper tiny).
- **Voice fails** → built-in on-device voice → text only.

## Offline

- Models + ONNX Runtime WASM: Cache API via Transformers.js.
- Voice styles: `loom-voices` Cache API bucket.
- App shell: a small hand-written service worker (`public/sw.js`), production
  builds only. Network-first for the page (so deploys show up), cache-first for
  hashed assets.
- `navigator.storage.persist()` is requested after the first successful load so
  the browser is less likely to evict ~1.7 GB of models under storage pressure.

## Things deliberately left out

- **Multi-threaded WASM.** Needs cross-origin isolation (COOP/COEP headers),
  which GitHub Pages can't set. Everything runs on WebGPU anyway, so this only
  affects small CPU-side ops.
- **Voice activity detection / always-listening.** Push-to-talk is predictable,
  private (the mic is released after every turn) and avoids Loom hearing itself.
- **A CPU (WASM) fallback for the LLM.** It works technically, but at a few
  tokens per second it makes for a poor voice experience; a clear message is
  better than a frustrating demo.
