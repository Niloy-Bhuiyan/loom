import { h } from './dom';
import { icon } from './icons';

export interface SpeedCardData {
  tokensPerSecond: number;
  /** From the user finishing to Loom starting to speak. */
  replyStartMs: number | null;
  gpu: string;
  brain: string;
}

const W = 1200;
const H = 630;
const FONT = '"Geist Variable", ui-sans-serif, system-ui, sans-serif';

/** Loom's face, drawn with canvas paths (same geometry as the SVG mascot). */
function drawFace(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, ink: string): void {
  const s = size / 40;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(20, 20, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink;
  for (const cx of [14.5, 25.5]) {
    ctx.beginPath();
    ctx.ellipse(cx, 17, 2.4, 3.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(13.5, 25.5);
  ctx.quadraticCurveTo(20, 30, 26.5, 25.5);
  ctx.stroke();
  ctx.restore();
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): number {
  ctx.font = `500 26px ${FONT}`;
  const w = ctx.measureText(text).width + 44;
  ctx.fillStyle = '#f2f1ef';
  ctx.beginPath();
  ctx.roundRect(x, y, w, 52, 26);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.fillText(text, x + 22, y + 35);
  return w;
}

/** A shareable 1200×630 PNG: "My laptop runs AI fully offline — N tokens/s". */
export async function renderSpeedCard(data: SpeedCardData): Promise<Blob> {
  await Promise.all([document.fonts.load(`600 80px ${FONT}`), document.fonts.load(`400 26px ${FONT}`)]).catch(() => {});
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Brand
  drawFace(ctx, 72, 64, 52, '#111110', '#ffffff');
  ctx.fillStyle = '#0a0a0a';
  ctx.font = `600 36px ${FONT}`;
  ctx.fillText('Loom', 140, 102);
  ctx.font = `500 22px ${FONT}`;
  ctx.fillStyle = '#12a150';
  ctx.beginPath();
  ctx.arc(W - 262, 91, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5f636a';
  ctx.fillText('100% local · offline', W - 244, 99);

  // Headline
  ctx.fillStyle = '#0a0a0a';
  ctx.font = `500 64px ${FONT}`;
  ctx.fillText('My laptop runs AI', 72, 230);
  ctx.fillStyle = '#5f636a';
  ctx.fillText('with the wifi off.', 72, 306);

  // The number
  const speed = data.tokensPerSecond.toFixed(1);
  ctx.fillStyle = '#0a0a0a';
  ctx.font = `600 150px ${FONT}`;
  const numberWidth = ctx.measureText(speed).width;
  ctx.fillText(speed, 72, 480);
  ctx.font = `500 34px ${FONT}`;
  ctx.fillStyle = '#5f636a';
  ctx.fillText('tokens / second', 90 + numberWidth, 480);

  // Details
  let x = 72;
  const details = [
    data.replyStartMs !== null ? `Replies in ${(data.replyStartMs / 1000).toFixed(1)} s` : null,
    data.brain,
    `GPU: ${data.gpu}`,
  ].filter((d): d is string => d !== null);
  for (const d of details) {
    if (x > W - 200) break;
    x += pill(ctx, x, 526, d.length > 34 ? `${d.slice(0, 33)}…` : d) + 12;
  }

  // Big friendly face on the right
  drawFace(ctx, W - 330, 170, 250, '#111110', '#ffffff');

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the card'))), 'image/png'));
}

/** Preview the card with Share (where supported) and Download buttons. */
export function openSpeedCard(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const file = new File([blob], 'loom-speed.png', { type: 'image/png' });
  const close = () => {
    overlay.remove();
    URL.revokeObjectURL(url);
  };

  const download = h('a', { class: 'btn btn-primary', href: url, download: 'loom-speed.png' }, icon('download'), 'Download image');
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  const share = canShare
    ? h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () =>
            void navigator
              .share({ files: [file], title: 'Loom', text: 'My laptop runs AI with the wifi off — 100% local, in the browser.' })
              .catch(() => {}),
        },
        icon('share'),
        'Share',
      )
    : '';

  const overlay = h(
    'div',
    { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'speed-title' },
    h(
      'div',
      { class: 'card speed-card' },
      h('div', { class: 'card-head' }, h('h2', { id: 'speed-title' }, 'Your speed card'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close'))),
      h('p', {}, 'Measured on this device, from your last reply. Post it, or add it to your portfolio.'),
      h('img', { class: 'speed-preview', src: url, alt: 'Speed card showing tokens per second, reply time, model and GPU' }),
      h('div', { class: 'card-actions' }, download, share),
    ),
  );
  overlay.addEventListener('click', (e) => e.target === overlay && close());
  overlay.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Escape' && close());
  document.body.append(overlay);
  download.focus();
}
