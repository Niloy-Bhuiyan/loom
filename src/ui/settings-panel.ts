import { LLM_PRESETS, STT_PRESETS, SUPERTONIC_VOICES, type TtsEngine } from '../config/models';
import type { Settings } from '../config/settings';
import type { Capabilities } from '../core/capabilities';
import { formatBytes } from '../core/progress';
import { h } from './dom';
import { icon } from './icons';

export interface SettingsPanelOptions {
  settings: Settings;
  caps: Capabilities;
  /** Voice engine actually in use (may differ from the setting after a fallback). */
  activeTts: string;
  onApply(next: Settings): void;
  onClearCache(): void;
}

const mb = (n: number) => formatBytes(n * 1024 * 1024);

function select(id: string, options: [string, string][], value: string): HTMLSelectElement {
  const el = h('select', { id });
  for (const [v, label] of options) el.append(h('option', { value: v, selected: v === value }, label));
  return el;
}

/** Model / voice picker. Changing models reloads them; changing only the voice is instant. */
export function openSettings(opts: SettingsPanelOptions): void {
  const { settings, caps } = opts;

  const stt = select('set-stt', STT_PRESETS.map((p) => [p.id, `${p.label} · ${mb(p.approxMB)}`]), settings.stt);
  const llm = select('set-llm', LLM_PRESETS.map((p) => [p.id, `${p.label} · ${mb(p.approxMB)}`]), settings.llm);
  const llmNote = h('small');
  const tts = select(
    'set-tts',
    [
      ['supertonic', 'Supertonic neural voice (local, ~265 MB)'],
      ['web-speech', 'Built-in browser voice (on-device voices only)'],
    ],
    settings.tts,
  );
  const voice = select('set-voice', SUPERTONIC_VOICES.map((v) => [v.id, v.label]), settings.voice);
  const voiceField = h('div', { class: 'field' }, h('label', { for: 'set-voice' }, 'Supertonic voice'), voice);

  const syncNotes = () => {
    llmNote.textContent = LLM_PRESETS.find((p) => p.id === llm.value)?.note ?? '';
    voiceField.hidden = tts.value !== 'supertonic';
  };
  llm.addEventListener('change', syncNotes);
  tts.addEventListener('change', syncNotes);
  syncNotes();

  const close = () => overlay.remove();
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title', onclick: (e: Event) => e.target === overlay && close() });
  overlay.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Escape' && close());

  overlay.append(
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { id: 'settings-title' }, 'Models & voice'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close'))),
      h('p', {}, 'Every model runs on this device. Bigger models are smarter but need more GPU memory and a longer first download.'),
      h('div', { class: 'field' }, h('label', { for: 'set-stt' }, 'Speech recognition (ears)'), stt),
      h('div', { class: 'field' }, h('label', { for: 'set-llm' }, 'Language model (brain)'), llm, llmNote),
      h('div', { class: 'field' }, h('label', { for: 'set-tts' }, 'Voice engine'), tts, h('small', {}, `In use now: ${opts.activeTts}`)),
      voiceField,
      h(
        'div',
        { class: 'card-actions' },
        h(
          'button',
          {
            class: 'btn btn-primary',
            onclick: () => {
              close();
              opts.onApply({ stt: stt.value, llm: llm.value, tts: tts.value as TtsEngine, voice: voice.value });
            },
          },
          'Apply',
        ),
        h(
          'button',
          {
            class: 'btn btn-danger',
            onclick: () => {
              if (confirm('Delete all downloaded models from this browser? They will be downloaded again next time.')) {
                close();
                opts.onClearCache();
              }
            },
          },
          icon('trash'),
          'Clear downloaded models',
        ),
      ),
      h(
        'dl',
        { class: 'sysinfo' },
        h('dt', {}, 'GPU'),
        h('dd', {}, caps.adapterName ?? 'unknown'),
        h('dt', {}, 'shader-f16'),
        h('dd', {}, caps.shaderF16 ? 'yes (q4f16 weights)' : 'no (q4 weights)'),
        h('dt', {}, 'Inference'),
        h('dd', {}, 'WebGPU, in this tab'),
      ),
    ),
  );

  document.body.append(overlay);
  stt.focus();
}
