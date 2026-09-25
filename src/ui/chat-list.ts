import type { SavedChat } from '../chats/store';
import { timeAgo } from '../chats/time';
import { findMode } from '../config/modes';
import { h } from './dom';
import { faceSvg } from './face';
import { icon } from './icons';

export interface ChatListHandlers {
  onOpen(id: string): void;
  onDelete(id: string): void;
}

/** Saved conversations in the sidebar. Titles are user text: set via textContent only. */
export function renderChatList(container: HTMLElement, chats: readonly SavedChat[], currentId: string | null, handlers: ChatListHandlers): void {
  if (chats.length === 0) {
    container.replaceChildren(h('p', { class: 'chat-empty' }, 'Your conversations will appear here.'));
    return;
  }
  container.replaceChildren(
    ...chats.map((chat) => {
      const mode = findMode(chat.mode);
      return h(
        'div',
        { class: 'chat-item', 'aria-current': chat.id === currentId ? 'true' : undefined },
        h(
          'button',
          { type: 'button', class: 'chat-open', onclick: () => handlers.onOpen(chat.id) },
          faceSvg(mode.color, 32),
          h('span', { class: 'chat-text' }, h('span', { class: 'chat-title-text' }, chat.title), h('span', { class: 'chat-meta' }, mode.label)),
          h('span', { class: 'chat-time' }, timeAgo(chat.updatedAt)),
        ),
        h(
          'button',
          { type: 'button', class: 'chat-delete', 'aria-label': `Delete “${chat.title}”`, title: 'Delete', onclick: () => handlers.onDelete(chat.id) },
          icon('trash'),
        ),
      );
    }),
  );
}
