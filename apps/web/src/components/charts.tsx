import type { AgileReport, BurndownPoint } from '../api/types.js';

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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

/** 周期时间散点图（M6）：X=完成日期，Y=从进入进行中到完成的天数；P50/P85 参考虚线。 */
export function CycleTimeChart({ data }: { data: AgileReport['cycleTimes'] }) {
  const W = 640;
  const H = 220;
  const PAD = { l: 34, r: 12, t: 14, b: 26 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  if (data.length === 0)
    return (
      <p className="py-10 text-center text-xs text-slate-300">
        还没有完成的 issue——完成第一个后这里会出现周期散点
      </p>
    );

  const sorted = [...data].sort((a, b) => a.doneAt.localeCompare(b.doneAt));
  const days = sorted.map((d) => d.cycleDays);
  const yMax = Math.max(...days, 1);
  const p50 = percentile(
    [...days].sort((a, b) => a - b),
    50,
  );
  const p85 = percentile(
    [...days].sort((a, b) => a - b),
    85,
  );

  const x = (i: number) => PAD.l + (sorted.length === 1 ? iw / 2 : (i / (sorted.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (Math.min(v, yMax) / yMax) * ih;

  const labelEvery = Math.ceil(sorted.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="周期时间散点图">
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
      {sorted.map((d, i) =>
        i % labelEvery === 0 ? (
          <text key={d.issueKey} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">
            {d.doneAt.slice(5, 10)}
          </text>
        ) : null,
      )}
      {/* P50 / P85 参考线 */}
      <line
        x1={PAD.l}
        x2={W - PAD.r}
        y1={y(p50)}
        y2={y(p50)}
        stroke="#10b981"
        strokeWidth="1.2"
        strokeDasharray="5 4"
      />
      <text x={W - PAD.r} y={y(p50) - 4} textAnchor="end" fontSize="10" fill="#10b981">
        P50 {Number.isInteger(p50) ? p50 : p50.toFixed(1)}天
      </text>
      <line
        x1={PAD.l}
        x2={W - PAD.r}
        y1={y(p85)}
        y2={y(p85)}
        stroke="#f59e0b"
        strokeWidth="1.2"
        strokeDasharray="5 4"
      />
      <text x={W - PAD.r} y={y(p85) - 4} textAnchor="end" fontSize="10" fill="#d97706">
        P85 {Number.isInteger(p85) ? p85 : p85.toFixed(1)}天
      </text>
      {sorted.map((d, i) => (
        <circle
          key={d.issueKey}
          cx={x(i)}
          cy={y(d.cycleDays)}
          r="4.5"
          fill="#4f46e5"
          fillOpacity="0.75"
        >
          <title>{`${d.issueKey} ${d.title} · ${d.cycleDays} 天`}</title>
        </circle>
      ))}
    </svg>
  );
}

const CFD_SERIES = [
  { key: 'done', label: '已完成', color: '#a7f3d0', line: '#10b981' },
  { key: 'inProgress', label: '进行中', color: '#fde68a', line: '#f59e0b' },
  { key: 'todo', label: '待办', color: '#c7d2fe', line: '#6366f1' },
] as const;

/** 累积流图 CFD（M6）：逐日堆叠面积——待办/进行中/完成，带宝始终等于 issue 总数。 */
export function CfdChart({ data }: { data: AgileReport['cfd'] }) {
  const W = 640;
  const H = 220;
  const PAD = { l: 34, r: 12, t: 14, b: 26 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  if (data.length < 2)
    return (
      <p className="py-10 text-center text-xs text-slate-300">
        至少需要两个自然日的数据才会画出累积流
      </p>
    );

  const yMax = Math.max(...data.map((d) => d.todo + d.inProgress + d.done), 1);
  const n = data.length - 1;
  const x = (i: number) => PAD.l + (i / n) * iw;
  const y = (v: number) => PAD.t + ih - (v / yMax) * ih;

  const labelEvery = Math.ceil(data.length / 8);

  // 自底向上堆叠：todo → inProgress → done
  const stackBands = CFD_SERIES.map((s) => {
    let lower = data.map(() => 0);
    for (const prev of CFD_SERIES) {
      if (prev === s) break;
      lower = lower.map((v, i) => v + (data[i]![prev.key as 'todo'] as number));
    }
    const upper = lower.map((v, i) => v + (data[i]![s.key as 'todo'] as number));
    const top = upper
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(' ');
    const bottom = [...lower]
      .map((v, i) => ({ v, i }))
      .reverse()
      .map(({ v, i }) => `L ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(' ');
    return { ...s, path: `${top} ${bottom} Z` };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="累积流图">
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
      {data.map((d, i) =>
        i % labelEvery === 0 ? (
          <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">
            {d.date.slice(5)}
          </text>
        ) : null,
      )}
      {stackBands.map((b) => (
        <g key={b.key}>
          <path d={b.path} fill={b.color} fillOpacity="0.85" />
          <path d={b.path} fill="none" stroke={b.line} strokeWidth="1.5" />
        </g>
      ))}
      {/* 图例 */}
      {[...CFD_SERIES].reverse().map((s) => (
        <g key={s.key}>
          <rect
            x={PAD.l + 8}
            y={PAD.t + 4 + CFD_SERIES.indexOf(s) * 14}
            width="10"
            height="10"
            rx="2"
            fill={s.color}
            stroke={s.line}
            strokeWidth="0.8"
          />
          <text
            x={PAD.l + 22}
            y={PAD.t + 13 + CFD_SERIES.indexOf(s) * 14}
            fontSize="10"
            fill="#64748b"
          >
            {s.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
