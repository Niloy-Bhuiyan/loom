import { MODES, type Mode } from '../config/modes';
import { h } from './dom';
import { faceSvg } from './face';

/** Mode cards on the welcome screen. */
export function renderModePicker(container: HTMLElement, current: Mode, onPick: (mode: Mode) => void): void {
  container.replaceChildren(
    ...MODES.map((mode) =>
      h(
        'button',
        {
          type: 'button',
          class: 'mode-card',
          role: 'radio',
          'aria-checked': String(mode.id === current.id),
          onclick: () => onPick(mode),
        },
        faceSvg(mode.color, 32),
        h('span', { class: 'mode-label' }, mode.label),
        h('span', { class: 'mode-blurb' }, mode.blurb),
      ),
    ),
  );
}

/** Starter prompts for the current mode. */
export function renderSuggestions(container: HTMLElement, mode: Mode, enabled: boolean, onPick: (text: string) => void): void {
  container.replaceChildren(
    ...mode.suggestions.map((text) => h('button', { type: 'button', class: 'chip', disabled: !enabled, onclick: () => onPick(text) }, text)),
  );
}

/** The current mode in the top bar. */
export function renderChatTitle(container: HTMLElement, mode: Mode): void {
  container.replaceChildren(faceSvg(mode.color, 22), h('span', {}, mode.label));
}
