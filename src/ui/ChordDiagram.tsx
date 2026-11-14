import { diagramLayout, STANDARD_TUNING, type ChordShape } from '../music/chords';
import { mod12 } from '../music/theory';

const W = 120;
const LEFT = 20;
const RIGHT = 100;
const TOP = 30;
const ROW = 24;

/** SVG akor diyagramı: dikey teller (solda kalın Mi), yatay perdeler. */
export function ChordDiagram({ shape, title }: { shape: ChordShape; title?: string }) {
  const { baseFret, rows, barre } = diagramLayout(shape);
  const bottom = TOP + rows * ROW;
  const height = bottom + 12;
  const sx = (i: number) => LEFT + (i * (RIGHT - LEFT)) / 5;
  const fy = (fret: number) => TOP + (fret - baseFret + 0.5) * ROW;
  const isRoot = (i: number) => mod12(STANDARD_TUNING[i] + shape.frets[i]) === shape.root;

  return (
    <svg class="chord-diagram" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title ?? shape.symbol}>
      {/* perdeler */}
      {Array.from({ length: rows + 1 }, (_, r) => (
        <line x1={LEFT} x2={RIGHT} y1={TOP + r * ROW} y2={TOP + r * ROW} class="cd-fret" />
      ))}
      {baseFret === 1 ? (
        <line x1={LEFT - 1} x2={RIGHT + 1} y1={TOP - 1.5} y2={TOP - 1.5} class="cd-nut" />
      ) : (
        <text x={LEFT - 6} y={TOP + ROW / 2 + 4} class="cd-base" text-anchor="end">
          {baseFret}
        </text>
      )}
      {/* teller */}
      {shape.frets.map((_, i) => (
        <line x1={sx(i)} x2={sx(i)} y1={TOP} y2={bottom} class="cd-string" stroke-width={2.2 - i * 0.22} />
      ))}
      {/* açık / çalınmayan tel işaretleri */}
      {shape.frets.map((f, i) =>
        f === -1 ? (
          <g class="cd-mute">
            <line x1={sx(i) - 4} y1={TOP - 15} x2={sx(i) + 4} y2={TOP - 7} />
            <line x1={sx(i) + 4} y1={TOP - 15} x2={sx(i) - 4} y2={TOP - 7} />
          </g>
        ) : f === 0 ? (
          <circle cx={sx(i)} cy={TOP - 11} r="4.2" class={`cd-open ${isRoot(i) ? 'root' : ''}`} />
        ) : null,
      )}
      {/* bare */}
      {barre && (
        <g>
          <rect
            x={sx(barre.from) - 7}
            y={fy(barre.fret) - 7}
            width={sx(barre.to) - sx(barre.from) + 14}
            height="14"
            rx="7"
            class="cd-barre"
          />
          <text x={sx(barre.from)} y={fy(barre.fret) + 3.6} class="cd-finger" text-anchor="middle">
            1
          </text>
        </g>
      )}
      {/* parmaklar */}
      {shape.frets.map((f, i) => {
        if (f <= 0) return null;
        if (barre && shape.fingers[i] === 1 && f === barre.fret) return null;
        return (
          <g>
            <circle cx={sx(i)} cy={fy(f)} r="8" class={`cd-dot ${isRoot(i) ? 'root' : ''}`} />
            {shape.fingers[i] > 0 && (
              <text x={sx(i)} y={fy(f) + 3.6} class="cd-finger" text-anchor="middle">
                {shape.fingers[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
