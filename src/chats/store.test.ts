import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { ChatStore, titleFor, type SavedChat } from './store';

const chat = (id: string, updatedAt: number, text = 'Hello'): SavedChat => ({
  id,
  title: text,
  mode: 'assistant',
  messages: [{ role: 'user', content: text }],
  createdAt: 0,
  updatedAt,
});

describe('ChatStore', () => {
  it('saves, lists newest first, and deletes chats', async () => {
    const store = new ChatStore(new IDBFactory());
    await store.save(chat('a', 1));
    await store.save(chat('b', 3));
    await store.save(chat('c', 2));
    expect((await store.list()).map((c) => c.id)).toEqual(['b', 'c', 'a']);

    await store.delete('c');
    expect((await store.list()).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('updates a chat in place', async () => {
    const store = new ChatStore(new IDBFactory());
    await store.save(chat('a', 1, 'first'));
    await store.save(chat('a', 2, 'second'));
    const saved = await store.get('a');
    expect(saved?.messages[0]?.content).toBe('second');
    expect(await store.list()).toHaveLength(1);
  });

  it('clears everything', async () => {
    const store = new ChatStore(new IDBFactory());
    await store.save(chat('a', 1));
    await store.clear();
    expect(await store.list()).toEqual([]);
  });
});

describe('titleFor', () => {
  it('uses the first user message', () => {
    expect(titleFor([{ role: 'assistant', content: 'Hi!' }, { role: 'user', content: '  What is   the weather? ' }])).toBe('What is the weather?');
  });

  it('truncates long titles', () => {
    const title = titleFor([{ role: 'user', content: 'a'.repeat(100) }], 20);
    expect(title).toHaveLength(20);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back when nothing has been said yet', () => {
    expect(titleFor([])).toBe('New chat');
  });
});
