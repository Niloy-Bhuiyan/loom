import type { ChatMessage } from '../pipeline/types';
import { h } from './dom';
import { faceSvg } from './face';

/** The scrolling conversation log. Model and user text is only ever set via textContent. */
export class Transcript {
  readonly el: HTMLElement;
  private thread: HTMLElement;
  private empty: HTMLElement;
  private streaming: { row: HTMLElement; bubble: HTMLElement } | null = null;
  private lastUser: HTMLElement | null = null;
  /** Colour of Loom's face next to its replies (follows the current mode). */
  private avatarColor = 'var(--ink)';

  constructor(empty: HTMLElement) {
    this.empty = empty;
    this.thread = h('div', { class: 'thread' }, empty);
    this.el = h('section', { class: 'transcript', 'aria-live': 'polite', 'aria-label': 'Conversation' }, this.thread);
  }

  setAvatarColor(color: string): void {
    this.avatarColor = color;
  }

  addUser(text: string): void {
    this.lastUser = h('div', { class: 'msg msg-user' }, h('div', { class: 'bubble' }, text));
    this.append(this.lastUser);
  }

  /** Remove the latest user message and everything after it (the user was only pausing). */
  retractLastUser(): void {
    if (!this.lastUser) return;
    this.streaming = null;
    while (this.lastUser.nextSibling) this.lastUser.nextSibling.remove();
    this.lastUser.remove();
    this.lastUser = null;
  }

  startAssistant(): void {
    this.endAssistant(false);
    const bubble = h('div', { class: 'bubble' });
    const row = h('div', { class: 'msg msg-ai thinking' }, h('span', { class: 'avatar' }, faceSvg(this.avatarColor, 28)), bubble);
    this.streaming = { row, bubble };
    this.append(row);
  }

  appendAssistant(text: string): void {
    if (!this.streaming) return;
    const { row, bubble } = this.streaming;
    row.classList.replace('thinking', 'streaming');
    // Leading whitespace from the first tokens looks odd in a bubble.
    bubble.textContent = (bubble.textContent + text).trimStart();
    this.scroll();
  }

  endAssistant(interrupted: boolean): void {
    if (!this.streaming) return;
    const { row, bubble } = this.streaming;
    row.classList.remove('thinking', 'streaming');
    if (interrupted) row.classList.add('interrupted');
    if (!bubble.textContent) row.remove();
    this.streaming = null;
  }

  /** Back to the empty welcome state. */
  clear(): void {
    this.streaming = null;
    this.lastUser = null;
    this.thread.replaceChildren(this.empty);
  }

  /** Show a saved conversation. */
  showHistory(messages: readonly ChatMessage[]): void {
    this.clear();
    for (const m of messages) {
      if (m.role === 'user') this.addUser(m.content);
      else if (m.role === 'assistant') {
        this.startAssistant();
        this.appendAssistant(m.content);
        this.endAssistant(false);
      }
    }
  }

  addNotice(text: string, isError = false): void {
    this.append(h('div', { class: isError ? 'notice error' : 'notice', role: isError ? 'alert' : 'status' }, text));
  }

  private append(node: HTMLElement): void {
    this.empty.remove();
    this.thread.append(node);
    this.scroll();
  }

  private scroll(): void {
    this.el.scrollTop = this.el.scrollHeight;
  }
}
