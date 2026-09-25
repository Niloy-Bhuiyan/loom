import type { TurnMetrics } from '../agent/conversation';
import type { NetRequest } from '../core/net-monitor';
import { formatBytes } from '../core/progress';
import { h } from './dom';
import { icon } from './icons';

export interface SystemInfo {
  gpu: string;
  precision: string;
  ears: string;
  brain: string;
  voice: string;
}

const ms = (n: number | null) => (n === null ? '—' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);

/**
 * "Under the hood": live proof that everything runs on this device — per-turn
 * timings, generation speed, the hardware doing the work, and a count of
 * network requests since Loom became ready (which should stay at zero).
 */
export class ProofPanel {
  readonly el: HTMLElement;
  private netCount = h('span', { class: 'proof-big' }, '—');
  private netNote = h('p', { class: 'proof-note' });
  private netList = h('ul', { class: 'proof-list' });
  private metricsGrid = h('dl', { class: 'proof-grid' });
  private systemGrid = h('dl', { class: 'proof-grid proof-system' });
  private storage = h('dd', {}, '—');
  private shareButton: HTMLButtonElement;
  private hasMetrics = false;

  constructor(onShare: () => void) {
    this.shareButton = h('button', { type: 'button', class: 'btn btn-primary proof-share', disabled: true, onclick: onShare }, icon('share'), 'Share my speed');
    const close = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close' }, icon('close'));
    close.addEventListener('click', () => this.close());

    this.el = h(
      'aside',
      { class: 'proof', id: 'proof-panel', 'aria-label': 'Under the hood', hidden: true },
      h('div', { class: 'proof-head' }, h('h2', {}, 'Under the hood'), close),
      h('p', { class: 'proof-intro' }, 'Measured live, on this device.'),
      h(
        'section',
        { class: 'proof-card proof-privacy' },
        h('h3', {}, 'Network since Loom became ready'),
        h('div', { class: 'proof-count' }, this.netCount, h('span', {}, 'requests')),
        this.netNote,
        this.netList,
      ),
      h('section', { class: 'proof-card' }, h('h3', {}, 'Last reply'), this.metricsGrid),
      h('section', { class: 'proof-card' }, h('h3', {}, 'Running on'), this.systemGrid),
      this.shareButton,
    );
    this.el.addEventListener('keydown', (e) => e.key === 'Escape' && this.close());
    this.setMetrics(null);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.el.hidden = false;
    void this.refreshStorage();
  }

  close(): void {
    this.el.hidden = true;
  }

  setNetwork(requests: readonly NetRequest[], ready: boolean): void {
    this.netCount.textContent = ready ? String(requests.length) : '—';
    this.el.dataset.clean = String(ready && requests.length === 0);
    this.netNote.textContent = !ready
      ? 'Counting starts once the models are loaded.'
      : requests.length === 0
        ? 'Nothing you say leaves this device. Turn off your wifi — this stays at zero.'
        : 'These went over the network (e.g. downloading a model you just enabled):';
    this.netList.replaceChildren(
      ...requests.slice(-4).map((r) => h('li', {}, h('span', {}, new URL(r.url).host), h('time', {}, new Date(r.at).toLocaleTimeString()))),
    );
  }

  setMetrics(m: TurnMetrics | null): void {
    this.hasMetrics = m !== null;
    this.shareButton.disabled = !this.hasMetrics;
    if (!m) {
      this.metricsGrid.replaceChildren(h('p', { class: 'proof-note' }, 'Talk to Loom to see live numbers.'));
      return;
    }
    this.metricsGrid.replaceChildren(
      ...row('Speech → text', m.sttMs === null ? 'typed' : ms(m.sttMs)),
      ...row('First word', ms(m.firstTokenMs)),
      ...row('Speed', m.tokensPerSecond === null ? '—' : `${m.tokensPerSecond.toFixed(1)} tokens/s`),
      ...row('Loom started talking', m.replyStartMs === null ? '—' : `${ms(m.replyStartMs)} after you`),
    );
  }

  setSystem(info: SystemInfo): void {
    this.systemGrid.replaceChildren(
      ...row('GPU', info.gpu),
      ...row('Backend', `WebGPU · ${info.precision}`),
      ...row('Ears', info.ears),
      ...row('Brain', info.brain),
      ...row('Voice', info.voice),
      h('dt', {}, 'Saved on device'),
      this.storage,
    );
  }

  private async refreshStorage(): Promise<void> {
    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    this.storage.textContent = estimate?.usage ? formatBytes(estimate.usage) : '—';
  }
}

function row(label: string, value: string): HTMLElement[] {
  return [h('dt', {}, label), h('dd', {}, value)];
}
