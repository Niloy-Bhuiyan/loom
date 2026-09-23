import {
  DEFAULT_LLM,
  DEFAULT_STT,
  DEFAULT_TTS,
  DEFAULT_VOICE,
  LLM_PRESETS,
  STT_PRESETS,
  SUPERTONIC_VOICES,
  type TtsEngine,
} from './models';

export interface Settings {
  stt: string;
  llm: string;
  tts: TtsEngine;
  voice: string;
}

export const DEFAULT_SETTINGS: Settings = {
  stt: DEFAULT_STT,
  llm: DEFAULT_LLM,
  tts: DEFAULT_TTS,
  voice: DEFAULT_VOICE,
};

const STORAGE_KEY = 'loom.settings.v1';

/** Validate untrusted stored data, keeping only known values. */
export function parseSettings(raw: unknown): Settings {
  const s = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const pick = (value: unknown, allowed: readonly string[], fallback: string) =>
    typeof value === 'string' && allowed.includes(value) ? value : fallback;

  return {
    stt: pick(s.stt, STT_PRESETS.map((p) => p.id), DEFAULT_SETTINGS.stt),
    llm: pick(s.llm, LLM_PRESETS.map((p) => p.id), DEFAULT_SETTINGS.llm),
    tts: pick(s.tts, ['supertonic', 'web-speech'], DEFAULT_SETTINGS.tts) as TtsEngine,
    voice: pick(s.voice, SUPERTONIC_VOICES.map((v) => v.id), DEFAULT_SETTINGS.voice),
  };
}

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return parseSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode, quota); settings then last for the session only.
  }
}
