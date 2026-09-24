import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export const ACCEPTED_TYPES = '.pdf,.txt,.md,.markdown,.csv,application/pdf,text/plain,text/markdown';

/** Refuse very large files up front; a browser tab is not a document warehouse. */
const MAX_BYTES = 30 * 1024 * 1024;

export interface ExtractedDoc {
  text: string;
  /** Page count for PDFs. */
  pages: number | null;
}

/** Pull plain text out of a PDF or text file, entirely in the browser. */
export async function extractText(file: File, onProgress?: (fraction: number) => void): Promise<ExtractedDoc> {
  if (file.size > MAX_BYTES) throw new Error(`“${file.name}” is larger than 30 MB`);
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return { text: await file.text(), pages: null };

  // Loaded on demand so pdf.js (~1 MB) only downloads for people who use documents.
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join(''));
    onProgress?.(n / doc.numPages);
  }
  await doc.destroy();

  const text = pages.join('\n\n');
  if (!text.trim()) throw new Error(`No text found in “${file.name}”. Scanned PDFs (images of pages) aren’t supported yet.`);
  return { text, pages: doc.numPages };
}
