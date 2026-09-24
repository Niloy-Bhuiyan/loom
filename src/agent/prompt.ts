import type { ChatMessage } from '../pipeline/types';

export const SYSTEM_PROMPT = [
  'You are Loom, a friendly voice assistant.',
  'You run entirely on the user’s own device, inside their web browser: no internet connection and no cloud servers are involved, and nothing they say leaves their computer.',
  'Your replies are spoken aloud, so talk like a person in a conversation:',
  'keep answers short (one to three sentences unless asked for more), use plain words,',
  'and never use markdown, bullet points, code blocks, emoji or URLs.',
  'You have no access to the internet, the current date or real-time information; say so briefly if asked.',
].join(' ');

/** How many past messages to keep. Small models have small context windows and slow down with long prompts. */
export const MAX_HISTORY_MESSAGES = 12;

export interface PromptOptions {
  system?: string;
  /** Excerpts from the user's documents relevant to their latest message. */
  context?: string | null;
}

export function buildMessages(history: readonly ChatMessage[], { system = SYSTEM_PROMPT, context }: PromptOptions = {}): ChatMessage[] {
  let recent = history.slice(-MAX_HISTORY_MESSAGES);
  // Chat templates expect the first turn after the system prompt to be the user's.
  while (recent[0] && recent[0].role !== 'user') recent = recent.slice(1);

  const last = recent.at(-1);
  if (context && last?.role === 'user') {
    // Only the prompt sees the excerpts; the stored history keeps the user's own words.
    recent = [
      ...recent.slice(0, -1),
      {
        role: 'user',
        content:
          `Excerpts from my documents:\n\n${context}\n\n` +
          `Using these excerpts (and saying so if they don't contain the answer), reply to: ${last.content}`,
      },
    ];
  }
  return [{ role: 'system', content: system }, ...recent];
}
