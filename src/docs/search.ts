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

const STOPWORDS = new Set(
  'the and for are but not you your can what when where which who why how does did has have had was were will would could should this that these those with from into about there their them they its our out all any some just than then too very also only much many more most been being over such here'.split(
    ' ',
  ),
);

function terms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w)));
}

/** Fraction of the query's meaningful words that appear in the passage (0..1). */
export function keywordScore(query: string, text: string): number {
  const q = terms(query);
  if (q.size === 0) return 0;
  const t = terms(text);
  let hits = 0;
  for (const w of q) if (t.has(w)) hits++;
  return hits / q.size;
}

/**
 * Hybrid ranking: embeddings catch meaning ("closing time" ≈ "opens until 6"),
 * keywords catch exact terms that embeddings of mixed-topic passages miss
 * ("wifi password"). The best passage is always returned so the model can
 * answer — or say the documents don't cover it; the rest must clear `minScore`.
 */
export function topMatches(queryVector: Float32Array, query: string, index: readonly IndexedPassage[], k: number, minScore = 0.2): Match[] {
  const ranked = index
    .map((passage) => ({ passage, score: 0.65 * dot(queryVector, passage.vector) + 0.35 * keywordScore(query, passage.text) }))
    .sort((a, b) => b.score - a.score);
  return ranked.filter((m, i) => i === 0 || m.score >= minScore).slice(0, k);
}

/** Budget for excerpts in the prompt: small models slow down (and lose focus) with long prompts. */
export const CONTEXT_CHARS = 2200;

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
