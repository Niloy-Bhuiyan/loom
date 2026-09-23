export interface Capabilities {
  webgpu: boolean;
  /** GPU supports 16-bit floats in shaders, which lets us use smaller q4f16 weights. */
  shaderF16: boolean;
  microphone: boolean;
  secureContext: boolean;
  adapterName: string | null;
  /** Why WebGPU is unusable, when it is. */
  reason: string | null;
}

/**
 * Probe what this browser can do. Never throws: an unsupported browser gets a
 * friendly explanation instead of a crash.
 */
export async function detectCapabilities(nav: Navigator = navigator, secure = globalThis.isSecureContext): Promise<Capabilities> {
  const microphone = typeof nav.mediaDevices?.getUserMedia === 'function';
  const base = { microphone, secureContext: secure, shaderF16: false, adapterName: null };

  if (!secure) {
    return { ...base, webgpu: false, reason: 'insecure-context' };
  }
  if (!('gpu' in nav) || !nav.gpu) {
    return { ...base, webgpu: false, reason: 'no-webgpu' };
  }

  try {
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return { ...base, webgpu: false, reason: 'no-adapter' };
    }
    const info = adapter.info;
    const adapterName = [info?.vendor, info?.architecture || info?.description].filter(Boolean).join(' ') || null;
    return {
      ...base,
      webgpu: true,
      shaderF16: adapter.features.has('shader-f16'),
      adapterName,
      reason: null,
    };
  } catch {
    return { ...base, webgpu: false, reason: 'no-adapter' };
  }
}
