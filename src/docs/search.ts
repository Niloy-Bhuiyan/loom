import type { Passage } from './chunk';

export interface IndexedPassage extends Passage {
  /** Unit-length embedding, so cosine similarity is a dot product. */
  vector: Float32Array;
}

export interface Match {
  passage: IndexedPassage;
  score: number;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** The `k` passages most similar to the query, best first, ignoring weak matches. */
export function topMatches(query: Float32Array, index: readonly IndexedPassage[], k: number, minScore = 0.2): Match[] {
  return index
    .map((passage) => ({ passage, score: dot(query, passage.vector) }))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Budget for excerpts in the prompt: small models slow down (and lose focus) with long prompts. */
const CONTEXT_CHARS = 2200;

/** Turn matches (best first) into prompt text, trimmed to the budget. */
export function formatContext(matches: readonly Match[], names: ReadonlyMap<string, string>, budget = CONTEXT_CHARS): string {
  const chosen: Match[] = [];
  let used = 0;
  for (const m of matches) {
    if (used + m.passage.text.length > budget && chosen.length > 0) break;
    chosen.push(m);
    used += m.passage.text.length;
  }
  return chosen.map((m) => `[From “${names.get(m.passage.docId) ?? 'document'}”]\n${m.passage.text}`).join('\n\n');
}
