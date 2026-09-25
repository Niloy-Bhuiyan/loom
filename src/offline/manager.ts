import { EMBED_MODEL } from '../config/models';
import type { Settings } from '../config/settings';
import { markModelsCached } from '../core/model-cache';
import type { ManifestFile } from './manifest.worker';
import { canDownloadInBackground, checkReadiness, downloadInBackground, downloadInPage, offlineFiles, resumeBackgroundDownload, type DownloadProgress } from './offline';
import { offlinePlan, type OfflinePlan } from './plan';

export type OfflineState =
  | { kind: 'checking' }
  | { kind: 'ready'; totalBytes: number }
  | { kind: 'missing'; cached: number; total: number; missingBytes: number; background: boolean }
  /** `totalBytes` is what this download has to fetch (0 if unknown). */
  | { kind: 'downloading'; downloadedBytes: number | null; totalBytes: number; background: boolean }
  | { kind: 'failed'; message: string }
  /** Can't tell (e.g. offline before anything was ever downloaded). */
  | { kind: 'unknown' };

/**
 * "Is this device ready to demo with the wifi off?" — and if not, get it
 * ready, ideally in the background so the tab can be closed.
 */
export class OfflineManager {
  private plan: OfflinePlan;
  private files: ManifestFile[] | null = null;
  private state: OfflineState = { kind: 'checking' };
  /** Bytes the current download has to fetch, for progress. */
  private downloadBytes = 0;

  constructor(
    settings: Settings,
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
    try {
      const { missing, missingBytes } = await checkReadiness(await this.resolveFiles());
      if (missing.length === 0) return void (await this.recheck());
      this.downloadBytes = missingBytes;
      const background = await canDownloadInBackground();
      this.progress({ downloaded: 0 }, background);

      const result = background ? await downloadInBackground(missing, (p) => this.progress(p, true)) : 'stalled';
      if (result === 'failed') throw new Error('The background download didn’t finish.');
      // No Background Fetch (or it never started): download here; the tab has to stay open.
      if (result === 'stalled') await downloadInPage(missing, (p) => this.progress(p, false));
      await this.recheck();
    } catch (err) {
      this.set({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async recheck(): Promise<OfflineState> {
    try {
      const { cached, total, missingBytes, totalBytes } = await checkReadiness(await this.resolveFiles());
      if (cached === total) {
        // Every model is on disk: skip the fast-start detour and first-run prompt from now on.
        markModelsCached(this.plan.models.map((m) => m.model).filter((m) => m !== EMBED_MODEL));
        this.set({ kind: 'ready', totalBytes });
      } else {
        this.set({ kind: 'missing', cached, total, missingBytes, background: await canDownloadInBackground() });
      }
    } catch {
      this.set({ kind: 'unknown' });
    }
    return this.state;
  }

  private async resolveFiles(): Promise<ManifestFile[]> {
    this.files ??= await offlineFiles(this.plan);
    return this.files;
  }

  private progress(p: DownloadProgress, background: boolean): void {
    this.set({ kind: 'downloading', downloadedBytes: p.downloaded, totalBytes: this.downloadBytes, background });
  }

  private set(state: OfflineState): void {
    this.state = state;
    this.onChange(state);
  }
}
