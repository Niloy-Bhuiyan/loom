import type { Capabilities } from '../core/capabilities';
import type { FriendlyError } from '../core/errors';
import { h } from './dom';
import { icon } from './icons';

const BROWSERS: [string, string][] = [
  ['Chrome or Edge 113+', 'Windows, macOS, ChromeOS'],
  ['Chrome 121+', 'Android (recent devices)'],
  ['Safari 26+', 'macOS, iOS, iPadOS'],
  ['Firefox 141+', 'Windows (other platforms rolling out)'],
];

const REASONS: Record<string, { title: string; body: string }> = {
  'insecure-context': {
    title: 'Loom needs a secure page',
    body: 'Browsers only enable WebGPU and the microphone on secure origins. Open Loom over https:// or on http://localhost.',
  },
  'no-webgpu': {
    title: 'This browser doesn’t support WebGPU',
    body: 'Loom runs speech recognition, a language model and a neural voice directly on your graphics card using WebGPU, so there is no server to fall back to. Please open it in one of these browsers:',
  },
  'no-adapter': {
    title: 'No compatible GPU found',
    body: 'Your browser supports WebGPU but couldn’t get access to a graphics adapter. This usually means hardware acceleration is turned off, the GPU is blocklisted, or the graphics drivers are outdated. Try enabling hardware acceleration in your browser settings and updating your drivers, or use one of these browsers:',
  },
};

/** Shown instead of the app when the browser can’t run it — never a blank page or a crash. */
export function unsupportedScreen(caps: Capabilities): HTMLElement {
  const reason = REASONS[caps.reason ?? 'no-webgpu'] ?? REASONS['no-webgpu']!;
  const showBrowsers = caps.reason !== 'insecure-context';
  return h(
    'div',
    { class: 'overlay' },
    h(
      'div',
      { class: 'card', role: 'alert' },
      h('div', { class: 'card-head' }, h('span', { class: 'alert-icon info' }, icon('alert'))),
      h('h2', { style: 'margin-top:14px' }, reason.title),
      h('p', {}, reason.body),
      showBrowsers &&
        h('ul', { class: 'browser-list' }, ...BROWSERS.map(([name, where]) => h('li', {}, h('span', {}, name), h('span', {}, where)))),
      h(
        'p',
        { class: 'loader-foot' },
        'You’ll also need roughly 2 GB of free GPU memory for the default models (about 1 GB with the light model). ',
        h('a', { href: 'https://caniuse.com/webgpu', target: '_blank', rel: 'noopener' }, 'Check WebGPU support'),
      ),
    ),
  );
}

export interface DialogAction {
  label: string;
  primary?: boolean;
  onClick(): void;
}

/** A friendly error with next steps and the raw message tucked away. */
export function errorDialog(error: FriendlyError, actions: DialogAction[], context?: string): HTMLElement {
  const overlay = h('div', { class: 'overlay', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'error-title' });
  const buttons = actions.map((a) =>
    h(
      'button',
      {
        class: a.primary ? 'btn btn-primary' : 'btn',
        onclick: () => {
          overlay.remove();
          a.onClick();
        },
      },
      a.label,
    ),
  );
  overlay.append(
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'alert-icon' }, icon('alert'))),
      h('h2', { id: 'error-title', style: 'margin-top:14px' }, error.title),
      h('p', {}, context ? `${context} ${error.detail}` : error.detail),
      h('div', { class: 'card-actions' }, ...buttons),
      h('details', {}, h('summary', {}, 'Technical details'), h('pre', {}, error.raw)),
    ),
  );
  return overlay;
}
