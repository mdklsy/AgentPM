import type { BurndownPoint } from '../api/types.js';

/** SVG 折线（浅依赖，不引图表库）：X=日期，Y=剩余量。 */
export function BurndownChart({ points, total }: { points: BurndownPoint[]; total: number }) {
  const W = 640;
  const H = 220;
  const PAD = { l: 34, r: 12, t: 14, b: 26 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const n = Math.max(1, points.length - 1);
  const yMax = Math.max(total, ...points.map((p) => Math.max(p.remaining, p.ideal)), 1);

  const x = (i: number) => PAD.l + (i / n) * iw;
  const y = (v: number) => PAD.t + ih - (v / yMax) * ih;

  const line = (key: 'remaining' | 'ideal') =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`)
      .join(' ');
  const area =
    points.length > 0
      ? `${line('remaining')} L ${x(points.length - 1).toFixed(1)} ${y(0)} L ${x(0)} ${y(0)} Z`
      : '';

  const labelEvery = Math.ceil(points.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="燃尽图">
      {/* 网格 */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + ih * f}
            y2={PAD.t + ih * f}
            stroke="#e2e8f0"
            strokeWidth="1"
          />
          <text x={PAD.l - 6} y={PAD.t + ih * f + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
            {Math.round(yMax * (1 - f))}
          </text>
        </g>
      ))}
      {/* 日期轴 */}
      {points.map((p, i) =>
        i % labelEvery === 0 ? (
          <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">
            {p.date.slice(5)}
          </text>
        ) : null,
      )}
      {/* 理想线（虚线） */}
      <path
        d={line('ideal')}
        fill="none"
        stroke="#cbd5e1"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      {/* 实际剩余（面积+实线） */}
      <path d={area} fill="rgba(99,102,241,0.10)" />
      <path
        d={line('remaining')}
        fill="none"
        stroke="#4f46e5"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {points.length > 0 && (
        <circle
          cx={x(points.length - 1)}
          cy={y(points[points.length - 1]!.remaining)}
          r="4"
          fill="#4f46e5"
        />
      )}
    </svg>
  );
}

/** 速率柱状图（纯 div，无 SVG）。 */
export function VelocityBars({
  items,
}: {
  items: Array<{ name: string; done: number; total: number }>;
}) {
  const max = Math.max(1, ...items.map((i) => i.total));
  return (
    <div className="flex h-36 items-end gap-3">
      {items.map((s) => (
        <div key={s.name} className="flex w-16 flex-col items-center gap-1">
          <span className="text-xs font-bold text-emerald-600">{s.done}</span>
          <div className="flex w-full flex-col justify-end" style={{ height: '88px' }}>
            <div
              className="w-full rounded-t bg-emerald-500"
              style={{ height: `${(s.done / max) * 88}px` }}
            />
            <div
              className="w-full rounded-b bg-slate-200"
              style={{ height: `${((s.total - s.done) / max) * 88}px` }}
            />
          </div>
          <span className="truncate text-[11px] text-slate-500">{s.name}</span>
        </div>
      ))}
      {items.length === 0 && <p className="text-xs text-slate-300">暂无已完成的 Sprint</p>}
    </div>
  );
}
