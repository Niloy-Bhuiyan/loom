import logoUrl from '../assets/logo.svg';
import type { TalkMode } from '../config/settings';
import { h } from './dom';
import { icon } from './icons';

export const SUGGESTIONS = [
  'Tell me a fun fact about octopuses',
  'How do you work without the internet?',
  'Give me a two-line poem about rain',
  'Explain WebGPU like I’m five',
];

export interface Layout {
  root: HTMLElement;
  badge: HTMLElement;
  callout: HTMLElement;
  empty: HTMLElement;
  chips: HTMLButtonElement[];
  stage: HTMLElement;
  talk: HTMLButtonElement;
  wave: HTMLCanvasElement;
  status: HTMLElement;
  typeForm: HTMLFormElement;
  modeButtons: Record<TalkMode, HTMLButtonElement>;
  typeInput: HTMLInputElement;
  settingsButton: HTMLButtonElement;
}

export function buildLayout(): Layout {
  const badge = h('span', { class: 'local-badge', 'data-online': 'true' });
  const settingsButton = h('button', { class: 'icon-btn', 'aria-label': 'Models and voice settings', title: 'Models & voice' }, icon('settings'));

  const callout = h('section', { class: 'callout', 'aria-live': 'polite' });

  const chips = SUGGESTIONS.map((text) => h('button', { class: 'chip', type: 'button', disabled: true }, text));
  const empty = h(
    'div',
    { class: 'empty' },
    h('h1', {}, 'Talk to an AI with ', h('em', {}, 'your wifi off.')),
    h(
      'p',
      {},
      'Speech recognition, a language model and a neural voice all run on your GPU, right here in this tab. ' +
        'No server, no API keys — nothing you say ever leaves your device.',
    ),
    h('div', { class: 'chips' }, ...chips),
  );

  const talk = h('button', { class: 'talk', 'data-state': 'idle', 'aria-label': 'Hold to talk', disabled: true }, icon('mic'));
  const wave = h('canvas', { class: 'wave', 'aria-hidden': 'true' });
  const status = h('p', { class: 'status', 'aria-live': 'polite' }, 'Loading models…');
  const typeInput = h('input', { type: 'text', placeholder: 'or type a message…', 'aria-label': 'Type a message', autocomplete: 'off', disabled: true });
  const typeForm = h('form', { class: 'type-form' }, typeInput, h('button', { type: 'submit' }, 'Send'));
  const modeButtons: Record<TalkMode, HTMLButtonElement> = {
    'hands-free': h('button', { type: 'button', role: 'radio', 'aria-checked': 'false' }, 'Hands-free'),
    push: h('button', { type: 'button', role: 'radio', 'aria-checked': 'false' }, 'Push to talk'),
  };
  const modeSwitch = h('div', { class: 'mode-switch', role: 'radiogroup', 'aria-label': 'How to talk' }, modeButtons['hands-free'], modeButtons.push);

  const stage = h('main', { class: 'stage' }, callout);

  const root = h(
    'div',
    { class: 'app' },
    h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('img', { src: logoUrl, alt: '' }), 'Loom'),
      h('div', { class: 'topbar-right' }, badge, settingsButton),
    ),
    stage,
    h('footer', { class: 'dock' }, modeSwitch, h('div', { class: 'talk-wrap' }, wave, talk), status, typeForm),
  );

  return { root, badge, callout, empty, chips, stage, talk, wave, status, typeForm, typeInput, settingsButton, modeButtons };
}

/** Reflect connectivity in the badge and the Airplane Mode Test callout. */
export function renderConnectivity(layout: Layout, online: boolean, ready: boolean): void {
  layout.badge.dataset.online = String(online);
  layout.badge.replaceChildren(
    icon(online ? 'shield' : 'wifiOff'),
    h('span', {}, online ? '100% local' : 'Offline'),
    h('span', { class: 'label-long' }, online ? ' · on-device AI' : ' · still working'),
  );
  layout.badge.title = online
    ? 'All inference runs on your device. The network is only used once, to download models.'
    : 'You are offline. Loom keeps working because everything runs locally.';

  if (layout.callout.hidden) return;
  layout.callout.dataset.offline = String(!online);
  const dismiss = h('button', { class: 'icon-btn', 'aria-label': 'Dismiss', onclick: () => (layout.callout.hidden = true) }, icon('close'));

  const [title, body] = !online
    ? ready
      ? ['You’re offline — and Loom is still listening.', 'No network, no servers, no API keys. Every word you hear is generated right here on your GPU.']
      : ['You’re offline.', 'Loom needs to download its models once before it can run offline. Reconnect to finish setting up.']
    : ['✈ Airplane Mode Test', 'Once Loom is ready, turn off your wifi (or switch on airplane mode) and keep talking. It works exactly the same — because nothing ever leaves this device.'];

  layout.callout.replaceChildren(
    h('span', { class: 'callout-icon' }, icon(online ? 'plane' : 'wifiOff')),
    h('div', {}, h('h2', {}, title), h('p', {}, body)),
    dismiss,
  );
}
