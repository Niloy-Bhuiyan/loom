import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../pipeline/types';
import { buildMessages, MAX_HISTORY_MESSAGES } from './prompt';

const turn = (i: number): ChatMessage[] => [
  { role: 'user', content: `q${i}` },
  { role: 'assistant', content: `a${i}` },
];

describe('buildMessages', () => {
  it('prepends the system prompt', () => {
    const msgs = buildMessages([{ role: 'user', content: 'hi' }], { system: 'SYS' });
    expect(msgs).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('keeps only the most recent messages', () => {
    const history = Array.from({ length: 20 }, (_, i) => turn(i)).flat();
    const msgs = buildMessages(history, { system: 'SYS' });
    expect(msgs).toHaveLength(MAX_HISTORY_MESSAGES + 1);
    expect(msgs.at(-1)?.content).toBe('a19');
  });

  it('never starts the history with an assistant message', () => {
    const history = [...turn(0), ...turn(1), { role: 'user', content: 'q2' } as ChatMessage];
    const msgs = buildMessages(history.slice(1), { system: 'SYS' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'q1' });
  });

  it('wraps only the latest question with document excerpts', () => {
    const history: ChatMessage[] = [...turn(0), { role: 'user', content: 'What was revenue?' }];
    const msgs = buildMessages(history, { system: 'SYS', context: '[From “r.pdf”]\nRevenue was $5M.' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'q0' });
    expect(msgs.at(-1)?.content).toContain('Revenue was $5M.');
    expect(msgs.at(-1)?.content).toContain('reply to: What was revenue?');
    expect(history.at(-1)?.content).toBe('What was revenue?');
  });

  it('ignores empty context', () => {
    const msgs = buildMessages([{ role: 'user', content: 'hi' }], { system: 'SYS', context: null });
    expect(msgs.at(-1)).toEqual({ role: 'user', content: 'hi' });
  });
});
