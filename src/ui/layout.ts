import type { TalkMode } from '../config/settings';
import { h } from './dom';
import { faceSvg } from './face';
import { icon } from './icons';
import { installButton } from './install';

export interface Layout {
  root: HTMLElement;
  /** Saved chats list in the sidebar. */
  chatList: HTMLElement;
  newChatButton: HTMLButtonElement;
  /** Opens the sidebar on small screens. */
  menuButton: HTMLButtonElement;
  scrim: HTMLElement;
  /** "100% local" / "Offline" indicator. */
  badge: HTMLElement;
  /** Opens the "Under the hood" panel. */
  proofButton: HTMLButtonElement;
  /** The "Airplane Mode Test" announcement above the headline. */
  announce: HTMLElement;
  empty: HTMLElement;
  /** Mode cards in the welcome screen. */
  modePicker: HTMLElement;
  /** Suggestion chips for the current mode. */
  chipsBox: HTMLElement;
  /** Current mode shown in the top bar. */
  chatTitle: HTMLElement;
  stage: HTMLElement;
  /** The voice orb button (hosts Loom's face). */
  talk: HTMLButtonElement;
  talkBadge: HTMLElement;
  wave: HTMLCanvasElement;
  status: HTMLElement;
  typeForm: HTMLFormElement;
  typeInput: HTMLInputElement;
  settingsButton: HTMLButtonElement;
  /** "Ready for offline" indicator in the sidebar. */
  offlineStatus: HTMLElement;
  modeButtons: Record<TalkMode, HTMLButtonElement>;
  upgrade: { el: HTMLElement; text: HTMLElement; fill: HTMLElement };
}

