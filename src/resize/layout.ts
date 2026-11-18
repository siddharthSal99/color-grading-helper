/** Pure layout math for padding media into a new aspect ratio without cropping. */

export type Preset = { id: string; label: string; detail: string; w: number; h: number };

export const PRESETS: Preset[] = [
  { id: 'reels', label: 'Reels / Stories', detail: '9:16 vertical', w: 9, h: 16 },
  { id: 'portrait', label: 'Feed portrait', detail: '4:5', w: 4, h: 5 },
  { id: 'square', label: 'Square', detail: '1:1', w: 1, h: 1 },
  { id: 'landscape', label: 'Landscape', detail: '16:9', w: 16, h: 9 },
];

export type SizeMode = 'instagram' | 'source';

export type Rect = { x: number; y: number; w: number; h: number };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Largest size we will produce; video encoders commonly top out around 4K. */
export const MAX_LONG_SIDE = 3840;

/**
 * Output canvas size for the target ratio.
 * - 'instagram': short side 1080 px (e.g. 1080×1920 for 9:16), Instagram's recommended size.
 * - 'source': the smallest canvas of that ratio that holds the source at full resolution.
 * Both are rounded to even numbers (required by most video encoders).
 */
export function outputSize(srcW: number, srcH: number, ratioW: number, ratioH: number, mode: SizeMode) {
  const r = ratioW / ratioH;
  let w: number, h: number;
  if (mode === 'instagram') {
    if (r <= 1) [w, h] = [1080, 1080 / r];
    else [w, h] = [1080 * r, 1080];
  } else if (srcW / srcH > r) {
    [w, h] = [srcW, srcW / r];
  } else {
    [w, h] = [srcH * r, srcH];
  }
  const long = Math.max(w, h);
  if (long > MAX_LONG_SIDE) {
    w *= MAX_LONG_SIDE / long;
    h *= MAX_LONG_SIDE / long;
  }
  return { w: even(w), h: even(h) };
}

/** Where the source goes: scaled to fit (never cropped) inside the canvas minus a margin, centered. */
export function contentRect(srcW: number, srcH: number, outW: number, outH: number, marginPct: number): Rect {
  const m = (Math.min(outW, outH) * marginPct) / 100;
  const boxW = Math.max(1, outW - 2 * m);
  const boxH = Math.max(1, outH - 2 * m);
  const s = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return { x: (outW - w) / 2, y: (outH - h) / 2, w, h };
}

/** Rect that covers the whole canvas (used for the blurred background). */
export function coverRect(srcW: number, srcH: number, outW: number, outH: number): Rect {
  const s = Math.max(outW / srcW, outH / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return { x: (outW - w) / 2, y: (outH - h) / 2, w, h };
}

/** Simplified ratio label, e.g. 2000×1500 → "4:3". */
export function ratioLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(Math.round(w), Math.round(h)) || 1;
  const a = Math.round(w) / g;
  const b = Math.round(h) / g;
  return a <= 50 && b <= 50 ? `${a}:${b}` : `${(w / h).toFixed(2)}:1`;
}
