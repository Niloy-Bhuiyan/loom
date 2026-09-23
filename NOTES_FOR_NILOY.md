# Notes for Niloy

Things worth knowing that aren't obvious from the code.

## Nothing is mocked, nothing is paid

- **No API keys, no paid services, no mocked components.** All three stages run
  real models locally.
- External hosts contacted (downloads only, no keys):
  - `huggingface.co` — model weights, tokenizers, Supertonic voice styles.
  - `cdn.jsdelivr.net` — ONNX Runtime's WebAssembly glue, fetched by
    Transformers.js by default and then cached in the browser.

## One manual step: enable GitHub Pages

The workflow `.github/workflows/deploy.yml` builds and deploys on every push to
`main`, but Pages has to be switched on once:

**Repo → Settings → Pages → Build and deployment → Source: GitHub Actions**,
then re-run the latest "Deploy to GitHub Pages" workflow.

⚠️ The repo was created **private** as requested. GitHub Pages on private repos
needs a paid plan (Pro/Team/Enterprise). On the free plan the deploy job will
fail until you either upgrade or make the repo public. The build/test job still
runs either way.

## Git identity

Commits are authored as `Niloy-bhuiyan` with your GitHub **noreply** address
(`145592285+Niloy-Bhuiyan@users.noreply.github.com`), because GitHub rejected
the push with the plain email due to your "Block command line pushes that
expose my email" privacy setting.

## Model choices at a glance

See `DESIGN_NOTES.md` for the full reasoning.

- STT: `onnx-community/whisper-base.en` (tiny / small selectable)
- LLM: `onnx-community/Qwen2.5-1.5B-Instruct`, `q4f16` (0.5B light option)
- TTS: `onnx-community/Supertonic-TTS-ONNX` (neural, default) with an
  on-device-only Web Speech fallback

No model had to be substituted: all of the above were verified to exist with
the expected ONNX files on the Hugging Face Hub at build time.

## What was verified during the build

Tested in a Chromium-based browser on Windows with an **Intel UHD (Gen-9)
integrated GPU**, using the light models (Whisper tiny + Qwen2.5-0.5B +
Supertonic):

- Model download progress, GPU warm-up and the ready state.
- A full **voice** turn: real synthesized speech fed in as the microphone →
  Whisper transcribed "What is the capital, France?" → Qwen replied "The capital
  of France is Paris…" → Supertonic spoke it → back to idle.
- Typed messages, suggestion chips, and interrupting a reply with a new message.
- Offline UI state (badge + callout), settings panel, mobile layout, the
  unsupported-browser screen and the out-of-memory dialog.
- Production build served under `/loom/` (like GitHub Pages), service worker
  registration, and reloading the app with the server completely down.
- **Real bug found and fixed:** this Intel GPU advertises 16-bit float support
  but computes it wrongly (the LLM answered "10" to "2 + 2"). Loom now
  self-tests and falls back to 32-bit weights automatically — see
  `DESIGN_NOTES.md`.

Not verified here: the default 1.5B model end-to-end (only its files/sizes were
checked), a physical microphone, Safari/Firefox, and discrete GPUs. Worth a
quick run on your own machine.

## Worth recording

- The README has a placeholder for a demo GIF (turning wifi off
  mid-conversation). That's the single most persuasive asset for this project.
