import logoUrl from '../assets/logo.svg';
import { h } from './dom';

/** The scrolling conversation log. Model and user text is only ever set via textContent. */
export class Transcript {
  readonly el: HTMLElement;
  private empty: HTMLElement;
  private streaming: { row: HTMLElement; bubble: HTMLElement } | null = null;

  constructor(empty: HTMLElement) {
    this.empty = empty;
    this.el = h('section', { class: 'transcript', 'aria-live': 'polite', 'aria-label': 'Conversation' }, empty);
  }

  addUser(text: string): void {
    this.append(h('div', { class: 'msg msg-user' }, h('div', { class: 'bubble' }, text)));
  }

  startAssistant(): void {
    this.endAssistant(false);
    const bubble = h('div', { class: 'bubble' });
    const row = h('div', { class: 'msg msg-ai thinking' }, h('img', { class: 'avatar', src: logoUrl, alt: 'Loom' }), bubble);
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

  addNotice(text: string, isError = false): void {
    this.append(h('div', { class: isError ? 'notice error' : 'notice', role: isError ? 'alert' : 'status' }, text));
  }

  private append(node: HTMLElement): void {
    this.empty.remove();
    this.el.append(node);
    this.scroll();
  }

  private scroll(): void {
    this.el.scrollTop = this.el.scrollHeight;
  }
}
