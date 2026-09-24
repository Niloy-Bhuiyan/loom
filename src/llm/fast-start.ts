import { findLlm, LIGHTEST_LLM, type LlmPreset } from '../config/models';

export interface BrainPlan {
  /** Model to load before the user can talk. */
  initial: LlmPreset;
  /** Bigger model to fetch in the background and swap in, if any. */
  upgradeTo: LlmPreset | null;
}

/**
 * Fast start: if the chosen brain isn't downloaded yet and a lighter one
 * exists, start with the light one so the first conversation is minutes
 * (not a multi-GB download) away, and upgrade in the background.
 */
export function planBrain(chosenId: string, isCached: (model: string) => boolean): BrainPlan {
  const chosen = findLlm(chosenId);
  const light = findLlm(LIGHTEST_LLM);
  if (chosen.id === light.id || isCached(chosen.model)) return { initial: chosen, upgradeTo: null };
  return { initial: light, upgradeTo: chosen };
}
