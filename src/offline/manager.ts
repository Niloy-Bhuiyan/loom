import { EMBED_MODEL, findLlm, findStt, SUPERTONIC_APPROX_MB } from '../config/models';
import type { Settings } from '../config/settings';
import { markModelsCached } from '../core/model-cache';
import { canDownloadInBackground, checkReadiness, downloadInBackground, downloadInPage, offlineUrls, resumeBackgroundDownload, type DownloadProgress } from './offline';
import { offlinePlan, type OfflinePlan } from './plan';

export type OfflineState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'missing'; cached: number; total: number; approxMB: number; background: boolean }
  | { kind: 'downloading'; downloadedBytes: number | null; approxMB: number; background: boolean }
  | { kind: 'failed'; message: string }
  /** Can't tell (e.g. offline before anything was ever downloaded). */
  | { kind: 'unknown' };

/** Rough size of everything in the plan, for "≈1.7 GB" style messages. */
function approxMB(settings: Settings): number {
  const runtime = 27;
  const embed = 23;
  const voice = settings.tts === 'supertonic' ? SUPERTONIC_APPROX_MB : 0;
  return findStt(settings.stt).approxMB + findLlm(settings.llm).approxMB + voice + embed + runtime;
}

/**
 * "Is this device ready to demo with the wifi off?" — and if not, get it
 * ready, ideally in the background so the tab can be closed.
 */
export class OfflineManager {
  private plan: OfflinePlan;
  private urls: string[] | null = null;
  private state: OfflineState = { kind: 'checking' };

  constructor(
    private settings: Settings,
    shaderF16: boolean,
    private onChange: (state: OfflineState) => void,
  ) {
    this.plan = offlinePlan(settings, shaderF16);
  }

  get current(): OfflineState {
    return this.state;
  }

  /** Check the cache (and pick up a background download already in flight). */
  async refresh(): Promise<OfflineState> {
    this.set({ kind: 'checking' });
    // If a background download is running (maybe started before a reload), follow it to the end first.
    const resumed = await resumeBackgroundDownload((p) => this.progress(p, true)).catch(() => null);
    if (resumed === 'failed') {
      this.set({ kind: 'failed', message: 'The background download didn’t finish.' });
      return this.state;
    }
    return this.recheck();
  }

  /** Download whatever is missing. Resolves when done (or failed). */
  async download(): Promise<void> {
    const urls = await this.resolveUrls();
    const { missing } = await checkReadiness(urls);
    if (missing.length === 0) return void (await this.recheck());
    const background = await canDownloadInBackground();
    this.progress({ downloaded: 0 }, background);
    try {
      if (background) {
        const result = await downloadInBackground(missing, (p) => this.progress(p, true));
        if (result === 'failed') throw new Error('The background download didn’t finish.');
      } else {
        await downloadInPage(missing, (p) => this.progress(p, false));
      }
      await this.recheck();
    } catch (err) {
      this.set({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async recheck(): Promise<OfflineState> {
    try {
      const urls = await this.resolveUrls();
      const { cached, total } = await checkReadiness(urls);
      if (cached === total) {
        // Every model is on disk: skip the fast-start detour and first-run prompt from now on.
        markModelsCached(this.plan.models.map((m) => m.model).filter((m) => m !== EMBED_MODEL));
        this.set({ kind: 'ready' });
      } else {
        this.set({ kind: 'missing', cached, total, approxMB: approxMB(this.settings), background: await canDownloadInBackground() });
      }
    } catch {
      this.set({ kind: 'unknown' });
    }
    return this.state;
  }

  private async resolveUrls(): Promise<string[]> {
    this.urls ??= await offlineUrls(this.plan);
    return this.urls;
  }

  private progress(p: DownloadProgress, background: boolean): void {
    this.set({ kind: 'downloading', downloadedBytes: p.downloaded, approxMB: approxMB(this.settings), background });
  }

  private set(state: OfflineState): void {
    this.state = state;
    this.onChange(state);
  }
}
