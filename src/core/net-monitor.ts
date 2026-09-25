export interface NetRequest {
  url: string;
  at: number;
}

/**
 * Counts every request that actually reaches the network, so the UI can show
 * that a conversation with Loom uses none.
 *
 * With the service worker active (production builds) it sees everything —
 * the page and all model workers — and reports via BroadcastChannel. Without
 * it (dev server), we fall back to the page's own resource timing entries.
 */
export class NetMonitor {
  private requests: NetRequest[] = [];
  private since = 0;
  private listeners = new Set<() => void>();

  start(): void {
    if (navigator.serviceWorker?.controller) {
      const channel = new BroadcastChannel('loom-network');
      channel.onmessage = (e: MessageEvent<NetRequest>) => this.record(e.data.url, e.data.at);
    } else if ('PerformanceObserver' in window) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) this.record(entry.name, performance.timeOrigin + entry.startTime);
      }).observe({ type: 'resource', buffered: false });
    }
  }

  /** Start counting from now (called once the models are loaded). */
  markReady(): void {
    this.since = Date.now();
    this.requests = [];
    this.emit();
  }

  get ready(): boolean {
    return this.since > 0;
  }

  /** Requests since markReady(), oldest first. */
  get sinceReady(): readonly NetRequest[] {
    return this.requests;
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private record(url: string, at: number): void {
    // Blob/data URLs never leave the device.
    if (!this.since || at < this.since || !/^https?:/.test(url)) return;
    this.requests.push({ url, at });
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
