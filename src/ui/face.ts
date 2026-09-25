/**
 * Loom's mascot: a round face with two eyes and a small smile.
 * Used as the logo, as mode avatars, and — animated —
 * as the voice orb that shows whether Loom is listening, thinking or talking.
 */

const NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** A static face, e.g. for avatars. `color` is the face; eyes/smile use `--face-ink`. */
export function faceSvg(color: string, size: number, label?: string): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 40 40', width: size, height: size, class: 'face' });
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  svg.style.setProperty('--face', color);
  // The theme-ink face flips between black and white, so its eyes flip too.
  if (color.includes('--ink')) svg.classList.add('face-ink');
  svg.append(
    svgEl('circle', { cx: 20, cy: 20, r: 20, class: 'face-bg' }),
    svgEl('ellipse', { cx: 14.5, cy: 17, rx: 2.4, ry: 3.3, class: 'face-eye' }),
    svgEl('ellipse', { cx: 25.5, cy: 17, rx: 2.4, ry: 3.3, class: 'face-eye' }),
    svgEl('path', { d: 'M13.5 25.5q6.5 4.5 13 0', class: 'face-smile' }),
  );
  return svg;
}

export type FaceMood = 'idle' | 'standby' | 'listening' | 'thinking' | 'speaking';

/**
 * The animated voice orb. Eyes blink now and then, drift while thinking,
 * widen while listening; the whole face bobs with Loom's voice level.
 */
export class LiveFace {
  readonly el: SVGSVGElement;
  private eyes: SVGEllipseElement[];
  private smile: SVGPathElement;
  private mood: FaceMood = 'idle';
  private raf = 0;
  private nextBlink = performance.now() + 2500;

  constructor(private level: () => number) {
    this.el = faceSvg('var(--ink)', 96);
    this.el.classList.add('live-face');
    this.eyes = [...this.el.querySelectorAll('ellipse')] as SVGEllipseElement[];
    this.smile = this.el.querySelector('path')!;
  }

  setMood(mood: FaceMood): void {
    this.mood = mood;
    this.el.dataset.mood = mood;
  }

  start(): void {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const frame = (now: number) => {
      this.draw(now, reduce.matches);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private draw(now: number, reduceMotion: boolean): void {
    const t = now / 1000;
    let lookX = 0;
    let lookY = 0;
    let eyeScale = 1;
    let bob = 0;
    let smile = 0;

    switch (this.mood) {
      case 'thinking':
        // Eyes wander up and around, as if considering.
        lookX = Math.sin(t * 1.7) * 2.2;
        lookY = -1.6 + Math.cos(t * 1.3) * 0.8;
        break;
      case 'listening':
        eyeScale = 1.18;
        lookY = -0.4;
        break;
      case 'speaking': {
        const level = this.level();
        bob = -level * 2.5;
        smile = Math.min(1, level * 3);
        break;
      }
      case 'standby':
        lookX = Math.sin(t * 0.6) * 0.8;
        break;
    }

    // Blink every few seconds (quick close/open), never while listening intently.
    let blink = 1;
    if (!reduceMotion && this.mood !== 'listening') {
      const since = now - this.nextBlink;
      if (since > 0) {
        blink = since < 90 ? 1 - since / 90 : since < 180 ? (since - 90) / 90 : 1;
        if (since >= 180) this.nextBlink = now + 2500 + Math.random() * 3000;
      }
    }
    if (reduceMotion) {
      lookX = 0;
      lookY = 0;
      bob = 0;
    }

    const ry = 3.3 * eyeScale * Math.max(0.08, blink);
    this.eyes.forEach((eye, i) => {
      eye.setAttribute('cx', String((i === 0 ? 14.5 : 25.5) + lookX));
      eye.setAttribute('cy', String(17 + lookY + bob * 0.3));
      eye.setAttribute('ry', ry.toFixed(2));
      eye.setAttribute('rx', String(2.4 * eyeScale));
    });
    // Smile opens a little while talking.
    const dip = 4.5 + smile * 3;
    this.smile.setAttribute('d', `M13.5 ${25.5 + bob * 0.3}q6.5 ${dip} 13 0`);
    this.el.style.transform = `translateY(${bob}px)`;
  }
}
