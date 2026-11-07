import { describe, expect, it } from 'vitest';
import { hsvToRgb, hueDelta, rgbToHsv } from './color';
import { autoCluster, fixedCluster, HIST_BINS, sampledClusters, type HueHistogram } from './cluster';
import { assignToTargets, buildShiftLut, fitHarmony, harmonyById, targetHues } from './harmony';
import { applyHueShift } from './image';

function histFrom(peaks: { hue: number; count: number; spread?: number }[]): HueHistogram {
  const bins = new Float64Array(HIST_BINS);
  let total = 0;
  for (const p of peaks) {
    const s = p.spread ?? 0;
    for (let o = -s; o <= s; o++) {
      const i = (((Math.round(p.hue) + o) % 360) + 360) % 360;
      bins[i] += p.count;
      total += p.count;
    }
  }
  return { bins, total, examined: total };
}

describe('color', () => {
  it('round-trips rgb <-> hsv', () => {
    for (const [r, g, b] of [[255, 0, 0], [12, 200, 90], [30, 60, 250], [200, 200, 10]]) {
      const { h, s, v } = rgbToHsv(r, g, b);
      expect(hsvToRgb(h, s, v)).toEqual([r, g, b]);
    }
  });
  it('computes signed hue deltas across the wrap', () => {
    expect(hueDelta(350, 10)).toBe(20);
    expect(hueDelta(10, 350)).toBe(-20);
    expect(hueDelta(0, 180)).toBe(180);
  });
});

describe('clustering', () => {
  it('finds two clusters across the 0/360 wrap', () => {
    const hist = histFrom([{ hue: 355, count: 10, spread: 8 }, { hue: 180, count: 10, spread: 8 }]);
    const res = autoCluster(hist, 15);
    expect(res.k).toBe(2);
    const hues = res.clusters.map((c) => c.hue).sort((a, b) => a - b);
    expect(Math.abs(hueDelta(hues[0], 180))).toBeLessThan(2);
    expect(Math.abs(hueDelta(hues[1], 355))).toBeLessThan(2);
  });
  it('uses one cluster for a single tight hue', () => {
    expect(autoCluster(histFrom([{ hue: 30, count: 5, spread: 5 }]), 15).k).toBe(1);
  });
  it('respects a fixed k', () => {
    const hist = histFrom([{ hue: 0, count: 5, spread: 3 }, { hue: 120, count: 5, spread: 3 }, { hue: 240, count: 5, spread: 3 }]);
    expect(fixedCluster(hist, 3).clusters).toHaveLength(3);
  });
  it('assigns pixels to sampled hues', () => {
    const hist = histFrom([{ hue: 20, count: 30 }, { hue: 200, count: 10 }]);
    const res = sampledClusters(hist, [{ id: 'a', hue: 25 }, { id: 'b', hue: 210 }]);
    expect(res.clusters[0].weight).toBeCloseTo(0.75);
    expect(res.clusters[1].weight).toBeCloseTo(0.25);
  });
});

describe('harmony', () => {
  it('fits complementary to an orange/teal pair exactly', () => {
    const fit = fitHarmony(harmonyById('complementary'), [{ hue: 30, weight: 1 }, { hue: 210, weight: 1 }]);
    expect(fit.deviation).toBeLessThan(0.5);
  });
  it('builds shifts that move clusters onto targets', () => {
    const h = harmonyById('complementary');
    const clusters = [{ hue: 30, weight: 0.5 }, { hue: 190, weight: 0.5 }];
    const targets = targetHues(h, 30);
    const a = assignToTargets(clusters, targets);
    expect(a.map((x) => x.delta)).toEqual([0, 20]);
    const lut = buildShiftLut(a, 1, 180);
    expect(lut[190 * 2]).toBeGreaterThan(19);
    expect(Math.abs(lut[30 * 2])).toBeLessThan(1);
  });
  it('applies a hue shift to pixels', () => {
    const lut = new Float32Array(720).fill(120);
    const src = new Uint8ClampedArray([255, 0, 0, 255]);
    const out = new Uint8ClampedArray(4);
    applyHueShift(src, out, lut);
    expect(Array.from(out)).toEqual([0, 255, 0, 255]);
  });
});
