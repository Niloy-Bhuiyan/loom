# Loom

> **Talk to an AI with your wifi off — 100% local, in your browser.**

Loom is a voice assistant that runs entirely inside a browser tab. Your speech is
transcribed, answered and spoken back by three AI models running on **your own
GPU via WebGPU**. There is no backend, no API key, and nothing you say ever
leaves your device. Once the models are cached you can switch on airplane mode
and keep talking.

<!-- TODO: record and embed a demo GIF here showing wifi being turned off mid-conversation -->

- 🎙️ **Speech in** — Whisper (speech-to-text) on WebGPU
- 🧠 **Local reasoning** — Qwen2.5 1.5B Instruct on WebGPU
- 🔊 **Speech out** — Supertonic neural text-to-speech on WebGPU
- ✈️ **Offline after first load** — models, runtime and app shell are all cached
- 🧩 **Swappable stages** — each model sits behind a small TypeScript interface

## Quickstart

Requires Node.js 20.19+ (or 22.12+) and a [WebGPU-capable browser](#hardware--browser-requirements).

```bash
npm install && npm run dev
```

Open the printed `http://localhost:5173` URL, click **Download & start**, and
wait for the one-time model download (≈1.7 GB with the defaults, ≈0.9 GB with
the light models). Then hold the mic button (or hold <kbd>Space</kbd>) and talk.

### The Airplane Mode Test

1. Load Loom once while online so the models are cached.
2. Turn off wifi / enable airplane mode.
3. Keep talking. The badge in the corner switches to **Offline · still working**
   — and so does Loom.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check and build the static site into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the unit tests (Vitest) |
| `npm run typecheck` | TypeScript strict-mode check only |

## How it works

```
                        ┌───────────────────── your browser tab ─────────────────────┐
                        │                                                            │
 🎙 mic ─▶ AudioWorklet ─▶ 16 kHz PCM ─▶ [STT worker]  Whisper base.en   (WebGPU)     │
                        │                     │ text                                 │
                        │                     ▼                                      │
                        │               [LLM worker]  Qwen2.5-1.5B-Instruct (WebGPU) │
                        │                     │ streamed tokens                      │
                        │                     ▼                                      │
                        │             sentence chunker ─▶ [TTS worker] Supertonic    │
                        │                                     │ 44.1 kHz PCM         │
 🔊 speakers ◀──────────────────────────── gapless player ◀────┘                      │
                        └────────────────────────────────────────────────────────────┘
                                         ▲
               network is used only once │ to download model weights from huggingface.co
```

1. **Capture.** While you hold the button, an inline `AudioWorklet` records raw
   PCM from the microphone. On release, audio is resampled to 16 kHz. Silent or
   very short clips are skipped (Whisper hallucinates on silence).
2. **Speech-to-text.** The clip is sent to a Web Worker running Whisper through
   [Transformers.js](https://github.com/huggingface/transformers.js) on WebGPU.
3. **Reasoning.** The transcript plus recent history goes to a second worker
   running Qwen2.5-1.5B-Instruct. Tokens stream back as they're generated and
   appear live in the transcript.
4. **Text-to-speech.** Streamed text is cut into sentences. Each finished
   sentence is cleaned of markdown/emoji and synthesized by Supertonic in a third
   worker, *while the LLM is still writing the next sentence*, then played back
   gaplessly. That overlap is what makes it feel conversational.
5. **Barge-in.** Start talking while Loom is thinking or speaking and it stops
   immediately (the LLM is interrupted and queued audio is dropped).

### Why it's all local

- Inference happens in Web Workers using WebGPU compute shaders on your GPU.
  There is no inference server — the site is plain static files.
- The only network requests are the **one-time downloads** of model weights
  from the Hugging Face Hub (and ONNX Runtime's WASM from the jsDelivr CDN).
  Transformers.js stores them in the browser's Cache API; after that, loading is
  from disk.
- A small service worker caches the app itself, so the page reloads offline too.
- The optional Web Speech fallback voice only uses voices that report
  `localService: true`, so it can't quietly send your text to a cloud TTS.

### Project layout

```
src/
  pipeline/types.ts      SpeechToText, LanguageModel, TextToSpeech interfaces
  agent/                 Conversation orchestration + prompt
  stt/                   Whisper worker + client
  llm/                   Text-generation worker + client
  tts/                   Supertonic worker + client, Web Speech fallback, factory
  audio/                 Mic capture, resampling, PCM playback
  workers/               Shared worker message protocol
  core/                  Capability detection, errors, progress, caching, text utils
  ui/                    Layout, transcript, waveform, loader, dialogs, settings
  config/                Model presets and persisted settings
```

## Models (and how to swap them)

| Stage | Default | Size (download) | Alternatives in settings |
| --- | --- | --- | --- |
| Speech-to-text | `onnx-community/whisper-base.en` | ~210 MB | `whisper-tiny.en` (~120 MB), `whisper-small.en` (~590 MB) |
| Language model | `onnx-community/Qwen2.5-1.5B-Instruct` (q4f16) | ~1.2 GB | `Qwen2.5-0.5B-Instruct` (~500 MB) |
| Text-to-speech | `onnx-community/Supertonic-TTS-ONNX` | ~265 MB | Built-in browser voice (on-device voices only) |

The **text-to-speech engine actually used by default is Supertonic**, a neural
TTS model running locally through Transformers.js. The browser's Web Speech
`SpeechSynthesis` is a documented fallback: you can select it in settings, and
Loom switches to it automatically if Supertonic can't load. See
[DESIGN_NOTES.md](DESIGN_NOTES.md) for the reasoning behind every choice.

**Use a larger Whisper for accuracy:** open the settings (⚙) and choose
*Whisper Small*, or add any Transformers.js-compatible Whisper checkpoint to
`STT_PRESETS` in [`src/config/models.ts`](src/config/models.ts), e.g.:

```ts
{
  id: 'whisper-large-v3-turbo',
  label: 'Whisper Large v3 Turbo (multilingual)',
  model: 'onnx-community/whisper-large-v3-turbo',
  approxMB: 1100,
  dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
},
```

**Swap the LLM:** add an entry to `LLM_PRESETS` with any ONNX text-generation
model that Transformers.js supports on WebGPU (look for `q4f16` weights).

**Swap a whole stage:** implement the matching interface from
[`src/pipeline/types.ts`](src/pipeline/types.ts) and construct it in
[`src/app.ts`](src/app.ts) (or [`src/tts/index.ts`](src/tts/index.ts) for voices).
Nothing else needs to change.

## Hardware & browser requirements

Loom needs **WebGPU**:

| Browser | Status |
| --- | --- |
| Chrome / Edge 113+ | ✅ Windows, macOS, ChromeOS |
| Chrome 121+ on Android | ✅ recent devices |
| Safari 26+ | ✅ macOS, iOS, iPadOS |
| Firefox 141+ | ✅ Windows; other platforms rolling out |
| Chrome on Linux | ⚠️ may need `chrome://flags/#enable-unsafe-webgpu` |

If WebGPU isn't available, Loom shows a friendly explanation instead of loading.

**GPU memory (VRAM) — rough guide:**

| Setup | Download | GPU memory |
| --- | --- | --- |
| Default (Whisper base + Qwen2.5 1.5B + Supertonic) | ~1.7 GB | ~2.5–3 GB |
| Light (Whisper tiny + Qwen2.5 0.5B + Supertonic) | ~0.9 GB | ~1.5 GB |

- Integrated GPUs (Intel Xe/Arc, AMD, Apple M-series) share system RAM; 8 GB
  of system memory is a comfortable minimum, 16 GB is better.
- GPUs **with** the `shader-f16` feature use smaller `q4f16` weights. Without
  it Loom automatically uses `q4` weights (larger, ~1.8 GB for the default LLM).
- If a model runs out of memory, Loom says so and offers the light models.
- First load includes compiling GPU shaders, which can take 10–60 seconds on
  slower machines. Later loads come from cache and are much faster.
- The microphone and WebGPU only work on **secure origins** (`https://` or
  `http://localhost`).

### Troubleshooting

| Symptom | What's going on / what to do |
| --- | --- |
| "This browser doesn't support WebGPU" | Use one of the browsers above, enable hardware acceleration, update GPU drivers. |
| "Your GPU ran out of memory" | Click **Use the light model**, or close other GPU-heavy tabs/apps. |
| Replies are fluent nonsense | Some GPUs report 16-bit float support but compute it wrongly. Loom self-tests for this and switches to 32-bit weights automatically; you can also untick **Use 16-bit GPU math** in settings. |
| Models download again on every visit | The browser isn't letting Loom keep ~1–2 GB in its cache (low disk space, strict storage limits, private/incognito window). Free up space or use a normal window. |
| First start takes a minute even when cached | That's shader compilation on the GPU during warm-up; it's normal on integrated GPUs. |
| Neural voice fails to load | Loom falls back to an on-device system voice (or text-only if none is installed). |

## Deploying (GitHub Pages)

The build is fully static (`dist/`), so it can be hosted anywhere. A GitHub
Actions workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml))
runs the tests, builds the site and deploys it to GitHub Pages on every push to
`main`.

**One manual step is required** (it needs repository-owner permissions):

1. Open the repository on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Re-run the latest *Deploy to GitHub Pages* workflow (Actions tab → the
   workflow → **Re-run all jobs**), or push any commit to `main`.

The site will then be live at `https://<your-username>.github.io/loom/`.

> Note: GitHub Pages for **private** repositories requires a paid GitHub plan
> (Pro, Team or Enterprise). On a free plan, make the repository public first
> (Settings → General → Danger Zone → Change visibility).

## External services

No API keys or paid services are used. The only network hosts contacted, and
only to download files once:

| Host | What | Key needed |
| --- | --- | --- |
| `huggingface.co` (+ its CDN) | Model weights, tokenizers, voice styles | No |
| `cdn.jsdelivr.net` | ONNX Runtime WebAssembly glue used by Transformers.js | No |

Everything is then served from the browser cache. No fonts, analytics or
trackers are loaded.

## Privacy

- Audio never leaves the tab: it's captured, transcribed and discarded locally.
- The microphone is released after every turn, so the browser's recording
  indicator is only on while you're talking.
- Conversation history lives in memory only and is gone when you close the tab.
- Settings are stored in `localStorage`; model files in the Cache API. Use
  **Settings → Clear downloaded models** to remove them.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Niloy Bhuiyan

Model licenses are set by their authors: Whisper (MIT), Qwen2.5 (Apache 2.0),
Supertonic (see its model card on Hugging Face).
