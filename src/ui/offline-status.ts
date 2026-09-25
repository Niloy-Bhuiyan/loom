import { formatBytes } from '../core/progress';
import type { OfflineState } from '../offline/manager';
import { h } from './dom';
import { icon, type IconName } from './icons';

/** Sidebar row answering "can I demo this with the wifi off right now?" */
export function renderOfflineStatus(container: HTMLElement, state: OfflineState, onDownload: () => void): void {
  container.dataset.state = state.kind;
  container.hidden = state.kind === 'unknown';

  const row = (iconName: IconName, title: string, detail: string, action?: HTMLElement) =>
    container.replaceChildren(
      h('span', { class: 'offline-icon' }, icon(iconName)),
      h('span', { class: 'offline-text' }, h('strong', {}, title), h('span', {}, detail)),
      action ?? '',
    );
  const button = (label: string) => h('button', { type: 'button', class: 'offline-action', onclick: onDownload }, label);

  switch (state.kind) {
    case 'checking':
      return row('shield', 'Checking offline readiness…', 'Looking in this browser’s cache');
    case 'ready':
      return row('check', 'Ready for offline', `All ${formatBytes(state.totalBytes)} of models saved on this device`);
    case 'missing':
      return row(
        'download',
        'Not ready for offline',
        `${state.cached} of ${state.total} files saved · ${formatBytes(state.missingBytes)} to go`,
        button(state.background ? 'Get ready' : 'Download'),
      );
    case 'downloading': {
      const done = state.downloadedBytes
        ? `${formatBytes(state.downloadedBytes)}${state.totalBytes ? ` of ${formatBytes(state.totalBytes)}` : ''}`
        : 'Starting…';
      return row('download', 'Saving for offline…', `${done} · ${state.background ? 'you can close this tab' : 'keep this tab open'}`);
    }
    case 'failed':
      return row('alert', 'Download interrupted', 'Files that arrived are kept', button('Resume'));
    case 'unknown':
      return container.replaceChildren();
  }
}
