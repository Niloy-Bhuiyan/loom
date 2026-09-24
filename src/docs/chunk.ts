export interface Passage {
  /** Which document it came from. */
  docId: string;
  text: string;
}

/** ~150–200 tokens: small enough that a few fit in a small model's prompt. */
const TARGET = 700;
/** Carried over between passages so an answer split across a boundary still matches. */
const OVERLAP = 120;

/**
 * Split a document into overlapping passages, preferring paragraph and
 * sentence boundaries so each passage reads naturally.
 */
export function chunkText(docId: string, text: string, target = TARGET, overlap = OVERLAP): Passage[] {
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];

  const passages: Passage[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + target);
    if (end < clean.length) end = bestBreak(clean, start, end);
    const piece = clean.slice(start, end).trim();
    if (piece) passages.push({ docId, text: piece });
    if (end >= clean.length) break;
    // Step back for overlap, but always move forward, and start on a word boundary.
    let next = Math.max(end - overlap, start + 1);
    const space = clean.indexOf(' ', next);
    if (space !== -1 && space < end) next = space + 1;
    start = next;
  }
  return passages;
}

/** The last paragraph, sentence or word break in the back half of [start, end). */
function bestBreak(text: string, start: number, end: number): number {
  const window = text.slice(start, end);
  const min = Math.floor(window.length / 2);
  for (const pattern of [/\n\n/g, /[.!?]\s/g, /\s/g]) {
    let best = -1;
    for (const m of window.matchAll(pattern)) if (m.index! >= min) best = m.index! + m[0].length;
    if (best !== -1) return start + best;
  }
  return end;
}
