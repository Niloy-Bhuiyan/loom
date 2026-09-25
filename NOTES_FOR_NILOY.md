# Notes for Niloy

Things worth knowing that aren't obvious from the code.

## Nothing is mocked, nothing is paid

- **No API keys, no paid services, no mocked components.** All three stages run
  real models locally.
- External hosts contacted (downloads only, no keys):
  - `huggingface.co` — model weights, tokenizers, Supertonic voice styles,
    the document-search embedding model.
  - `cdn.jsdelivr.net` — ONNX Runtime's WebAssembly glue, fetched by
    Transformers.js by default and then cached in the browser.
- Bundled with the app (no download): the Silero VAD model (MIT) and pdf.js.
- New dependencies: `onnxruntime-web` (pinned to the version Transformers.js
  uses, so it's not duplicated) and `pdfjs-dist` 6.x (5.x has a known
  "malicious PDF runs JavaScript" vulnerability).

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

### The "level-up" features (second round)

Also tested in the browser on the same Intel iGPU, with real speech
(a Windows TTS recording played into a fake microphone):

- **Hands-free:** Silero VAD detected speech ~1 s in; three sentences spoken
  with natural pauses were merged into one message ("Hello, Loom, what is the
  capital of France? I would like a short answer please."), Loom replied
  "The capital of France is Paris." out loud and went back to listening.
- **Documents:** a dropped PDF was read and indexed on-device; asking "What is
  the wifi password here?" got "The wifi password is river123." On a longer
  synthetic handbook, 8/8 questions retrieved the right passage.
- **Modes:** picking English practice switched persona and suggestions, and
  Loom spoke the greeting.
- **Saved chats:** conversations were saved automatically, listed in the
  drawer ("English practice · 1 h ago") and reopened with mode and history.
- **Fast start:** a fresh visit with the default 1.5B brain started on the
  0.5B brain and began downloading the 1.5B one in the background.
- **Download auto-retry:** the loader showed "Connection dropped — retrying"
  and recovered during a real network drop.

Found and fixed during this testing (details in `DESIGN_NOTES.md`): pauses
splitting one turn into several; exact-term document questions missed by pure
embedding search; stale transcriptions delaying a merged turn by ~18 s; the
background download giving up on the first dropped connection.

### Not verified here

- The background upgrade actually **completing and swapping in**: the test
  network kept dropping, and this embedded browser can't store files that large
  in its cache, so it failed and correctly fell back to the light brain (the
  retry fix came after that run).
- The Qwen3 4B "pro" brain, a physical microphone, Safari/Firefox, discrete
  GPUs, and phones. Worth a quick run on your own machine — ideally Chrome on a
  laptop with headphones, then again on speakers to hear how barge-in behaves.

### Third round: background download, proof panel, speed card

- **Background download** verified in real Google Chrome: "Download in the
  background" on the first-visit screen → Chrome's own download UI → service
  worker files everything into the caches → Loom reloads and starts from disk.
- In the Claude app's built-in browser, Background Fetch never starts; the
  20-second watchdog correctly fell back to downloading in the tab.
- The README screenshots were captured from a real scripted Chrome session
  (see "How the screenshots were made" in the README). The capture script
  lives outside the repo; it's easy to recreate with `puppeteer-core` if you
  want fresh screenshots on a faster machine.

## Worth recording

- The README has a placeholder for a demo GIF (turning wifi off
  mid-conversation). That's the single most persuasive asset for this project.
