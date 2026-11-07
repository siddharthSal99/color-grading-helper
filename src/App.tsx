import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HueWheel } from './components/HueWheel';
import { hueCss, rgbToHsv } from './lib/color';
import { autoCluster, buildHueHistogram, fixedCluster, MAX_AUTO_K, sampledClusters } from './lib/cluster';
import {
  assignToTargets,
  buildShiftLut,
  fitHarmony,
  HARMONIES,
  harmonyById,
  targetHues,
  type HarmonyId,
} from './lib/harmony';
import { applyHueShift, rasterize, sampleAverage } from './lib/image';

type Sample = { id: string; x: number; y: number; hue: number; sat: number; rgb: [number, number, number] };
type Loaded = { bitmap: ImageBitmap; name: string; preview: ImageData; analysis: ImageData };

const PREVIEW_MAX = 1600;
const ANALYSIS_MAX = 320;

const fmtDeg = (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(0)}°`;
const rgbCss = ([r, g, b]: [number, number, number]) => `rgb(${r | 0} ${g | 0} ${b | 0})`;

export default function App() {
  const [img, setImg] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [kMode, setKMode] = useState<'auto' | number>('auto');
  const [tolerance, setTolerance] = useState(15);
  const [minSat, setMinSat] = useState(0.15);
  const [minVal, setMinVal] = useState(0.15);
  const [harmonyId, setHarmonyId] = useState<HarmonyId>('complementary');
  const [manualRot, setManualRot] = useState<number | null>(null);
  const [strength, setStrength] = useState(0.6);
  const [range, setRange] = useState(180);
  const [showOriginal, setShowOriginal] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [exporting, setExporting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<ImageData | null>(null);

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      setImg({ bitmap, name: file.name, preview: rasterize(bitmap, PREVIEW_MAX), analysis: rasterize(bitmap, ANALYSIS_MAX) });
      setSamples([]);
      setManualRot(null);
      outRef.current = null;
    } catch {
      setError(`Couldn't read "${file.name}". Try a JPEG, PNG or WebP.`);
    }
  }, []);

  // ---- analysis pipeline ----
  const hist = useMemo(
    () => (img ? buildHueHistogram(img.analysis.data, { minSat, minVal }) : null),
    [img, minSat, minVal],
  );

  const clusterResult = useMemo(() => {
    if (!hist || hist.total === 0) return null;
    if (samples.length) return sampledClusters(hist, samples);
    return kMode === 'auto' ? autoCluster(hist, tolerance) : fixedCluster(hist, kMode);
  }, [hist, samples, kMode, tolerance]);

  const clusters = clusterResult?.clusters ?? [];

  const fitPoints = useMemo(
    () =>
      samples.length ? samples.map((s) => ({ hue: s.hue, weight: 1 })) : clusters.map((c) => ({ hue: c.hue, weight: c.weight })),
    [samples, clusters],
  );

  const fits = useMemo(
    () => Object.fromEntries(HARMONIES.map((h) => [h.id, fitHarmony(h, fitPoints)])) as Record<HarmonyId, ReturnType<typeof fitHarmony>>,
    [fitPoints],
  );
  const bestFitId = useMemo(() => {
    if (!fitPoints.length) return null;
    // Prefer simpler harmonies unless a more complex one fits noticeably better.
    let best = HARMONIES[0].id;
    for (const h of HARMONIES) if (fits[h.id].deviation < fits[best].deviation - 3) best = h.id;
    return best;
  }, [fits, fitPoints]);

  const harmony = harmonyById(harmonyId);
  const rotation = manualRot ?? fits[harmonyId].rotation;
  const hasClusters = clusters.length > 0;
  const targets = useMemo(() => (hasClusters ? targetHues(harmony, rotation) : []), [harmony, rotation, hasClusters]);
  const assignments = useMemo(() => assignToTargets(clusters, targets), [clusters, targets]);
  const lut = useMemo(() => buildShiftLut(assignments, strength, range), [assignments, strength, range]);

  // ---- render preview ----
  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const id = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { preview } = img;
      if (canvas.width !== preview.width || canvas.height !== preview.height) {
        canvas.width = preview.width;
        canvas.height = preview.height;
      }
      const ctx = canvas.getContext('2d')!;
      if (showOriginal) {
        ctx.putImageData(preview, 0, 0);
        return;
      }
      if (!outRef.current || outRef.current.width !== preview.width || outRef.current.height !== preview.height) {
        outRef.current = new ImageData(preview.width, preview.height);
      }
      applyHueShift(preview.data, outRef.current.data, lut);
      ctx.putImageData(outRef.current, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [img, lut, showOriginal]);

  const addSample = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!img) return;
    const r = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    const px = Math.round(nx * (img.preview.width - 1));
    const py = Math.round(ny * (img.preview.height - 1));
    const rgb = sampleAverage(img.preview, px, py, Math.max(2, Math.round(img.preview.width / 300)));
    const { h, s } = rgbToHsv(...rgb);
    setSamples((prev) => [...prev, { id: crypto.randomUUID(), x: nx, y: ny, hue: h, sat: s, rgb }]);
    setManualRot(null);
  };

  const removeSample = (id: string) => {
    setSamples((prev) => prev.filter((s) => s.id !== id));
    setManualRot(null);
  };

  const exportImage = async () => {
    if (!img) return;
    setExporting(true);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const full = rasterize(img.bitmap, Infinity);
      const out = new ImageData(full.width, full.height);
      applyHueShift(full.data, out.data, lut);
      const c = document.createElement('canvas');
      c.width = full.width;
      c.height = full.height;
      c.getContext('2d')!.putImageData(out, 0, 0);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.95));
      if (!blob) throw new Error('encode failed');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = img.name.replace(/\.[^.]+$/, '') + `-${harmonyId}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      setError('Export failed. The image may be too large for this browser.');
    } finally {
      setExporting(false);
    }
  };

  const countedPct = hist && hist.examined ? (100 * hist.total) / hist.examined : 0;

  return (
    <div
      className={`app${dragOver ? ' drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) loadFile(f);
      }}
    >
      <header className="top">
        <h1>Hue Harmony</h1>
        <p className="tag">Find your photo's hues and see where to push them.</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = '';
          }}
        />
        {img && (
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            Open another photo
          </button>
        )}
      </header>

      {error && <div className="error" role="alert">{error}</div>}

      {!img ? (
        <button className="drop" onClick={() => fileRef.current?.click()}>
          <span className="drop-title">Drop a photo here, or click to choose one</span>
          <span className="drop-sub">Everything runs in your browser. The photo is never uploaded.</span>
        </button>
      ) : (
        <main className="layout">
          <section className="imagecol">
            <div className="stage-wrap">
            <div className="stage">
              <canvas ref={canvasRef} onClick={addSample} title="Click to sample a color you want to highlight" />
              {samples.map((s, i) => (
                <button
                  key={s.id}
                  className="pin"
                  style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, background: rgbCss(s.rgb) }}
                  onClick={() => removeSample(s.id)}
                  title={`Sample ${i + 1}, hue ${s.hue.toFixed(0)}°. Click to remove.`}
                  aria-label={`Remove sample ${i + 1}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            </div>
            <div className="imagebar">
              <button
                className="btn"
                onPointerDown={() => setShowOriginal(true)}
                onPointerUp={() => setShowOriginal(false)}
                onPointerLeave={() => setShowOriginal(false)}
                onKeyDown={(e) => e.key === ' ' && setShowOriginal(true)}
                onKeyUp={() => setShowOriginal(false)}
              >
                Hold to see original
              </button>
              <button className="btn primary" onClick={exportImage} disabled={exporting}>
                {exporting ? 'Exporting…' : 'Download graded JPEG'}
              </button>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Sampled colors</h2>
                {samples.length > 0 && (
                  <button className="link" onClick={() => { setSamples([]); setManualRot(null); }}>
                    Clear all
                  </button>
                )}
              </div>
              {samples.length === 0 ? (
                <p className="muted">
                  Click the photo to sample the colors you want to highlight. Those become the key hues the harmony is
                  fitted to. With no samples, the app clusters the hues on its own.
                </p>
              ) : (
                <ul className="chips">
                  {samples.map((s, i) => (
                    <li key={s.id} className="chip">
                      <span className="sw" style={{ background: rgbCss(s.rgb) }} />
                      <span>
                        #{i + 1} · {s.hue.toFixed(0)}°
                        {s.sat < minSat && <em className="warn" title="Nearly neutral, so the hue is unreliable"> low sat</em>}
                      </span>
                      <button className="x" onClick={() => removeSample(s.id)} aria-label={`Remove sample ${i + 1}`}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="sidecol">
            <div className="card wheelcard">
              <HueWheel
                bins={hist?.bins ?? null}
                assignments={assignments}
                targets={targets}
                rotation={rotation}
                onRotate={setManualRot}
              />
              <div className="wheel-foot">
                <span className="muted">
                  {manualRot === null ? 'Harmony auto-fitted.' : `Rotated by hand to ${rotation.toFixed(0)}°.`} Drag the wheel to rotate it.
                </span>
                {manualRot !== null && (
                  <button className="link" onClick={() => setManualRot(null)}>
                    Auto-fit
                  </button>
                )}
              </div>
              {hist && hist.total === 0 && (
                <p className="warn">No pixels pass the neutral filter. Lower the saturation or brightness cutoffs below.</p>
              )}
            </div>

            <div className="card">
              <h2>Harmony</h2>
              <div className="harmonies" role="radiogroup">
                {HARMONIES.map((h) => (
                  <button
                    key={h.id}
                    role="radio"
                    aria-checked={h.id === harmonyId}
                    className={`harm${h.id === harmonyId ? ' on' : ''}`}
                    onClick={() => {
                      setHarmonyId(h.id);
                      setManualRot(null);
                    }}
                    title={h.blurb}
                  >
                    <span className="harm-name">
                      {h.name}
                      {h.id === bestFitId && <span className="badge">best fit</span>}
                    </span>
                    <span className="harm-dev">{fitPoints.length ? `±${fits[h.id].deviation.toFixed(0)}° off` : '—'}</span>
                  </button>
                ))}
              </div>
              <p className="muted small">
                {harmony.blurb} "Off" is the weighted average distance from your hues to the nearest harmony hue. Lower means
                less pushing is needed.
              </p>
            </div>

            <div className="card">
              <h2>Where to push</h2>
              {assignments.length === 0 ? (
                <p className="muted">No clusters yet.</p>
              ) : (
                <table className="moves">
                  <thead>
                    <tr>
                      <th>Hue now</th>
                      <th className="num">Share</th>
                      <th>Target</th>
                      <th className="num">Shift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a, i) => (
                      <tr key={i}>
                        <td>
                          <span className="sw" style={{ background: hueCss(a.cluster.hue) }} />
                          {a.cluster.hue.toFixed(0)}°{a.cluster.sampleId && <span className="muted"> (sample)</span>}
                        </td>
                        <td className="num">{(a.cluster.weight * 100).toFixed(0)}%</td>
                        <td>
                          <span className="sw" style={{ background: hueCss(a.target) }} />
                          {a.target.toFixed(0)}°
                        </td>
                        <td className="num">
                          {Math.abs(a.delta) < 1 ? 'on target' : fmtDeg(a.delta)}
                          {Math.abs(a.delta) > 45 && <span className="warn" title="Large hue move. Consider lowering “Affect hues within” or picking another harmony."> !</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {harmony.offsets.length > 0 &&
                targets.filter((t) => !assignments.some((a) => a.target === t)).length > 0 &&
                assignments.length > 0 && (
                  <p className="muted small">
                    Unused harmony hues:{' '}
                    {targets
                      .filter((t) => !assignments.some((a) => a.target === t))
                      .map((t) => (
                        <span key={t} className="inline-sw">
                          <span className="sw" style={{ background: hueCss(t) }} />
                          {t.toFixed(0)}°
                        </span>
                      ))}{' '}
                    could be introduced, for example with a split-tone or accent.
                  </p>
                )}
              {assignments.some((a) => Math.abs(a.delta) > 45) && (
                <p className="warn small">
                  ! marks a large move (more than 45°). Lower “Affect hues within” to leave those hues alone, or try another harmony.
                </p>
              )}
            </div>

            <div className="card">
              <h2>Preview grade</h2>
              <Slider label="Push strength" value={strength} min={0} max={1} step={0.01} onChange={setStrength} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Slider
                label="Affect hues within"
                value={range}
                min={10}
                max={180}
                step={1}
                onChange={setRange}
                fmt={(v) => (v >= 180 ? 'all hues' : `${v}° of a cluster`)}
              />
              <p className="muted small">Only hue is rotated. Saturation and brightness stay as they were.</p>
            </div>

            <div className="card">
              <h2>Clustering</h2>
              <div className={`seg${samples.length ? ' disabled' : ''}`} aria-label="Number of clusters">
                <button className={kMode === 'auto' ? 'on' : ''} onClick={() => setKMode('auto')} disabled={!!samples.length}>
                  Auto
                </button>
                {Array.from({ length: MAX_AUTO_K }, (_, i) => i + 1).map((k) => (
                  <button key={k} className={kMode === k ? 'on' : ''} onClick={() => setKMode(k)} disabled={!!samples.length}>
                    {k}
                  </button>
                ))}
              </div>
              {samples.length > 0 ? (
                <p className="muted small">Using your {samples.length} sampled color(s) as the cluster centers.</p>
              ) : (
                <>
                  {kMode === 'auto' && (
                    <Slider
                      label="Auto tolerance"
                      value={tolerance}
                      min={5}
                      max={40}
                      step={1}
                      onChange={setTolerance}
                      fmt={(v) => `${v}°`}
                    />
                  )}
                  {clusterResult && (
                    <p className="muted small">
                      {clusterResult.k} cluster{clusterResult.k === 1 ? '' : 's'}, average spread ±{clusterResult.rms.toFixed(0)}°.
                      {kMode === 'auto' && ' Auto mode picks the fewest clusters whose spread is within the tolerance.'}
                    </p>
                  )}
                </>
              )}
              <Slider label="Ignore saturation below" value={minSat} min={0} max={0.6} step={0.01} onChange={setMinSat} fmt={(v) => `${Math.round(v * 100)}%`} />
              <Slider label="Ignore brightness below" value={minVal} min={0} max={0.6} step={0.01} onChange={setMinVal} fmt={(v) => `${Math.round(v * 100)}%`} />
              <p className="muted small">
                {countedPct.toFixed(0)}% of pixels counted. Greys, blacks and whites have no reliable hue, so they're left out.
              </p>
            </div>
          </section>
        </main>
      )}
      <footer className="foot muted small">Hue is measured in HSV. 0° is red, 120° is green, 240° is blue.</footer>
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt: (v: number) => string;
}) {
  return (
    <label className="slider">
      <span className="slider-row">
        <span>{props.label}</span>
        <span className="val">{props.fmt(props.value)}</span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
