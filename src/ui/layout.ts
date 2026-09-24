import logoUrl from '../assets/logo.svg';
import type { TalkMode } from '../config/settings';
import { h } from './dom';
import { icon } from './icons';
import { installButton } from './install';

export interface Layout {
  root: HTMLElement;
  badge: HTMLElement;
  callout: HTMLElement;
  empty: HTMLElement;
  /** Mode cards in the welcome screen. */
  modePicker: HTMLElement;
  /** Suggestion chips for the current mode. */
  chipsBox: HTMLElement;
  chatsButton: HTMLButtonElement;
  /** Shows the current mode in the top bar. */
  modePill: HTMLButtonElement;
  stage: HTMLElement;
  talk: HTMLButtonElement;
  wave: HTMLCanvasElement;
  status: HTMLElement;
  typeForm: HTMLFormElement;
  modeButtons: Record<TalkMode, HTMLButtonElement>;
  upgrade: { el: HTMLElement; text: HTMLElement; fill: HTMLElement };
  typeInput: HTMLInputElement;
  settingsButton: HTMLButtonElement;
}

export function buildLayout(): Layout {
  const badge = h('span', { class: 'local-badge', 'data-online': 'true' });
  const settingsButton = h('button', { class: 'icon-btn', 'aria-label': 'Models and voice settings', title: 'Models & voice' }, icon('settings'));

  const callout = h('section', { class: 'callout', 'aria-live': 'polite' });

  const modePicker = h('div', { class: 'mode-picker', role: 'radiogroup', 'aria-label': 'What would you like to do?' });
  const chipsBox = h('div', { class: 'chips' });
  const empty = h(
    'div',
    { class: 'empty' },
    h('h1', {}, 'Talk to an AI with ', h('em', {}, 'your wifi off.')),
    h(
      'p',
      {},
      'Speech recognition, a language model and a neural voice all run on your GPU, right here in this tab. ' +
        'No server, no API keys — nothing you say ever leaves your device. Drop in a PDF to talk about it privately.',
    ),
    modePicker,
    chipsBox,
  );
  const chatsButton = h('button', { class: 'icon-btn', 'aria-label': 'Your chats', title: 'Your chats' }, icon('menu'));
  const modePill = h('button', { type: 'button', class: 'mode-pill', title: 'Your chats' });

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

  const upgradeText = h('span', { class: 'upgrade-text' });
  const upgradeFill = h('span');
  const upgradeEl = h(
    'div',
    { class: 'upgrade', hidden: true, role: 'status' },
    h('span', { class: 'upgrade-icon' }, icon('brain')),
    h('div', { class: 'upgrade-body' }, upgradeText, h('div', { class: 'bar' }, upgradeFill)),
  );

  const stage = h('main', { class: 'stage' }, callout, upgradeEl);

  const root = h(
    'div',
    { class: 'app' },
    h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, chatsButton, h('img', { src: logoUrl, alt: '' }), 'Loom', modePill),
      h('div', { class: 'topbar-right' }, installButton(), badge, settingsButton),
    ),
    stage,
    h('footer', { class: 'dock' }, modeSwitch, h('div', { class: 'talk-wrap' }, wave, talk), status, typeForm),
  );

  return { root, badge, callout, empty, modePicker, chipsBox, chatsButton, modePill, stage, talk, wave, status, typeForm, typeInput, settingsButton, modeButtons, upgrade: { el: upgradeEl, text: upgradeText, fill: upgradeFill } };
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
