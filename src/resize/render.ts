import { contentRect, coverRect } from './layout';

export type Background = { kind: 'color'; color: string } | { kind: 'blur'; dim: number };

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** Draws the source (an image, video element or video frame) into the given rect. */
export type DrawSource = (ctx: Ctx, x: number, y: number, w: number, h: number) => void;

let blurCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
function smallCanvas(w: number, h: number) {
  if (!blurCanvas) blurCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  if (blurCanvas.width !== w || blurCanvas.height !== h) {
    blurCanvas.width = w;
    blurCanvas.height = h;
  }
  return blurCanvas;
}

/**
 * Render one output frame: background, then the source scaled to fit with no cropping.
 * The blur is made by shrinking the frame to a tiny canvas and stretching it back up,
 * which looks like a heavy blur and works in every browser (no ctx.filter needed).
 */
export function renderFrame(
  ctx: Ctx,
  outW: number,
  outH: number,
  srcW: number,
  srcH: number,
  draw: DrawSource,
  bg: Background,
  marginPct: number,
) {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (bg.kind === 'color') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, outW, outH);
  } else {
    const sw = 24;
    const sh = Math.max(1, Math.round((sw * outH) / outW));
    const small = smallCanvas(sw, sh);
    const sctx = small.getContext('2d') as Ctx;
    // Draw the frame a little larger than the tiny canvas so every pixel is opaque;
    // otherwise downscaling leaves a semi-transparent border that shows as dark bands.
    const c = coverRect(srcW, srcH, sw, sh);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    draw(sctx, c.x - 2, c.y - 2, c.w + 4, c.h + 4);
    ctx.drawImage(small, 0.5, 0.5, sw - 1, sh - 1, 0, 0, outW, outH);
    if (bg.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${bg.dim})`;
      ctx.fillRect(0, 0, outW, outH);
    }
  }
  const r = contentRect(srcW, srcH, outW, outH, marginPct);
  draw(ctx, r.x, r.y, r.w, r.h);
  ctx.restore();
}
