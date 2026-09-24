/**
 * Model presets. Everything here is downloaded once from the Hugging Face
 * Hub, cached by the browser, and then run locally — no inference API.
 *
 * To try a different model, add a preset here; the rest of the app picks it
 * up from the settings panel. See DESIGN_NOTES.md for why these were chosen.
 */

type Dtype = 'fp32' | 'fp16' | 'q4' | 'q4f16' | 'q8' | 'int8' | 'uint8';

export interface SttPreset {
  id: string;
  label: string;
  model: string;
  approxMB: number;
  /** Per-file dtypes, following the official Transformers.js Whisper WebGPU example. */
  dtype: Record<string, Dtype>;
}

export interface LlmPreset {
  id: string;
  label: string;
  model: string;
  approxMB: number;
  /** Used when the GPU supports `shader-f16` (smaller and faster). */
  dtypeF16: Dtype;
  /** Used otherwise; null if the repo only ships f16 weights. */
  dtypeF32: Dtype | null;
  /** Shown in the UI to help pick. */
  note: string;
}

export interface VoicePreset {
  id: string;
  label: string;
}

export const STT_PRESETS: readonly SttPreset[] = [
  {
    id: 'whisper-tiny.en',
    label: 'Whisper Tiny (English)',
    model: 'onnx-community/whisper-tiny.en',
    approxMB: 120,
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  },
  {
    id: 'whisper-base.en',
    label: 'Whisper Base (English)',
    model: 'onnx-community/whisper-base.en',
    approxMB: 210,
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  },
  {
    id: 'whisper-small.en',
    label: 'Whisper Small (English, most accurate)',
    model: 'onnx-community/whisper-small.en',
    approxMB: 590,
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  },
];

export const LLM_PRESETS: readonly LlmPreset[] = [
  {
    id: 'qwen2.5-1.5b',
    label: 'Qwen2.5 1.5B Instruct',
    model: 'onnx-community/Qwen2.5-1.5B-Instruct',
    approxMB: 1250,
    dtypeF16: 'q4f16',
    dtypeF32: 'q4',
    note: 'Best replies. Wants ~2 GB of free GPU memory.',
  },
  {
    id: 'qwen3-4b',
    label: 'Qwen3 4B Instruct (pro)',
    model: 'onnx-community/Qwen3-4B-Instruct-2507-ONNX',
    approxMB: 2900,
    dtypeF16: 'q4f16',
    dtypeF32: 'q4',
    note: 'Noticeably smarter. For gaming GPUs or Apple M-series with 16 GB+ memory; ~3 GB download.',
  },
  {
    id: 'qwen2.5-0.5b',
    label: 'Qwen2.5 0.5B Instruct (light)',
    model: 'onnx-community/Qwen2.5-0.5B-Instruct',
    approxMB: 500,
    dtypeF16: 'q4f16',
    dtypeF32: 'q4',
    note: 'Faster, smaller download, for integrated or older GPUs.',
  },
];

export const SUPERTONIC_MODEL = 'onnx-community/Supertonic-TTS-ONNX';
export const SUPERTONIC_APPROX_MB = 265;

/** Voice style embeddings shipped in the Supertonic repo (`voices/<id>.bin`). */
export const SUPERTONIC_VOICES: readonly VoicePreset[] = [
  { id: 'F1', label: 'Female 1' },
  { id: 'F2', label: 'Female 2' },
  { id: 'F3', label: 'Female 3' },
  { id: 'F4', label: 'Female 4' },
  { id: 'F5', label: 'Female 5' },
  { id: 'M1', label: 'Male 1' },
  { id: 'M2', label: 'Male 2' },
  { id: 'M3', label: 'Male 3' },
  { id: 'M4', label: 'Male 4' },
  { id: 'M5', label: 'Male 5' },
];

export type TtsEngine = 'supertonic' | 'web-speech';

export const DEFAULT_STT = 'whisper-base.en';
export const DEFAULT_LLM = 'qwen2.5-1.5b';
export const DEFAULT_TTS: TtsEngine = 'supertonic';
export const DEFAULT_VOICE = 'F1';

/** The preset to suggest when the default LLM does not fit in GPU memory. */
export const LIGHTEST_LLM = 'qwen2.5-0.5b';

export function findStt(id: string): SttPreset {
  return STT_PRESETS.find((p) => p.id === id) ?? STT_PRESETS.find((p) => p.id === DEFAULT_STT)!;
}

export function findLlm(id: string): LlmPreset {
  return LLM_PRESETS.find((p) => p.id === id) ?? LLM_PRESETS.find((p) => p.id === DEFAULT_LLM)!;
}
