import { formatBytes, PHASE_DOWNLOADING, PHASE_FROM_CACHE } from '../core/progress';
import type { LoadProgress } from '../pipeline/types';
import { h } from './dom';
import { icon, type IconName } from './icons';

export type StageStatus = 'pending' | 'loading' | 'ready' | 'error';

export interface StageInfo {
  key: string;
  title: string;
  model: string;
  approxMB: number;
  icon: IconName;
}

class StageRow {
  readonly el: HTMLLIElement;
  private bar: HTMLElement;
  private fill: HTMLElement;
  private meta: HTMLElement;
  private phase: HTMLElement;

  constructor(info: StageInfo) {
    this.fill = h('span');
    this.bar = h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${info.title} download`, 'aria-valuemin': 0, 'aria-valuemax': 100 }, this.fill);
    this.meta = h('span', { class: 'stage-meta' }, `~${formatBytes(info.approxMB * 1024 * 1024)}`);
    this.phase = h('div', { class: 'stage-phase' }, 'Waiting…');
    this.el = h(
      'li',
      { class: 'stage-row', 'data-status': 'pending' },
      h('span', { class: 'stage-icon' }, icon(info.icon)),
      h(
        'div',
        { class: 'stage-body' },
        h('div', { class: 'stage-top' }, h('strong', {}, info.title), h('span', { class: 'stage-model' }, info.model), this.meta),
        this.bar,
        this.phase,
      ),
    );
  }

  update(p: LoadProgress): void {
    this.el.dataset.status = 'loading';
    const pct = Math.round((p.fraction ?? 0) * 100);
    const fetching = p.phase === PHASE_DOWNLOADING || p.phase === PHASE_FROM_CACHE;
    const determinate = fetching && p.fraction !== null && p.fraction < 1;
    this.bar.classList.toggle('indeterminate', !determinate);
    this.fill.style.width = `${pct}%`;
    this.bar.setAttribute('aria-valuenow', String(pct));
    if (p.totalBytes > 0) this.meta.textContent = `${formatBytes(p.loadedBytes)} / ${formatBytes(p.totalBytes)}`;
    // Once every byte is in, Transformers.js is building GPU sessions, which can take a while.
    this.phase.textContent = determinate
      ? `${p.phase}… ${pct}%`
      : fetching && p.fraction === 1
        ? 'Initializing on the GPU…'
        : `${p.phase}…`;
  }

  setStatus(status: StageStatus, text: string): void {
    this.el.dataset.status = status;
    this.phase.textContent = text;
    this.bar.classList.remove('indeterminate');
    if (status === 'ready') {
      this.fill.style.width = '100%';
      this.el.querySelector('.stage-icon')!.replaceChildren(icon('check'));
    }
  }
}

/**
 * The first-run / startup panel: explains the one-time download, then shows
 * per-stage download progress and GPU warm-up.
 */
export class LoaderPanel {
  readonly el: HTMLElement;
  private rows = new Map<string, StageRow>();
  private heading: HTMLElement;
  private intro: HTMLElement;
  private actions: HTMLElement;
  private foot: HTMLElement;
  private list: HTMLElement;

  constructor(stages: StageInfo[], footnote: string) {
    this.heading = h('h2', {}, 'Set up Loom on this device');
    this.intro = h('p');
    this.actions = h('div', { class: 'card-actions' });
    this.foot = h('p', { class: 'loader-foot' }, footnote);
    this.list = h('ul', { class: 'stages' });
    for (const s of stages) {
      const row = new StageRow(s);
      this.rows.set(s.key, row);
      this.list.append(row.el);
    }
    this.el = h(
      'div',
      { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'loader-title' },
      h('div', { class: 'card' }, this.heading, this.intro, this.list, this.actions, this.foot),
    );
    this.heading.id = 'loader-title';
  }

  /** Ask before a large first download. `onBackground` is offered where downloads can outlive the tab. */
  askToDownload(totalMB: number, onStart: () => void, onSettings: () => void, note?: string, onBackground?: () => void): void {
    this.intro.textContent =
      `Loom runs three AI models directly on your GPU. The first visit downloads about ${formatBytes(totalMB * 1024 * 1024)} ` +
      'from Hugging Face; after that they are cached in your browser, so Loom starts in seconds and works with no internet at all.' +
      (note ? ` ${note}` : '');
    this.actions.replaceChildren(
      h('button', { class: 'btn btn-primary', onclick: onStart }, 'Download & start'),
      onBackground ? h('button', { class: 'btn', onclick: onBackground }, icon('download'), 'Download in the background') : '',
      h('button', { class: 'btn', onclick: onSettings }, 'Choose smaller models'),
    );
  }

  /** A background download is running: the tab can be closed. */
  showBackground(detail: string, fraction: number | null, background = true): void {
    this.heading.textContent = background ? 'Downloading in the background' : 'Downloading for offline use';
    this.intro.textContent = background
      ? 'You can close this tab — your browser keeps downloading and shows progress in its downloads bar. ' +
        'Come back any time: once everything is saved, Loom starts straight from this device, even offline.'
      : 'This browser can’t download with the tab closed, so keep this tab open until it finishes. ' +
        'Once everything is saved, Loom starts straight from this device, even offline.';
    this.list.hidden = true;
    const fill = h('span');
    fill.style.width = `${Math.round((fraction ?? 0) * 100)}%`;
    this.actions.replaceChildren(
      h('div', { class: 'bg-progress' }, h('div', { class: fraction === null ? 'bar indeterminate' : 'bar' }, fill), h('p', { class: 'stage-phase' }, detail)),
    );
  }

  showLoading(fromCache: boolean): void {
    this.list.hidden = false;
    this.heading.textContent = fromCache ? 'Starting Loom' : 'Downloading models';
    this.intro.textContent = fromCache
      ? 'Loading models from your browser cache and warming up the GPU. Anything the browser has evicted is downloaded again.'
      : 'This happens once. Keep this tab open — you can watch each model arrive below.';
    this.actions.replaceChildren();
  }

  progress(key: string, p: LoadProgress): void {
    this.rows.get(key)?.update(p);
  }

  status(key: string, status: StageStatus, text: string): void {
    this.rows.get(key)?.setStatus(status, text);
  }

  show(): void {
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
