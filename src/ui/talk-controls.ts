export interface TalkHandlers {
  start(): void;
  stop(): void;
  /** Esc: stop whatever Loom is doing. */
  cancel(): void;
  isListening(): boolean;
}

/** Presses shorter than this are "taps" that toggle recording; longer ones are push-to-talk. */
const HOLD_MS = 350;

/**
 * One button, two gestures:
 *  - press and hold → talk while held (push-to-talk)
 *  - quick tap → start; tap again to send (tap-to-talk)
 * Plus keyboard: hold Space to talk, Esc to interrupt.
 */
export function bindTalkControls(button: HTMLButtonElement, handlers: TalkHandlers): void {
  let pressedAt: number | null = null;

  button.addEventListener('pointerdown', (e) => {
    if (button.disabled || e.button !== 0) return;
    e.preventDefault();
    if (handlers.isListening()) {
      // Second tap in tap-to-talk mode.
      pressedAt = null;
      handlers.stop();
      return;
    }
    button.setPointerCapture(e.pointerId);
    pressedAt = performance.now();
    handlers.start();
  });

  const release = () => {
    if (pressedAt === null) return;
    const held = performance.now() - pressedAt;
    pressedAt = null;
    if (held >= HOLD_MS) handlers.stop();
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  // Keyboard/assistive "click" without pointer events.
  button.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    if (handlers.isListening()) handlers.stop();
    else handlers.start();
  });

  const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
  let spaceDown = false;

  window.addEventListener('keydown', (e) => {
    if (typing(e) || button.disabled) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat || spaceDown) return;
      spaceDown = true;
      handlers.start();
    } else if (e.code === 'Escape') {
      handlers.cancel();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || !spaceDown) return;
    // Otherwise a focused button would also receive a synthetic click and restart recording.
    e.preventDefault();
    spaceDown = false;
    handlers.stop();
  });
}
