import { hueDelta, hueDist, normHue } from './color';
import type { Cluster } from './cluster';

export type HarmonyId = 'complementary' | 'analogous' | 'triadic' | 'split' | 'tetradic';

export type Harmony = { id: HarmonyId; name: string; offsets: number[]; blurb: string };

export const HARMONIES: Harmony[] = [
  {
    id: 'complementary',
    name: 'Complementary',
    offsets: [0, 180],
    blurb: 'Two opposite hues, e.g. orange and teal. High contrast.',
  },
  {
    id: 'analogous',
    name: 'Analogous',
    offsets: [-30, 0, 30],
    blurb: 'Three neighbouring hues. Calm and cohesive.',
  },
  {
    id: 'triadic',
    name: 'Triadic',
    offsets: [0, 120, 240],
    blurb: 'Three hues evenly spaced. Vibrant but balanced.',
  },
  {
    id: 'split',
    name: 'Split complementary',
    offsets: [0, 150, 210],
    blurb: 'A base hue plus the two neighbours of its complement.',
  },
  {
    id: 'tetradic',
    name: 'Tetradic',
    offsets: [0, 60, 180, 240],
    blurb: 'Two complementary pairs (a rectangle). Rich; usually let one hue dominate.',
  },
];

export const harmonyById = (id: HarmonyId) => HARMONIES.find((h) => h.id === id)!;

export const targetHues = (h: Harmony, rotation: number) => h.offsets.map((o) => normHue(rotation + o));

export type WeightedHue = { hue: number; weight: number };

function nearestTarget(hue: number, targets: number[]) {
  let best = targets[0],
    bestD = Infinity;
  for (const t of targets) {
    const d = hueDist(hue, t);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return { target: best, dist: bestD };
}

export type HarmonyFit = { rotation: number; /** weighted RMS distance to targets, degrees */ deviation: number };

/** Rotation of the harmony that minimises weighted squared distance from each hue to its nearest target. */
export function fitHarmony(h: Harmony, points: WeightedHue[]): HarmonyFit {
  const totalW = points.reduce((a, p) => a + p.weight, 0);
  if (!points.length || totalW <= 0) return { rotation: 0, deviation: 0 };
  const cost = (rot: number) => {
    const targets = targetHues(h, rot);
    let c = 0;
    for (const p of points) {
      const { dist } = nearestTarget(p.hue, targets);
      c += p.weight * dist * dist;
    }
    return c;
  };
  // Coarse 1° scan, then refine to 0.1°.
  let bestRot = 0,
    bestCost = Infinity;
  for (let r = 0; r < 360; r++) {
    const c = cost(r);
    if (c < bestCost) {
      bestCost = c;
      bestRot = r;
    }
  }
  for (let r = bestRot - 1; r <= bestRot + 1; r += 0.1) {
    const c = cost(r);
    if (c < bestCost) {
      bestCost = c;
      bestRot = r;
    }
  }
  return { rotation: normHue(bestRot), deviation: Math.sqrt(bestCost / totalW) };
}

export type Assignment = { cluster: Cluster; target: number; delta: number };

export function assignToTargets(clusters: Cluster[], targets: number[]): Assignment[] {
  return clusters.map((c) => {
    const { target } = nearestTarget(c.hue, targets);
    return { cluster: c, target, delta: hueDelta(c.hue, target) };
  });
}

export const LUT_STEPS = 720; // 0.5° resolution

/**
 * Per-hue shift table. Each hue blends the shifts of nearby clusters with a
 * Gaussian falloff so there is no hard banding between clusters. Hues further
 * than `rangeDeg` from every cluster are faded out.
 */
export function buildShiftLut(
  assignments: Assignment[],
  strength: number,
  rangeDeg: number,
  sigma = 18,
): Float32Array {
  const lut = new Float32Array(LUT_STEPS);
  if (!assignments.length || strength === 0) return lut;
  for (let i = 0; i < LUT_STEPS; i++) {
    const h = (i * 360) / LUT_STEPS;
    let sw = 0,
      sd = 0,
      dmin = Infinity;
    for (const a of assignments) {
      const d = hueDist(h, a.cluster.hue);
      dmin = Math.min(dmin, d);
      const w = Math.exp(-(d * d) / (2 * sigma * sigma)) + 1e-9;
      sw += w;
      sd += w * a.delta;
    }
    let fade = 1;
    if (rangeDeg < 180 && dmin > rangeDeg) fade = Math.max(0, 1 - (dmin - rangeDeg) / 15);
    lut[i] = (sd / sw) * strength * fade;
  }
  return lut;
}
