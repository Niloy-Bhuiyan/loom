import type { SavedChat } from '../chats/store';
import { timeAgo } from '../chats/time';
import { findMode } from '../config/modes';
import { h } from './dom';
import { icon } from './icons';

export interface ChatsDrawerOptions {
  chats: readonly SavedChat[];
  currentId: string | null;
  onNew(): void;
  onOpen(id: string): void;
  onDelete(id: string): void;
  onDeleteAll(): void;
}

/** Slide-in list of saved conversations. Titles are user text: textContent only. */
export function openChatsDrawer(opts: ChatsDrawerOptions): void {
  const close = () => overlay.remove();
  const list = h('ul', { class: 'chat-list' });
  const empty = h('p', { class: 'drawer-empty' }, 'No saved chats yet. Conversations are kept on this device only.');

  for (const chat of opts.chats) {
    const mode = findMode(chat.mode);
    const item = h('li', { class: chat.id === opts.currentId ? 'chat-item current' : 'chat-item' });
    const open = h(
      'button',
      { type: 'button', class: 'chat-open' },
      h('span', { class: 'chat-emoji', 'aria-hidden': 'true' }, mode.emoji),
      h('span', { class: 'chat-text' }, h('span', { class: 'chat-title' }, chat.title), h('span', { class: 'chat-meta' }, `${mode.label} · ${timeAgo(chat.updatedAt)}`)),
    );
    open.addEventListener('click', () => {
      close();
      opts.onOpen(chat.id);
    });
    const remove = h('button', { type: 'button', class: 'chat-delete', 'aria-label': `Delete “${chat.title}”`, title: 'Delete' }, icon('trash'));
    remove.addEventListener('click', () => {
      item.remove();
      if (!list.children.length) list.replaceWith(empty);
      opts.onDelete(chat.id);
    });
    item.append(open, remove);
    list.append(item);
  }

  const newChat = h('button', { type: 'button', class: 'btn btn-primary' }, icon('plus'), 'New chat');
  newChat.addEventListener('click', () => {
    close();
    opts.onNew();
  });
  const deleteAll = h('button', { type: 'button', class: 'btn btn-danger drawer-foot' }, icon('trash'), 'Delete all chats');
  deleteAll.addEventListener('click', () => {
    if (!confirm('Delete every saved chat from this browser?')) return;
    close();
    opts.onDeleteAll();
  });

  const overlay = h(
    'div',
    { class: 'drawer-overlay' },
    h(
      'aside',
      { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Your chats' },
      h('div', { class: 'drawer-head' }, h('h2', {}, 'Your chats'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close'))),
      newChat,
      opts.chats.length ? list : empty,
      opts.chats.length ? deleteAll : null,
      h('p', { class: 'drawer-note' }, icon('shield'), 'Saved in this browser only. Nothing is uploaded.'),
    ),
  );
  overlay.addEventListener('click', (e) => e.target === overlay && close());
  overlay.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Escape' && close());
  document.body.append(overlay);
  newChat.focus();
}
