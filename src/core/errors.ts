export type ErrorKind = 'out-of-memory' | 'network' | 'storage' | 'gpu' | 'microphone' | 'unknown';

export interface FriendlyError {
  kind: ErrorKind;
  title: string;
  detail: string;
  /** Loading a smaller model is likely to fix it. */
  suggestSmallerModel: boolean;
  /** The raw message, for the "technical details" disclosure. */
  raw: string;
}

const PATTERNS: [ErrorKind, RegExp][] = [
  ['microphone', /NotAllowedError|Permission denied|NotFoundError|Requested device not found|NotReadableError/i],
  ['storage', /QuotaExceeded|quota/i],
  ['out-of-memory', /out of memory|\boom\b|bad_alloc|failed to allocate|allocation failed|array buffer allocation|memory access out of bounds|device (?:was )?lost|mapAsync|too large/i],
  ['network', /failed to fetch|networkerror|network error|load failed|err_internet_disconnected|err_network|could not locate file|offline/i],
  ['gpu', /webgpu|gpuadapter|gpu device|shader|no available backend|jsep/i],
];

/** Turn a raw error from model loading or inference into something a person can act on. */
export function toFriendlyError(error: unknown): FriendlyError {
  const raw = errorMessage(error);
  const kind = PATTERNS.find(([, re]) => re.test(raw))?.[0] ?? 'unknown';
  return { ...COPY[kind], kind, raw };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

const COPY: Record<ErrorKind, Omit<FriendlyError, 'kind' | 'raw'>> = {
  'out-of-memory': {
    title: 'Your GPU ran out of memory',
    detail: 'This model is too big for the graphics memory available right now. Try the lighter model, or close other GPU-heavy tabs and apps.',
    suggestSmallerModel: true,
  },
  network: {
    title: 'Couldn’t download the models',
    detail: 'Loom needs an internet connection once, to download the models. After that they are cached and everything works offline.',
    suggestSmallerModel: false,
  },
  storage: {
    title: 'Not enough browser storage',
    detail: 'The browser refused to cache the models. Free up disk space or clear storage for other sites, then reload.',
    suggestSmallerModel: true,
  },
  gpu: {
    title: 'WebGPU hit a problem',
    detail: 'The GPU backend failed to start. Updating your browser and graphics drivers usually helps; a lighter model may also work.',
    suggestSmallerModel: true,
  },
  microphone: {
    title: 'Microphone unavailable',
    detail: 'Loom needs microphone access to hear you. Allow it in the address bar’s site settings and make sure a mic is connected.',
    suggestSmallerModel: false,
  },
  unknown: {
    title: 'Something went wrong',
    detail: 'An unexpected error occurred while running the models locally. Reloading usually helps; if not, try the lighter model.',
    suggestSmallerModel: true,
  },
};
