const W = 320;

/**
 * Dalga formu: tepe değerleri (0–100) ortadan iki yana çubuklar olarak çizilir.
 * @param cursor Çalma konumu (0..1); çalınan bölüm vurgulanır. null ise imleç yok.
 * @param onSeek Verilirse dalga formuna dokunmak o konumu (0..1) bildirir.
 */
export function Waveform(props: {
  peaks: number[];
  cursor?: number | null;
  onSeek?: (fraction: number) => void;
  title: string;
  testid?: string;
  height?: number;
  /** Vurgulanacak bölüm (0..1 başlangıç ve bitiş): A–B döngüsü. */
  region?: [number, number] | null;
  /** Aynı sayfadaki dalga formlarını ayırmak için (kırpma maskesi kimliği). */
  uid: string;
}) {
  const h = props.height ?? 64;
  const mid = h / 2;
  const n = Math.max(1, props.peaks.length);
  const step = W / n;
  const bar = Math.max(0.6, step * 0.7);
  // Kısık kayıtlar da okunabilsin diye çizim kaydın kendi tepe değerine göre ölçeklenir (en çok 4 kat).
  const top = Math.max(25, ...props.peaks);
  const d = props.peaks
    .map((p, i) => {
      const half = Math.max(0.6, (Math.min(top, Math.max(0, p)) / top) * (mid - 3));
      const x = (i + 0.5) * step;
      return `M${x.toFixed(2)} ${(mid - half).toFixed(2)}V${(mid + half).toFixed(2)}`;
    })
    .join('');
  const cursor = props.cursor ?? null;
  const clip = `wf-${props.uid}`;
  const seek = props.onSeek;
  return (
    <svg
      class={`waveform ${seek ? 'seekable' : ''}`}
      viewBox={`0 0 ${W} ${h}`}
      preserveAspectRatio="none"
      style={{ height: `${h}px` }}
      role="img"
      aria-label={props.title}
      data-testid={props.testid}
      data-max={Math.max(0, ...props.peaks)}
      data-cursor={cursor === null ? '' : cursor.toFixed(3)}
      onClick={
        seek
          ? (e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              seek(r.width > 0 ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0);
            }
          : undefined
      }
    >
      {props.region && (
        <rect
          x={props.region[0] * W}
          y="0"
          width={Math.max(0, props.region[1] - props.region[0]) * W}
          height={h}
          class="waveform-region"
          data-testid={props.testid ? `${props.testid}-region` : undefined}
        />
      )}
      <line x1="0" x2={W} y1={mid} y2={mid} class="waveform-axis" />
      <path d={d} class="waveform-bars" stroke-width={bar} />
      {cursor !== null && (
        <>
          <clipPath id={clip}>
            <rect x="0" y="0" width={cursor * W} height={h} />
          </clipPath>
          <path d={d} class="waveform-bars played" stroke-width={bar} clip-path={`url(#${clip})`} />
          <line x1={cursor * W} x2={cursor * W} y1="0" y2={h} class="waveform-cursor" />
        </>
      )}
    </svg>
  );
}
