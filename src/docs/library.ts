import type { ProgressListener } from '../pipeline/types';
import { WorkerClient } from '../workers/client';
import { chunkText } from './chunk';
import type { EmbedProgress, EmbedRequest, EmbedResult } from './embed.worker';
import { extractText } from './extract';
import { CONTEXT_CHARS, formatContext, topMatches, type IndexedPassage } from './search';

export interface LoadedDoc {
  id: string;
  name: string;
  pages: number | null;
  passages: number;
}

export type DocPhase = { step: 'reading' | 'understanding'; fraction: number };

/** How many passages to pull into each answer. */
const TOP_K = 4;

/**
 * The user's documents, indexed for retrieval. Everything — text extraction,
 * embeddings, search — runs on this device; files are never uploaded.
 */
export class DocumentLibrary {
  private docs = new Map<string, LoadedDoc>();
  private index: IndexedPassage[] = [];
  private embedder: WorkerClient<Record<string, never>, EmbedRequest, EmbedResult, EmbedProgress> | null = null;
  private embedderReady: Promise<void> | null = null;

  get list(): LoadedDoc[] {
    return [...this.docs.values()];
  }

  get isEmpty(): boolean {
    return this.docs.size === 0;
  }

  async add(file: File, onPhase: (p: DocPhase) => void, onModelProgress: ProgressListener): Promise<LoadedDoc> {
    onPhase({ step: 'reading', fraction: 0 });
    const [{ text, pages }] = await Promise.all([
      extractText(file, (fraction) => onPhase({ step: 'reading', fraction })),
      this.ensureEmbedder(onModelProgress),
    ]);

    const id = crypto.randomUUID();
    const passages = chunkText(id, text);
    if (passages.length === 0) throw new Error(`“${file.name}” doesn’t contain any readable text.`);

    onPhase({ step: 'understanding', fraction: 0 });
    const vectors = await this.embedder!.run({ texts: passages.map((p) => p.text) }, (done) =>
      onPhase({ step: 'understanding', fraction: done / passages.length }),
    );
    passages.forEach((p, i) => this.index.push({ ...p, vector: vectors[i]! }));

    const doc: LoadedDoc = { id, name: file.name, pages, passages: passages.length };
    this.docs.set(id, doc);
    return doc;
  }

  remove(id: string): void {
    this.docs.delete(id);
    this.index = this.index.filter((p) => p.docId !== id);
  }

  /** Excerpts relevant to `query`, formatted for the prompt; null when no documents are loaded. */
  async retrieve(query: string): Promise<string | null> {
    if (this.index.length === 0 || !this.embedder) return null;
    const names = new Map([...this.docs.values()].map((d) => [d.id, d.name]));

    // Short documents fit in the prompt whole — more reliable than any search.
    const totalChars = this.index.reduce((n, p) => n + p.text.length, 0);
    if (totalChars <= CONTEXT_CHARS) return formatContext(this.index.map((passage) => ({ passage, score: 1 })), names);

    const [vector] = await this.embedder.run({ texts: [query] });
    return formatContext(topMatches(vector!, query, this.index, TOP_K), names);
  }

  private ensureEmbedder(onProgress: ProgressListener): Promise<void> {
    if (!this.embedderReady) {
      this.embedder = new WorkerClient(new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module', name: 'loom-embed' }));
      this.embedderReady = this.embedder.load({}, onProgress).then(() => undefined);
      // Let a later attempt retry from scratch if loading failed.
      this.embedderReady.catch(() => {
        this.embedder?.terminate();
        this.embedder = null;
        this.embedderReady = null;
      });
    }
    return this.embedderReady;
  }
}
