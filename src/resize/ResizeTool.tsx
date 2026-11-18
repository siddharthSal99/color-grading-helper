import { useEffect, useMemo, useRef, useState } from 'react';
import { outputSize, PRESETS, ratioLabel, type SizeMode } from './layout';
import { renderFrame, type Background } from './render';
import { padVideo, type VideoJobHandle } from './video';

type Media =
  | { kind: 'image'; file: File; el: ImageBitmap; w: number; h: number }
  | { kind: 'video'; file: File; el: HTMLVideoElement; url: string; w: number; h: number };

const SWATCHES = ['#000000', '#ffffff', '#1b1b1c', '#f4efe6'];

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export default function ResizeTool() {
  const [media, setMedia] = useState<Media | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState('reels');
  const [custom, setCustom] = useState({ w: 9, h: 16 });
  const [sizeMode, setSizeMode] = useState<SizeMode>('instagram');
  const [bgKind, setBgKind] = useState<'color' | 'blur'>('color');
  const [color, setColor] = useState('#000000');
  const [dim, setDim] = useState(0.2);
  const [margin, setMargin] = useState(0);
  const [imgFormat, setImgFormat] = useState<'png' | 'jpeg'>('png');
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<{ progress: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const jobRef = useRef<VideoJobHandle | null>(null);

  const ratio = presetId === 'custom' ? custom : PRESETS.find((p) => p.id === presetId)!;
  const ratioOk = ratio.w > 0 && ratio.h > 0;
  const out = media && ratioOk ? outputSize(media.w, media.h, ratio.w, ratio.h, sizeMode) : null;
  const bg: Background = useMemo(() => (bgKind === 'color' ? { kind: 'color', color } : { kind: 'blur', dim }), [bgKind, color, dim]);

  const load = async (file: File) => {
    setError(null);
    jobRef.current?.cancel();
    if (media?.kind === 'video') URL.revokeObjectURL(media.url);
    try {
      if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name)) {
        const url = URL.createObjectURL(file);
        const el = document.createElement('video');
        el.src = url;
        el.muted = true;
        el.loop = true;
        el.playsInline = true;
        el.preload = 'auto';
        await new Promise<void>((res, rej) => {
          el.onloadeddata = () => res();
          el.onerror = () => rej(new Error('decode'));
        });
        setMedia({ kind: 'video', file, el, url, w: el.videoWidth, h: el.videoHeight });
        setPlaying(false);
      } else {
        const el = await createImageBitmap(file, { imageOrientation: 'from-image' });
        setMedia({ kind: 'image', file, el, w: el.width, h: el.height });
      }
    } catch {
      setError(`Couldn't open "${file.name}". Try a JPEG, PNG, WebP, MP4 or MOV.`);
    }
  };

  // Draw the preview: once for images and paused video, every frame while video plays.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!media || !out || !canvas) return;
    const scale = Math.min(1, 900 / Math.max(out.w, out.h));
    const pw = Math.round(out.w * scale);
    const ph = Math.round(out.h * scale);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext('2d')!;
    const draw = () =>
      renderFrame(ctx, pw, ph, media.w, media.h, (c, x, y, w, h) => c.drawImage(media.el, x, y, w, h), bg, margin);
    draw();
    if (media.kind !== 'video') return;
    const v = media.el;
    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    const onSeeked = () => draw();
    v.addEventListener('seeked', onSeeked);
    if (playing) {
      v.play().catch(() => setPlaying(false));
      loop();
    } else v.pause();
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('seeked', onSeeked);
    };
  }, [media, out?.w, out?.h, bg, margin, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseName = media ? media.file.name.replace(/\.[^.]+$/, '') : 'output';
  const suffix = `${ratio.w}x${ratio.h}`;

  const exportImage = async () => {
    if (!media || media.kind !== 'image' || !out) return;
    const c = document.createElement('canvas');
    c.width = out.w;
    c.height = out.h;
    renderFrame(c.getContext('2d')!, out.w, out.h, media.w, media.h, (cx, x, y, w, h) => cx.drawImage(media.el, x, y, w, h), bg, margin);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, `image/${imgFormat}`, 0.95));
    if (blob) download(blob, `${baseName}-${suffix}.${imgFormat === 'png' ? 'png' : 'jpg'}`);
  };

  const exportVideo = async () => {
    if (!media || media.kind !== 'video' || !out) return;
    setPlaying(false);
    setError(null);
    setBusy({ progress: 0 });
    const job = padVideo({ file: media.file, outW: out.w, outH: out.h, bg, marginPct: margin, onProgress: (p) => setBusy({ progress: p }) });
    jobRef.current = job;
    try {
      download(await job.promise, `${baseName}-${suffix}.mp4`);
    } catch (e) {
      if (!(e instanceof Error && e.name === 'ConversionCanceledError')) {
        setError(e instanceof Error ? e.message : 'Video export failed.');
      }
    } finally {
      setBusy(null);
      jobRef.current = null;
    }
  };

  return (
    <div
      className={`tool${dragOver ? ' drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) load(f);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) load(f);
          e.target.value = '';
        }}
      />
      {error && <div className="error" role="alert">{error}</div>}

      {!media ? (
        <button className="drop" onClick={() => fileRef.current?.click()}>
          <span className="drop-title">Drop an image or video here, or click to choose one</span>
          <span className="drop-sub">
            Pads it to a new aspect ratio without cropping. Everything runs in your browser; nothing is uploaded.
          </span>
        </button>
      ) : (
        <main className="layout">
          <section className="imagecol">
            <div className="stage-wrap checker">
              <canvas ref={canvasRef} className="resize-canvas" />
            </div>
            <div className="imagebar">
              {media.kind === 'video' && (
                <button className="btn" onClick={() => setPlaying((p) => !p)} disabled={!!busy}>
                  {playing ? 'Pause preview' : 'Play preview'}
                </button>
              )}
              <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                Open another file
              </button>
              {media.kind === 'image' ? (
                <button className="btn primary" onClick={exportImage} disabled={!out}>
                  Download {imgFormat.toUpperCase()}
                </button>
              ) : busy ? (
                <span className="progress">
                  <span className="bar">
                    <span style={{ width: `${Math.round(busy.progress * 100)}%` }} />
                  </span>
                  {Math.round(busy.progress * 100)}%
                  <button className="link" onClick={() => jobRef.current?.cancel()}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button className="btn primary" onClick={exportVideo} disabled={!out}>
                  Download MP4
                </button>
              )}
            </div>
            <p className="muted small">
              {media.file.name}: {media.w}×{media.h} ({ratioLabel(media.w, media.h)})
              {out && <> → {out.w}×{out.h} ({ratioLabel(out.w, out.h)})</>}
            </p>
          </section>

          <section className="sidecol">
            <div className="card">
              <h2>Aspect ratio</h2>
              <div className="harmonies">
                {PRESETS.map((p) => (
                  <button key={p.id} className={`harm${presetId === p.id ? ' on' : ''}`} onClick={() => setPresetId(p.id)}>
                    <span className="harm-name">{p.label}</span>
                    <span className="harm-dev">{p.detail}</span>
                  </button>
                ))}
                <div className={`harm${presetId === 'custom' ? ' on' : ''}`} onClick={() => setPresetId('custom')}>
                  <span className="harm-name">Custom</span>
                  <span className="ratio-in">
                    <input
                      type="number"
                      min={1}
                      value={custom.w}
                      aria-label="Ratio width"
                      onChange={(e) => setCustom({ ...custom, w: Number(e.target.value) })}
                      onFocus={() => setPresetId('custom')}
                    />
                    :
                    <input
                      type="number"
                      min={1}
                      value={custom.h}
                      aria-label="Ratio height"
                      onChange={(e) => setCustom({ ...custom, h: Number(e.target.value) })}
                      onFocus={() => setPresetId('custom')}
                    />
                  </span>
                </div>
              </div>
            </div>

            <div className="card">
              <h2>Output size</h2>
              <div className="seg">
                <button className={sizeMode === 'instagram' ? 'on' : ''} onClick={() => setSizeMode('instagram')}>
                  Instagram (1080 px)
                </button>
                <button className={sizeMode === 'source' ? 'on' : ''} onClick={() => setSizeMode('source')}>
                  Full resolution
                </button>
              </div>
              <p className="muted small">
                {sizeMode === 'instagram'
                  ? 'Short side is 1080 px, the size Instagram recommends; it would downscale anything larger.'
                  : 'Keeps every source pixel; the canvas grows to fit (capped at 3840 px).'}
              </p>
            </div>

            <div className="card">
              <h2>Padding</h2>
              <div className="seg">
                <button className={bgKind === 'color' ? 'on' : ''} onClick={() => setBgKind('color')}>
                  Solid color
                </button>
                <button className={bgKind === 'blur' ? 'on' : ''} onClick={() => setBgKind('blur')}>
                  Blurred fill
                </button>
              </div>
              {bgKind === 'color' ? (
                <div className="swatches">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      className={`swatch${color === c ? ' on' : ''}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                      aria-label={`Padding color ${c}`}
                    />
                  ))}
                  <label className="swatch picker" title="Pick any color">
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom padding color" />
                  </label>
                  <span className="muted small mono">{color}</span>
                </div>
              ) : (
                <Slider label="Darken" value={dim} min={0} max={0.7} step={0.01} onChange={setDim} fmt={(v) => `${Math.round(v * 100)}%`} />
              )}
              <Slider label="Extra margin" value={margin} min={0} max={20} step={0.5} onChange={setMargin} fmt={(v) => `${v}%`} />
            </div>

            {media.kind === 'image' ? (
              <div className="card">
                <h2>Format</h2>
                <div className="seg">
                  <button className={imgFormat === 'png' ? 'on' : ''} onClick={() => setImgFormat('png')}>
                    PNG (lossless)
                  </button>
                  <button className={imgFormat === 'jpeg' ? 'on' : ''} onClick={() => setImgFormat('jpeg')}>
                    JPEG
                  </button>
                </div>
              </div>
            ) : (
              <div className="card">
                <h2>Video</h2>
                <p className="muted small" style={{ marginTop: 0 }}>
                  Exports an MP4 (H.264 where your browser supports it) at the original frame rate, keeping the audio. The
                  video is re-encoded on your device, so long clips take a while. Keep this tab open until it finishes.
                </p>
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <label className="slider">
      <span className="slider-row">
        <span>{props.label}</span>
        <span className="val">{props.fmt(props.value)}</span>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}
