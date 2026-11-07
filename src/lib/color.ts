/** Basic color + circular-angle helpers. Hues are in degrees [0, 360). */

export type HSV = { h: number; s: number; v: number };

export function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = normHue(h) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Wrap any angle into [0, 360). */
export function normHue(h: number): number {
  const r = h % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed shortest rotation from `from` to `to`, in (-180, 180]. */
export function hueDelta(from: number, to: number): number {
  let d = normHue(to - from);
  if (d > 180) d -= 360;
  return d;
}

/** Unsigned shortest distance between two hues, in [0, 180]. */
export function hueDist(a: number, b: number): number {
  return Math.abs(hueDelta(a, b));
}

/** CSS color for a hue at display-friendly saturation/brightness. */
export function hueCss(h: number, s = 85, l = 55): string {
  return `hsl(${normHue(h).toFixed(1)} ${s}% ${l}%)`;
}