export function buildLayout(): Layout {
  // ── Sidebar ──
  const newChatButton = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'New chat', title: 'New chat' }, icon('plus'));
  const chatList = h('nav', { class: 'chat-list', 'aria-label': 'Your chats' });
  const settingsButton = h('button', { type: 'button', class: 'side-link' }, icon('settings'), h('span', {}, 'Models & voice'));
  const offlineStatus = h('div', { class: 'offline-status', role: 'status', hidden: true });
  const sidebar = h(
    'aside',
    { class: 'sidebar', id: 'sidebar' },
    h('div', { class: 'sidebar-head' }, h('div', { class: 'brand' }, faceSvg('var(--ink)', 26), h('span', {}, 'Loom')), newChatButton),
    h('p', { class: 'side-label' }, 'Chats'),
    chatList,
    h('div', { class: 'sidebar-foot' }, offlineStatus, settingsButton, h('p', { class: 'side-note' }, icon('shield'), 'Chats are saved on this device only.')),
  );
  const scrim = h('div', { class: 'scrim', 'aria-hidden': 'true' });

  // ── Top bar ──
  const menuButton = h('button', { type: 'button', class: 'icon-btn menu-btn', 'aria-label': 'Open chats', 'aria-controls': 'sidebar', 'aria-expanded': 'false' }, icon('menu'));
  const chatTitle = h('div', { class: 'chat-title' });
  const badge = h('span', { class: 'local-badge', 'data-online': 'true' });
  const proofButton = h(
    'button',
    { type: 'button', class: 'icon-btn proof-toggle', 'aria-label': 'Under the hood', title: 'Under the hood: live speed and network proof', 'aria-controls': 'proof-panel', 'aria-expanded': 'false' },
    icon('gauge'),
  );
  const topbar = h('header', { class: 'topbar' }, menuButton, chatTitle, h('div', { class: 'topbar-right' }, installButton(), badge, proofButton));

  // ── Welcome screen ──
  const announce = h('p', { class: 'announce' });
  const modePicker = h('div', { class: 'mode-picker', role: 'radiogroup', 'aria-label': 'What would you like to do?' });
  const chipsBox = h('div', { class: 'chips' });
  const empty = h(
    'div',
    { class: 'empty' },
    announce,
    h('h1', {}, 'Meet ', faceSvg('var(--ink)', 56), ' Loom'),
    h(
      'p',
      { class: 'lede' },
      'A voice assistant that runs entirely on your device. No servers, no API keys — talk to it with your wifi off, or drop in a PDF and ask about it.',
    ),
    modePicker,
    chipsBox,
  );

  // ── Background upgrade progress ──
  const upgradeText = h('span', { class: 'upgrade-text' });
  const upgradeFill = h('span');
  const upgradeEl = h(
    'div',
    { class: 'upgrade', hidden: true, role: 'status' },
    icon('brain'),
    h('div', { class: 'upgrade-body' }, upgradeText, h('div', { class: 'bar' }, upgradeFill)),
  );
  const stage = h('main', { class: 'stage' }, upgradeEl);

  // ── Voice dock + composer ──
  const talkBadge = h('span', { class: 'talk-badge', 'aria-hidden': 'true' }, icon('mic'));
  const talk = h('button', { type: 'button', class: 'talk', 'data-state': 'idle', 'aria-label': 'Start talking', disabled: true }, talkBadge);
  const wave = h('canvas', { class: 'wave', 'aria-hidden': 'true' });
  const status = h('p', { class: 'status', 'aria-live': 'polite' }, 'Loading models…');
  const modeButtons: Record<TalkMode, HTMLButtonElement> = {
    'hands-free': h('button', { type: 'button', role: 'radio', 'aria-checked': 'false' }, 'Hands-free'),
    push: h('button', { type: 'button', role: 'radio', 'aria-checked': 'false' }, 'Push to talk'),
  };
  const modeSwitch = h('div', { class: 'mode-switch', role: 'radiogroup', 'aria-label': 'How to talk' }, modeButtons['hands-free'], modeButtons.push);

  const typeInput = h('input', { type: 'text', placeholder: 'Message Loom…', 'aria-label': 'Message Loom', autocomplete: 'off', disabled: true });
  const typeForm = h(
    'form',
    { class: 'composer' },
    typeInput,
    h('button', { type: 'submit', class: 'send-btn', 'aria-label': 'Send message' }, icon('arrowUp')),
  );

  // One row: the voice orb, then status + talk-mode switch above the composer.
  const dock = h(
    'footer',
    { class: 'dock' },
    h(
      'div',
      { class: 'dock-inner' },
      h('div', { class: 'orb' }, wave, talk),
      h('div', { class: 'dock-main' }, h('div', { class: 'voice-side' }, status, modeSwitch), typeForm),
    ),
  );

  const main = h('section', { class: 'main' }, topbar, stage, dock);
  const root = h('div', { class: 'app', 'data-sidebar': 'closed' }, sidebar, scrim, main);

  return {
    root,
    chatList,
    newChatButton,
    menuButton,
    scrim,
    badge,
    proofButton,
    announce,
    empty,
    modePicker,
    chipsBox,
    chatTitle,
    stage,
    talk,
    talkBadge,
    wave,
    status,
    typeForm,
    typeInput,
    settingsButton,
    offlineStatus,
    modeButtons,
    upgrade: { el: upgradeEl, text: upgradeText, fill: upgradeFill },
  };
}

/** Reflect connectivity in the badge and the Airplane Mode Test announcement. */
export function renderConnectivity(layout: Layout, online: boolean, ready: boolean): void {
  layout.badge.dataset.online = String(online);
  layout.badge.replaceChildren(h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', {}, online ? '100% local' : 'Offline · still working'));
  layout.badge.title = online
    ? 'All inference runs on your device. The network is only used once, to download models.'
    : 'You are offline. Loom keeps working because everything runs locally.';

  layout.announce.dataset.offline = String(!online);
  layout.announce.replaceChildren(
    icon(online ? 'plane' : 'wifiOff'),
    h('strong', {}, online ? 'Airplane Mode Test' : 'You’re offline'),
    h(
      'span',
      {},
      online
        ? ready
          ? 'Turn off your wifi and keep talking'
          : 'Once ready, turn off your wifi and keep talking'
        : ready
          ? 'and Loom is still listening'
          : 'connect once to download the models',
    ),
  );
}
