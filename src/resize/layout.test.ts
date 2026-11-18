import { describe, expect, it } from 'vitest';
import { contentRect, outputSize, ratioLabel } from './layout';

describe('resize layout', () => {
  it('pads a 4:3 (20:15) drawing into a 1080×1920 reel without cropping', () => {
    const out = outputSize(2000, 1500, 9, 16, 'instagram');
    expect(out).toEqual({ w: 1080, h: 1920 });
    const r = contentRect(2000, 1500, out.w, out.h, 0);
    expect(r.w).toBeCloseTo(1080);
    expect(r.h).toBeCloseTo(810);
    expect(r.y).toBeCloseTo(555);
  });
  it('keeps full resolution in source mode', () => {
    expect(outputSize(2000, 1500, 9, 16, 'source')).toEqual({ w: 2000, h: 3556 });
    expect(outputSize(1080, 1920, 16, 9, 'source')).toEqual({ w: 3414, h: 1920 });
  });
  it('caps huge outputs and keeps dimensions even', () => {
    const out = outputSize(4000, 3000, 9, 16, 'source');
    expect(Math.max(out.w, out.h)).toBeLessThanOrEqual(3840);
    expect(out.w % 2).toBe(0);
    expect(out.h % 2).toBe(0);
  });
  it('applies margin on every side', () => {
    const r = contentRect(1000, 1000, 1000, 1000, 10);
    expect(r).toEqual({ x: 100, y: 100, w: 800, h: 800 });
  });
  it('labels ratios', () => {
    expect(ratioLabel(2000, 1500)).toBe('4:3');
    expect(ratioLabel(1080, 1920)).toBe('9:16');
  });
});
