/** Bağımlılıksız küçük SVG grafikler. */

export interface ChartPoint {
  value: number;
  label: string;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

const W = 320;
const H = 150;
const PAD = { left: 30, right: 10, top: 12, bottom: 24 };

function Axes({ max, first, last }: { max: number; first?: string; last?: string }) {
  const ticks = [0, max / 2, max];
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  return (
    <g>
      {ticks.map((v) => (
        <g>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} class="chart-grid" />
          <text x={PAD.left - 6} y={y(v) + 4} class="chart-tick" text-anchor="end">
            {Number.isInteger(v) ? v : v.toFixed(1)}
          </text>
        </g>
      ))}
      {first && (
        <text x={PAD.left} y={H - 6} class="chart-tick">
          {first}
        </text>
      )}
      {last && last !== first && (
        <text x={W - PAD.right} y={H - 6} class="chart-tick" text-anchor="end">
          {last}
        </text>
      )}
    </g>
  );
}

/** Zaman içindeki gelişim için çizgi grafik. */
export function LineChart({ points, title, testid }: { points: ChartPoint[]; title: string; testid?: string }) {
  const max = niceMax(Math.max(...points.map((p) => p.value), 1));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + (1 - v / max) * innerH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} data-testid={testid}>
      <Axes max={max} first={points[0]?.label} last={points[points.length - 1]?.label} />
      {points.length > 1 && <path d={path} class="chart-line" />}
      {points.map((p, i) => (
        <circle cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 5 : 3.5} class="chart-dot">
          <title>{`${p.label}: ${p.value}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Dönem başına toplamlar için çubuk grafik. */
export function BarChart({
  points,
  title,
  testid,
  highlightLast,
}: {
  points: ChartPoint[];
  title: string;
  testid?: string;
  highlightLast?: boolean;
}) {
  const max = niceMax(Math.max(...points.map((p) => p.value), 1));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, points.length);
  const barW = Math.min(28, slot * 0.7);
  const everyLabel = Math.ceil(points.length / 8);
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} data-testid={testid}>
      <Axes max={max} />
      {points.map((p, i) => {
        const h = (p.value / max) * innerH;
        const cx = PAD.left + slot * (i + 0.5);
        return (
          <g>
            <rect
              x={cx - barW / 2}
              y={PAD.top + innerH - h}
              width={barW}
              height={Math.max(h, p.value > 0 ? 2 : 0)}
              rx="3"
              class={`chart-bar ${highlightLast && i === points.length - 1 ? 'now' : ''}`}
            >
              <title>{`${p.label}: ${p.value}`}</title>
            </rect>
            {i % everyLabel === 0 && (
              <text x={cx} y={H - 6} class="chart-tick" text-anchor="middle">
                {p.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
