import { describe, expect, it } from 'vitest';
import { findLlm, LIGHTEST_LLM } from '../config/models';
import { planBrain } from './fast-start';

const light = findLlm(LIGHTEST_LLM);
const big = findLlm('qwen2.5-1.5b');

describe('planBrain', () => {
  it('starts light and upgrades when the chosen brain is not downloaded', () => {
    expect(planBrain(big.id, () => false)).toEqual({ initial: light, upgradeTo: big });
  });

  it('loads the chosen brain directly once it is cached', () => {
    expect(planBrain(big.id, (m) => m === big.model)).toEqual({ initial: big, upgradeTo: null });
  });

  it('never upgrades when the light brain was chosen', () => {
    expect(planBrain(light.id, () => false)).toEqual({ initial: light, upgradeTo: null });
  });
});
