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

const DEV_RANGE = 100;

function devClass(ms: number): string {
  const d = Math.abs(ms);
  return d <= 20 ? 'good' : d <= 50 ? 'ok' : 'off';
}

/** Vuruş başına sapma grafiği: yatayda vuruş sırası, dikeyde erken (alt) / geç (üst) sapma (ms). */
export function DeviationChart({
  deviations,
  title,
  testid,
}: {
  deviations: (number | null)[];
  title: string;
  testid?: string;
}) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - 10;
  const n = Math.max(1, deviations.length);
  const x = (i: number) => PAD.left + ((i + 0.5) / n) * innerW;
  const y = (ms: number) => PAD.top + (0.5 - Math.max(-DEV_RANGE, Math.min(DEV_RANGE, ms)) / (2 * DEV_RANGE)) * innerH;
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} data-testid={testid}>
      <rect x={PAD.left} y={y(20)} width={innerW} height={y(-20) - y(20)} class="dev-band" />
      {[-DEV_RANGE, 0, DEV_RANGE].map((v) => (
        <g>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} class={v === 0 ? 'dev-zero' : 'chart-grid'} />
          <text x={PAD.left - 6} y={y(v) + 4} class="chart-tick" text-anchor="end">
            {v > 0 ? `+${v}` : v}
          </text>
        </g>
      ))}
      {deviations.map((d, i) =>
        d === null ? (
          <path
            d={`M${x(i) - 3} ${y(0) - 3}l6 6m0 -6l-6 6`}
            class="dev-miss"
          />
        ) : (
          <circle cx={x(i)} cy={y(d)} r="3.6" class={`dev-dot ${devClass(d)}`}>
            <title>{`${i + 1}: ${d > 0 ? '+' : ''}${Math.round(d)} ms`}</title>
          </circle>
        ),
      )}
    </svg>
  );
}

/** Canlı zamanlama şeridi: ortası tam vuruş, solu erken, sağı geç. Son vuruşlar soluklaşarak görünür. */
export function TimingLane({ recent, testid }: { recent: number[]; testid?: string }) {
  const w = 320;
  const h = 64;
  const x = (ms: number) => w / 2 + (Math.max(-DEV_RANGE, Math.min(DEV_RANGE, ms)) / DEV_RANGE) * (w / 2 - 12);
  const last = recent.length ? recent[recent.length - 1] : null;
  return (
    <svg class="lane" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" data-testid={testid}>
      <rect x="2" y="14" width={w - 4} height="36" rx="18" class="lane-track" />
      <rect x={x(-20)} y="14" width={x(20) - x(-20)} height="36" class="lane-good" />
      <line x1={w / 2} x2={w / 2} y1="6" y2={h - 6} class="lane-center" />
      {recent.slice(0, -1).map((d, i) => (
        <circle cx={x(d)} cy={h / 2} r="6" class={`lane-dot ${devClass(d)}`} opacity={0.15 + (0.5 * (i + 1)) / recent.length} />
      ))}
      {last !== null && <circle cx={x(last)} cy={h / 2} r="11" class={`lane-dot last ${devClass(last)}`} />}
    </svg>
  );
}
