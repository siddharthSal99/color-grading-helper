import { LUT_STEPS } from './harmony';

/** Draw an image source scaled so its long side is at most `maxSide`. */
export function rasterize(src: CanvasImageSource & { width: number; height: number }, maxSide: number): ImageData {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Rotate each pixel's hue by the amount in the LUT, keeping saturation and value. Writes into `out`. */
export function applyHueShift(src: Uint8ClampedArray, out: Uint8ClampedArray, lut: Float32Array): void {
  const step = LUT_STEPS / 360;
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i] / 255,
      g = src[i + 1] / 255,
      b = src[i + 2] / 255;
    out[i + 3] = src[i + 3];
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    const d = max - min;
    if (d === 0) {
      out[i] = src[i];
      out[i + 1] = src[i + 1];
      out[i + 2] = src[i + 2];
      continue;
    }
    let h: number;
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    const shift = lut[Math.floor(h * step) % LUT_STEPS];
    if (shift === 0) {
      out[i] = src[i];
      out[i + 1] = src[i + 1];
      out[i + 2] = src[i + 2];
      continue;
    }
    h = (h + shift) % 360;
    if (h < 0) h += 360;
    const s = d / max;
    const v = max;
    const c = v * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let rr, gg, bb;
    if (hp < 1) (rr = c), (gg = x), (bb = 0);
    else if (hp < 2) (rr = x), (gg = c), (bb = 0);
    else if (hp < 3) (rr = 0), (gg = c), (bb = x);
    else if (hp < 4) (rr = 0), (gg = x), (bb = c);
    else if (hp < 5) (rr = x), (gg = 0), (bb = c);
    else (rr = c), (gg = 0), (bb = x);
    const m = v - c;
    out[i] = (rr + m) * 255 + 0.5;
    out[i + 1] = (gg + m) * 255 + 0.5;
    out[i + 2] = (bb + m) * 255 + 0.5;
  }
}

/** Average color in a square around (x, y). */
export function sampleAverage(img: ImageData, x: number, y: number, radius: number): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let yy = Math.max(0, y - radius); yy <= Math.min(img.height - 1, y + radius); yy++) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(img.width - 1, x + radius); xx++) {
      const i = (yy * img.width + xx) * 4;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
    }
  }
  return [r / n, g / n, b / n];
}
