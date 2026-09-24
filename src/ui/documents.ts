import type { LoadedDoc } from '../docs/library';
import { ACCEPTED_TYPES } from '../docs/extract';
import { h } from './dom';
import { icon } from './icons';

export interface DocumentsHandlers {
  onFiles(files: File[]): void;
  onRemove(id: string): void;
}

/**
 * Attach button, drag-and-drop target and the strip of loaded documents.
 * File names are user data, so they're only ever set via textContent.
 */
export class DocumentsUi {
  readonly strip: HTMLElement;
  readonly attachButton: HTMLButtonElement;
  private input: HTMLInputElement;
  private dropHint: HTMLElement;
  private progress: HTMLElement | null = null;

  constructor(private handlers: DocumentsHandlers) {
    this.strip = h('div', { class: 'docs', 'aria-label': 'Your documents', hidden: true });
    this.input = h('input', { type: 'file', accept: ACCEPTED_TYPES, multiple: true, hidden: true });
    this.input.addEventListener('change', () => {
      if (this.input.files?.length) handlers.onFiles([...this.input.files]);
      this.input.value = '';
    });
    this.attachButton = h(
      'button',
      { type: 'button', class: 'attach-btn', 'aria-label': 'Add a document', title: 'Add a PDF or text file — it stays on this device' },
      icon('paperclip'),
    );
    this.attachButton.addEventListener('click', () => this.input.click());

    this.dropHint = h(
      'div',
      { class: 'drop-hint', hidden: true },
      h('div', {}, icon('file'), h('strong', {}, 'Drop to read it privately'), h('span', {}, 'The file is read on this device and never uploaded.')),
    );
  }

  /** Enable drag-and-drop over the whole page. */
  mount(root: HTMLElement): void {
    root.append(this.input, this.dropHint);
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      this.dropHint.hidden = false;
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) this.dropHint.hidden = true;
    });
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      this.dropHint.hidden = true;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) this.handlers.onFiles(files);
    });
  }

  setEnabled(enabled: boolean): void {
    this.attachButton.disabled = !enabled;
  }

  render(docs: readonly LoadedDoc[]): void {
    const chips = docs.map((doc) => {
      const meta = doc.pages ? `${doc.pages} page${doc.pages === 1 ? '' : 's'}` : `${doc.passages} passage${doc.passages === 1 ? '' : 's'}`;
      return h(
        'span',
        { class: 'doc-chip', title: doc.name },
        icon('file'),
        h('span', { class: 'doc-name' }, doc.name),
        h('span', { class: 'doc-meta' }, meta),
        h('button', { type: 'button', 'aria-label': `Remove ${doc.name}`, onclick: () => this.handlers.onRemove(doc.id) }, icon('close')),
      );
    });
    this.strip.replaceChildren(...chips, ...(this.progress ? [this.progress] : []));
    this.strip.hidden = chips.length === 0 && !this.progress;
  }

  /** Show (or with null, clear) the "reading a file" indicator. */
  showProgress(text: string | null, docs: readonly LoadedDoc[]): void {
    this.progress = text ? h('span', { class: 'doc-chip busy' }, icon('file'), h('span', { class: 'doc-name' }, text)) : null;
    this.render(docs);
  }
}
