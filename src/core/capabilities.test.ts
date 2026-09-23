import { describe, expect, it } from 'vitest';
import { detectCapabilities } from './capabilities';

const mic = { mediaDevices: { getUserMedia: () => Promise.resolve() } };

function fakeNavigator(gpu: unknown): Navigator {
  return { ...mic, gpu } as unknown as Navigator;
}

function fakeAdapter(features: string[]) {
  return {
    features: new Set(features),
    info: { vendor: 'acme', architecture: 'rdna9', description: '' },
  };
}

describe('detectCapabilities', () => {
  it('reports an insecure context first', async () => {
    const caps = await detectCapabilities(fakeNavigator(undefined), false);
    expect(caps).toMatchObject({ webgpu: false, reason: 'insecure-context' });
  });

  it('reports missing WebGPU', async () => {
    const caps = await detectCapabilities(fakeNavigator(undefined), true);
    expect(caps).toMatchObject({ webgpu: false, reason: 'no-webgpu', microphone: true });
  });

  it('reports when no adapter is available', async () => {
    const caps = await detectCapabilities(fakeNavigator({ requestAdapter: async () => null }), true);
    expect(caps).toMatchObject({ webgpu: false, reason: 'no-adapter' });
  });

  it('treats a throwing requestAdapter as no adapter', async () => {
    const gpu = { requestAdapter: async () => { throw new Error('blocked'); } };
    const caps = await detectCapabilities(fakeNavigator(gpu), true);
    expect(caps).toMatchObject({ webgpu: false, reason: 'no-adapter' });
  });

  it('detects WebGPU with shader-f16', async () => {
    const gpu = { requestAdapter: async () => fakeAdapter(['shader-f16']) };
    const caps = await detectCapabilities(fakeNavigator(gpu), true);
    expect(caps).toMatchObject({ webgpu: true, shaderF16: true, adapterName: 'acme rdna9', reason: null });
  });

  it('detects WebGPU without shader-f16', async () => {
    const gpu = { requestAdapter: async () => fakeAdapter([]) };
    expect((await detectCapabilities(fakeNavigator(gpu), true)).shaderF16).toBe(false);
  });
});
