import { useRef } from 'react';
import { hueCss, normHue } from '../lib/color';
import type { Assignment } from '../lib/harmony';

type Props = {
  bins: Float64Array | null;
  assignments: Assignment[];
  targets: number[];
  rotation: number;
  onRotate: (deg: number) => void;
};

const R_OUT = 192;
const R_IN = 166;
const R_CLUSTER = 150;
const R_HIST0 = 46;
const R_HIST1 = 136;

const pt = (hue: number, r: number): [number, number] => {
  const a = ((hue - 90) * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
};

const f = (n: number) => n.toFixed(2);

function annulusSeg(h0: number, h1: number, r0: number, r1: number) {
  const [ax, ay] = pt(h0, r1);
  const [bx, by] = pt(h1, r1);
  const [cx, cy] = pt(h1, r0);
  const [dx, dy] = pt(h0, r0);
  return `M${f(ax)} ${f(ay)}A${r1} ${r1} 0 0 1 ${f(bx)} ${f(by)}L${f(cx)} ${f(cy)}A${r0} ${r0} 0 0 0 ${f(dx)} ${f(dy)}Z`;
}

const RING = Array.from({ length: 120 }, (_, i) => i * 3);

export function HueWheel({ bins, assignments, targets, rotation, onRotate }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ startAngle: number; startRot: number } | null>(null);

  const pointerHue = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    return normHue((Math.atan2(y, x) * 180) / Math.PI + 90);
  };

  // Smooth the histogram a little and scale by sqrt so small hues stay visible.
  let histBars: { hue: number; len: number }[] = [];
  if (bins) {
    const sm = Array.from({ length: 360 }, (_, i) => {
      let s = 0;
      for (let o = -2; o <= 2; o++) s += bins[(i + o + 360) % 360] * (3 - Math.abs(o));
      return s;
    });
    const max = Math.max(...sm, 1e-9);
    histBars = sm.map((v, hue) => ({ hue, len: Math.sqrt(v / max) }));
  }

  return (
    <svg
      ref={svgRef}
      className="wheel"
      viewBox="-200 -200 400 400"
      role="img"
      aria-label="Hue wheel with clusters and harmony targets. Drag to rotate the harmony."
      onPointerDown={(e) => {
        if (!targets.length) return;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { startAngle: pointerHue(e), startRot: rotation };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const d = pointerHue(e) - drag.current.startAngle;
        onRotate(normHue(drag.current.startRot + d));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--ink)" />
        </marker>
      </defs>

      {RING.map((h) => (
        <path key={h} d={annulusSeg(h, h + 3.3, R_IN, R_OUT)} fill={hueCss(h + 1.5, 90, 52)} />
      ))}
      <circle r={R_HIST1} fill="none" stroke="var(--line)" />
      <circle r={R_HIST0} fill="none" stroke="var(--line)" />

      {histBars.map(({ hue, len }) =>
        len > 0.01 ? (
          <path key={hue} d={annulusSeg(hue, hue + 1.05, R_HIST0, R_HIST0 + len * (R_HIST1 - R_HIST0))} fill={hueCss(hue + 0.5, 70, 55)} />
        ) : null,
      )}

      {targets.length > 1 && (
        <polygon
          points={targets.map((t) => pt(t, R_IN - 2).map(f).join(',')).join(' ')}
          fill="none"
          stroke="var(--ink)"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
      )}
      {targets.map((t, i) => {
        const [x, y] = pt(t, R_IN - 2);
        return <line key={`s${i}`} x1={0} y1={0} x2={f(x)} y2={f(y)} stroke="var(--ink)" strokeOpacity={0.35} strokeWidth={1} />;
      })}

      {assignments.map((a, i) => {
        if (Math.abs(a.delta) < 1) return null;
        const [x0, y0] = pt(a.cluster.hue, R_CLUSTER);
        const [x1, y1] = pt(a.target, R_CLUSTER);
        const sweep = a.delta > 0 ? 1 : 0;
        return (
          <path
            key={`a${i}`}
            d={`M${f(x0)} ${f(y0)}A${R_CLUSTER} ${R_CLUSTER} 0 0 ${sweep} ${f(x1)} ${f(y1)}`}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={2}
            markerEnd="url(#arrow)"
          />
        );
      })}

      {targets.map((t, i) => {
        const [x, y] = pt(t, (R_IN + R_OUT) / 2);
        return (
          <g key={`t${i}`}>
            <circle cx={f(x)} cy={f(y)} r={10} fill={hueCss(t, 90, 52)} stroke="#000" strokeWidth={4} />
            <circle cx={f(x)} cy={f(y)} r={10} fill="none" stroke="#fff" strokeWidth={2} />
          </g>
        );
      })}

      {assignments.map((a, i) => {
        const [x, y] = pt(a.cluster.hue, R_CLUSTER);
        const r = 5 + 11 * Math.sqrt(a.cluster.weight);
        return (
          <g key={`c${i}`}>
            <circle cx={f(x)} cy={f(y)} r={r} fill={hueCss(a.cluster.hue, 80, 50)} stroke="var(--bg)" strokeWidth={2.5} />
            {a.cluster.sampleId && <circle cx={f(x)} cy={f(y)} r={2.5} fill="#fff" />}
          </g>
        );
      })}
    </svg>
  );
}
