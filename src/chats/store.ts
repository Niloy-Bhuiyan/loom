import type { ChatMessage } from '../pipeline/types';

export interface SavedChat {
  id: string;
  title: string;
  mode: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = 'loom';
const STORE = 'chats';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Conversations saved in this browser's IndexedDB. Like everything else in
 * Loom they never leave the device; clearing site data removes them.
 */
export class ChatStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private factory: IDBFactory = indexedDB) {}

  async list(): Promise<SavedChat[]> {
    const chats = await request((await this.store('readonly')).getAll() as IDBRequest<SavedChat[]>);
    return chats.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<SavedChat | undefined> {
    return request((await this.store('readonly')).get(id) as IDBRequest<SavedChat | undefined>);
  }

  async save(chat: SavedChat): Promise<void> {
    await request((await this.store('readwrite')).put(chat));
  }

  async delete(id: string): Promise<void> {
    await request((await this.store('readwrite')).delete(id));
  }

  async clear(): Promise<void> {
    await request((await this.store('readwrite')).clear());
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db()).transaction(STORE, mode).objectStore(STORE);
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const open = this.factory.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'id' });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return this.dbPromise;
  }
}

/** A readable title from the first thing the user said. */
export function titleFor(messages: readonly ChatMessage[], max = 48): string {
  const first = messages.find((m) => m.role === 'user')?.content.replace(/\s+/g, ' ').trim();
  if (!first) return 'New chat';
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}
