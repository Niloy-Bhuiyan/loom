import { describe, expect, it } from 'vitest';
import type { LlmPreset } from '../config/models';
import { pickDtype } from './transformers-llm';

const preset: LlmPreset = {
  id: 'x',
  label: 'X',
  model: 'org/x',
  approxMB: 1,
  dtypeF16: 'q4f16',
  dtypeF32: 'q4',
  note: '',
};

describe('pickDtype', () => {
  it('prefers f16 weights when the GPU supports shader-f16', () => {
    expect(pickDtype(preset, true)).toBe('q4f16');
  });

  it('falls back to f32 weights otherwise', () => {
    expect(pickDtype(preset, false)).toBe('q4');
  });

  it('throws when the model only ships f16 weights and the GPU lacks f16', () => {
    expect(() => pickDtype({ ...preset, dtypeF32: null }, false)).toThrow('shader-f16');
  });
});
