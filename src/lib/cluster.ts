import { hueDist, normHue, rgbToHsv } from './color';

export const HIST_BINS = 360;

export type HueHistogram = {
  /** Pixel count per 1° hue bin (only pixels that passed the neutral filter). */
  bins: Float64Array;
  /** Number of pixels that passed the neutral filter. */
  total: number;
  /** Number of pixels examined. */
  examined: number;
};

export type Cluster = {
  /** Mean hue in degrees. */
  hue: number;
  /** Share of the counted pixels assigned to this cluster, 0..1. */
  weight: number;
  /** Set when the cluster comes from a user-sampled point. */
  sampleId?: string;
};

export type NeutralFilter = { minSat: number; minVal: number };

/** Build a 1°-resolution hue histogram, skipping near-neutral pixels. */
export function buildHueHistogram(data: Uint8ClampedArray, filter: NeutralFilter): HueHistogram {
  const bins = new Float64Array(HIST_BINS);
  let total = 0;
  let examined = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    examined++;
    const { h, s, v } = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    if (s < filter.minSat || v < filter.minVal) continue;
    bins[Math.floor(h) % HIST_BINS] += 1;
    total++;
  }
  return { bins, total, examined };
}

const binHue = (i: number) => i + 0.5;

/** Small seeded PRNG so results are stable between renders. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type KMeansResult = { centers: number[]; weights: number[]; cost: number };

/** Weighted circular mean of the given bins. */
function circularMean(idx: number[], bins: Float64Array): number {
  let sx = 0,
    sy = 0;
  for (const i of idx) {
    const a = (binHue(i) * Math.PI) / 180;
    sx += bins[i] * Math.cos(a);
    sy += bins[i] * Math.sin(a);
  }
  return normHue((Math.atan2(sy, sx) * 180) / Math.PI);
}

/** Assign every non-empty bin to its nearest center; returns cost and per-center members. */
function assign(nonEmpty: number[], bins: Float64Array, centers: number[]) {
  const members: number[][] = centers.map(() => []);
  let cost = 0;
  for (const i of nonEmpty) {
    let best = 0,
      bestD = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const d = hueDist(binHue(i), centers[c]);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    members[best].push(i);
    cost += bins[i] * bestD * bestD;
  }
  return { members, cost };
}

/** One weighted k-means run on the circle with k-means++ seeding. */
function kmeansOnce(nonEmpty: number[], bins: Float64Array, k: number, rand: () => number): KMeansResult {
  const pick = (weights: number[]) => {
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = rand() * sum;
    for (let j = 0; j < weights.length; j++) {
      r -= weights[j];
      if (r <= 0) return nonEmpty[j];
    }
    return nonEmpty[nonEmpty.length - 1];
  };
  const centers: number[] = [binHue(pick(nonEmpty.map((i) => bins[i])))];
  while (centers.length < k) {
    const w = nonEmpty.map((i) => {
      const d = Math.min(...centers.map((c) => hueDist(binHue(i), c)));
      return bins[i] * d * d;
    });
    centers.push(binHue(pick(w)));
  }

  let prevCost = Infinity;
  for (let iter = 0; iter < 100; iter++) {
    const { members, cost } = assign(nonEmpty, bins, centers);
    for (let c = 0; c < k; c++) {
      if (members[c].length) centers[c] = circularMean(members[c], bins);
    }
    if (Math.abs(prevCost - cost) < 1e-6) break;
    prevCost = cost;
  }
  const { members, cost } = assign(nonEmpty, bins, centers);
  const weights = members.map((m) => m.reduce((a, i) => a + bins[i], 0));
  return { centers, weights, cost };
}

/** Best of several circular k-means runs over the hue histogram. */
export function circularKMeans(hist: HueHistogram, k: number, restarts = 8): KMeansResult {
  const nonEmpty: number[] = [];
  for (let i = 0; i < HIST_BINS; i++) if (hist.bins[i] > 0) nonEmpty.push(i);
  if (nonEmpty.length === 0) return { centers: [], weights: [], cost: 0 };
  k = Math.max(1, Math.min(k, nonEmpty.length));
  const rand = mulberry32(1337 + k);
  let best: KMeansResult | null = null;
  for (let r = 0; r < restarts; r++) {
    const res = kmeansOnce(nonEmpty, hist.bins, k, rand);
    if (!best || res.cost < best.cost) best = res;
  }
  return best!;
}

/** Weighted RMS angular distance (degrees) from pixels to their cluster mean. */
export function rmsSpread(hist: HueHistogram, res: KMeansResult): number {
  return hist.total ? Math.sqrt(res.cost / hist.total) : 0;
}

export const MAX_AUTO_K = 8;

export type ClusterResult = { clusters: Cluster[]; k: number; rms: number };

function toClusters(hist: HueHistogram, res: KMeansResult): Cluster[] {
  return res.centers
    .map((hue, i) => ({ hue, weight: hist.total ? res.weights[i] / hist.total : 0 }))
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Fewest clusters that represent the image: the smallest k whose RMS hue spread
 * is within `toleranceDeg`. Capped at MAX_AUTO_K.
 */
export function autoCluster(hist: HueHistogram, toleranceDeg: number): ClusterResult {
  let last: ClusterResult = { clusters: [], k: 0, rms: 0 };
  for (let k = 1; k <= MAX_AUTO_K; k++) {
    const res = circularKMeans(hist, k);
    const rms = rmsSpread(hist, res);
    last = { clusters: toClusters(hist, res), k: res.centers.length, rms };
    if (rms <= toleranceDeg || res.centers.length < k) break;
  }
  return last;
}

export function fixedCluster(hist: HueHistogram, k: number): ClusterResult {
  const res = circularKMeans(hist, k);
  return { clusters: toClusters(hist, res), k: res.centers.length, rms: rmsSpread(hist, res) };
}

/** Use user-sampled hues as fixed cluster centers; pixels go to the nearest one. */
export function sampledClusters(hist: HueHistogram, samples: { id: string; hue: number }[]): ClusterResult {
  const counts = samples.map(() => 0);
  let cost = 0;
  for (let i = 0; i < HIST_BINS; i++) {
    const w = hist.bins[i];
    if (!w) continue;
    let best = 0,
      bestD = Infinity;
    samples.forEach((s, j) => {
      const d = hueDist(binHue(i), s.hue);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    counts[best] += w;
    cost += w * bestD * bestD;
  }
  return {
    clusters: samples.map((s, j) => ({
      hue: s.hue,
      weight: hist.total ? counts[j] / hist.total : 0,
      sampleId: s.id,
    })),
    k: samples.length,
    rms: hist.total ? Math.sqrt(cost / hist.total) : 0,
  };
}
