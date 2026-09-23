# Contributing to Loom

Thanks for helping! Loom's whole promise is **"nothing leaves your device"**, so
the one hard rule is:

> **No server-side inference, no API keys, no telemetry.** The network may only
> be used to download model files (and runtime assets) once.

## Getting started

```bash
git clone https://github.com/Niloy-Bhuiyan/loom.git
cd loom
npm install
npm run dev
```

You'll need a WebGPU-capable browser (see the README). The first run downloads
the models; switch to the light models in ⚙ settings to iterate faster.

## Before opening a pull request

```bash
npm test          # unit tests (Vitest)
npm run build     # strict type-check + production build
```

CI runs both on every pull request.

## Code layout & conventions

- **TypeScript strict mode** everywhere, including `noUncheckedIndexedAccess`.
- **Keep the stages separate.** STT, LLM and TTS implement the interfaces in
  `src/pipeline/types.ts`. Conversation logic (`src/agent/`) must only talk to
  those interfaces, never to a concrete model.
- **Heavy work goes in a Web Worker.** Anything that imports
  `@huggingface/transformers` belongs in a `*.worker.ts` file using the shared
  protocol in `src/workers/`. The main thread should never import the library.
- **Pure logic gets a unit test.** Sentence chunking, text cleanup, error
  classification, settings parsing, etc. live in small modules with
  `*.test.ts` files next to them.
- **Never render model or user text as HTML.** Use `textContent` (the `h()`
  helper in `src/ui/dom.ts` does this for string children).
- No UI framework — plain DOM keeps the bundle tiny and the code easy to follow.

## Adding a model

1. Check that the model has ONNX weights that run on Transformers.js WebGPU
   (look for an `onnx/` folder with `q4f16`/`q4` files on the Hugging Face Hub).
2. Add a preset to `src/config/models.ts` with an honest `approxMB`.
3. Try it on both a discrete and an integrated GPU if you can, and mention the
   results in your PR.
4. If it changes a default, update `DESIGN_NOTES.md` with the reasoning.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `style:`, `ci:`, `chore:`.
Keep commits small and focused.

## Reporting bugs

Please include your browser + version, OS, GPU (shown in ⚙ settings), which
models you selected, and the "Technical details" text from any error dialog.
