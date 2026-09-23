/**
 * Splits a stream of LLM tokens into speakable sentences so text-to-speech
 * can start on the first sentence while the model is still writing the rest.
 */

const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'approx']);

/** Buffers longer than this are split at the last comma/semicolon to keep latency low. */
const SOFT_LIMIT = 180;

export class SentenceChunker {
  private buffer = '';

  /** Add streamed text; returns any sentences that are now complete. */
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    let cut: number;
    while ((cut = findBoundary(this.buffer)) !== -1) {
      const sentence = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (sentence) out.push(sentence);
    }
    return out;
  }

  /** Return whatever is left once the stream has ended. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest ? [rest] : [];
  }
}

/** Index just past the first sentence boundary in `text`, or -1. */
function findBoundary(text: string): number {
  // A sentence ends at . ! ? or … (plus closing quotes/brackets/markdown) followed by
  // whitespace, or at a newline. Requiring trailing whitespace means we never
  // split "3.14" or a word that is still streaming in.
  const re = /[.!?…]+["'”’)\]*_]*(?=\s)|\n+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (match[0].startsWith('.') && isAbbreviation(text, match.index)) continue;
    if (text.slice(0, end).trim()) return end;
  }

  if (text.length > SOFT_LIMIT) {
    const soft = Math.max(text.lastIndexOf(', '), text.lastIndexOf('; '));
    if (soft > 0) return soft + 1;
  }
  return -1;
}

function isAbbreviation(text: string, dotIndex: number): boolean {
  const word = /([\w.]+)$/.exec(text.slice(0, dotIndex))?.[1]?.toLowerCase() ?? '';
  return ABBREVIATIONS.has(word) || /^[a-z]$/i.test(word);
}
