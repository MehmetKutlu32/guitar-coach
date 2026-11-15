export interface FretDot {
  /** Tel dizini: 0 = 6. tel (kalın Mi). */
  string: number;
  fret: number;
  label: string;
  kind: 'root' | 'tone' | 'faded' | 'target' | 'good' | 'bad';
}

const W = 344;
const H = 172;
const NUT = 28;
const RIGHT = 340;
const TOP = 18;
const GAP = 24;
const SPAN = 12;
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE = [12, 24];
const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

/**
 * Yatay gitar sapı (12 perdelik pencere). Kalın Mi teli altta, ince Mi üstte — tab ile aynı yön.
 * @param start Pencereden önceki perde: 0 ise açık teller ve eşik gösterilir.
 */
export function Fretboard(props: {
  dots: FretDot[];
  start?: number;
  onTap?: (dot: FretDot) => void;
  title: string;
  testid?: string;
  /** Vurgulanacak tel (dizin); oyunda sorulan tel. */
  highlightString?: number;
}) {
  const start = props.start ?? 0;
  const fretW = (RIGHT - NUT) / SPAN;
  const y = (string: number) => TOP + (5 - string) * GAP;
  const x = (fret: number) => (fret === 0 ? NUT / 2 : NUT + (fret - start - 0.5) * fretW);
  const frets = Array.from({ length: SPAN }, (_, i) => start + i + 1);
  const midY = TOP + 2.5 * GAP;

  return (
    <svg class="neck" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.title} data-testid={props.testid} data-start={start}>
      <rect x={NUT} y={TOP - 6} width={RIGHT - NUT} height={5 * GAP + 12} class="neck-board" rx="3" />
      {frets.map((f, i) => (
        <g>
          <line x1={NUT + (i + 1) * fretW} x2={NUT + (i + 1) * fretW} y1={TOP - 6} y2={TOP + 5 * GAP + 6} class="neck-fret" />
          {INLAYS.includes(f) && <circle cx={x(f)} cy={midY} r="4" class="neck-inlay" />}
          {DOUBLE.includes(f) && (
            <>
              <circle cx={x(f)} cy={midY - GAP} r="4" class="neck-inlay" />
              <circle cx={x(f)} cy={midY + GAP} r="4" class="neck-inlay" />
            </>
          )}
          <text x={x(f)} y={H - 6} class={`neck-num ${INLAYS.includes(f) || DOUBLE.includes(f) ? 'mark' : ''}`} text-anchor="middle">
            {f}
          </text>
        </g>
      ))}
      <line x1={NUT} x2={NUT} y1={TOP - 6} y2={TOP + 5 * GAP + 6} class={start === 0 ? 'neck-nut' : 'neck-fret'} />
      {STRING_NAMES.map((name, s) => (
        <g>
          <line
            x1={start === 0 ? 2 : NUT}
            x2={RIGHT}
            y1={y(s)}
            y2={y(s)}
            class={`neck-string ${props.highlightString === s ? 'hl' : ''}`}
            stroke-width={2.4 - s * 0.28}
          />
          {start > 0 && (
            <text x={NUT / 2} y={y(s) + 4} class="neck-num" text-anchor="middle">
              {name}
            </text>
          )}
        </g>
      ))}
      {props.dots
        .filter((d) => (d.fret === 0 ? start === 0 : d.fret > start && d.fret <= start + SPAN))
        .map((d) => (
          <g
            class={`neck-dot ${d.kind}`}
            data-string={d.string}
            data-fret={d.fret}
            onClick={props.onTap ? () => props.onTap!(d) : undefined}
          >
            {/* Görünmez dokunma alanı: perde hücresinin tamamı (nokta tek başına parmak için küçük). */}
            <rect
              x={d.fret === 0 ? 0 : x(d.fret) - fretW / 2}
              y={y(d.string) - GAP / 2}
              width={d.fret === 0 ? NUT : fretW}
              height={GAP}
              class="neck-hit"
            />
            <circle cx={x(d.fret)} cy={y(d.string)} r="10.5" />
            <text x={x(d.fret)} y={y(d.string) + 3.6} text-anchor="middle">
              {d.label}
            </text>
          </g>
        ))}
    </svg>
  );
}
