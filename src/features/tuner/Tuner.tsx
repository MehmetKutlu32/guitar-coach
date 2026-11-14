import { useEffect, useRef, useState } from 'preact/hooks';
import { resumeAudio } from '../../audio/engine';
import { acquireInput, inputStatus, onAnalysis } from '../../audio/input';
import { playPluck } from '../../audio/synth/guitar';
import { midiLabel, midiToFreq } from '../../dsp/notes';
import { fmtNumber, t } from '../../i18n';
import { settings } from '../../settings';
import { Card, LevelMeter, Notice } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { evaluatePitch, getTuning, IN_TUNE_CENTS, PitchSmoother, TUNINGS, tuningLetters, type TunerReading } from './logic';

const CX = 150;
const CY = 150;
const R = 122;
const SPAN = 62; // ±50 cent → ±62°

function polar(angleDeg: number, radius: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
}

function arc(from: number, to: number, radius: number): string {
  const [x1, y1] = polar(from, radius);
  const [x2, y2] = polar(to, radius);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${radius} ${radius} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function Gauge({ cents, active }: { cents: number | null; active: boolean }) {
  const shown = cents === null ? 0 : Math.max(-50, Math.min(50, cents));
  const angle = (shown / 50) * SPAN;
  const inTune = cents !== null && Math.abs(cents) <= IN_TUNE_CENTS;
  const ticks = [];
  for (let c = -50; c <= 50; c += 5) {
    const major = c % 10 === 0;
    const a = (c / 50) * SPAN;
    const [x1, y1] = polar(a, R - (c === 0 ? 20 : major ? 14 : 8));
    const [x2, y2] = polar(a, R);
    ticks.push(<line x1={x1} y1={y1} x2={x2} y2={y2} class={c === 0 ? 'tick zero' : major ? 'tick major' : 'tick'} />);
  }
  const zone = (IN_TUNE_CENTS / 50) * SPAN;
  return (
    <svg class={`gauge ${inTune ? 'in-tune' : ''} ${active ? 'active' : ''}`} viewBox="0 0 300 168" role="img" aria-hidden="true">
      <path d={arc(-SPAN, SPAN, R)} class="gauge-arc" />
      <path d={arc(-zone, zone, R)} class="gauge-zone" />
      {ticks}
      <text x={polar(-SPAN, R + 16)[0] - 4} y={polar(-SPAN, R + 16)[1] + 4} class="gauge-label" text-anchor="middle">
        −50
      </text>
      <text x={polar(SPAN, R + 16)[0] + 4} y={polar(SPAN, R + 16)[1] + 4} class="gauge-label" text-anchor="middle">
        +50
      </text>
      <g class="needle" style={{ transform: `rotate(${angle.toFixed(2)}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
        <line x1={CX} y1={CY} x2={CX} y2={CY - R + 6} />
      </g>
      <circle cx={CX} cy={CY} r="9" class="needle-hub" />
    </svg>
  );
}

export function Tuner() {
  const status = inputStatus.value;
  const tuning = getTuning(settings.tuningId.value);
  const a4 = settings.a4.value;
  const [reading, setReading] = useState<TunerReading | null>(null);
  const [locked, setLocked] = useState<number | null>(null);
  const [tuned, setTuned] = useState<number[]>([]);
  const release = useRef<(() => void) | null>(null);
  const smoother = useRef(new PitchSmoother());
  const lockedRef = useRef<number | null>(null);
  const inTuneFrames = useRef(0);
  lockedRef.current = locked;

  useEffect(() => {
    const off = onAnalysis((frame) => {
      const freq = smoother.current.push(frame.freq, frame.clarity, frame.rms);
      if (freq === null) {
        inTuneFrames.current = 0;
        setReading(null);
        return;
      }
      const r = evaluatePitch(freq, getTuning(settings.tuningId.peek()), settings.a4.peek(), lockedRef.current);
      setReading(r);
      if (Math.abs(r.cents) <= IN_TUNE_CENTS && r.stringIndex !== null) {
        // Yarım saniye boyunca akortlu kalırsa teli "tamam" işaretle.
        if (++inTuneFrames.current === 24) {
          const idx = r.stringIndex;
          setTuned((prev) => (prev.includes(idx) ? prev : [...prev, idx]));
        }
      } else {
        inTuneFrames.current = 0;
      }
    });
    return () => {
      off();
      release.current?.();
      release.current = null;
    };
  }, []);

  // Akort düzeni değişince kilit ve işaretler sıfırlanır.
  useEffect(() => {
    setLocked(null);
    setTuned([]);
    smoother.current.reset();
  }, [tuning.id]);

  const start = async () => {
    try {
      release.current = await acquireInput();
    } catch {
      /* durum sinyali hatayı gösterir */
    }
  };
  const stop = () => {
    release.current?.();
    release.current = null;
    smoother.current.reset();
    setReading(null);
  };

  const onString = async (index: number) => {
    await resumeAudio();
    playPluck(midiToFreq(tuning.notes[index], a4), { gain: 0.8, duration: 3 });
    setLocked((prev) => (prev === index ? null : index));
  };

  const running = status === 'running';
  const cents = reading ? reading.cents : null;
  const inTune = cents !== null && Math.abs(cents) <= IN_TUNE_CENTS;
  const hint = !running
    ? ''
    : cents === null
      ? t('tuner.listening')
      : inTune
        ? t('tuner.inTune')
        : cents < 0
          ? t('tuner.tooLow')
          : t('tuner.tooHigh');
  const activeString = reading?.stringIndex ?? locked;
  const rounded = cents === null ? 0 : Math.round(cents);
  const centsText = `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${fmtNumber(Math.abs(rounded))}`;

  return (
    <div class="tuner">
      <Card class="tuner-main" testid="tuner">
        <Gauge cents={cents} active={running && cents !== null} />
        <div class="tuner-readout" aria-live="polite">
          <div class={`tuner-note ${inTune ? 'good' : ''}`} data-testid="tuner-note">
            {reading ? (
              <>
                {reading.name}
                <sub>{reading.octave}</sub>
              </>
            ) : (
              <span class="dim">–</span>
            )}
          </div>
          <div class="tuner-sub">
            <span data-testid="tuner-cents" data-cents={cents === null ? '' : cents.toFixed(1)}>
              {cents === null ? ' ' : t('tuner.cents', { n: centsText })}
            </span>
            {reading && <span class="dim"> · {fmtNumber(reading.freq, 1)} Hz</span>}
          </div>
          <div
            class={`tuner-hint ${inTune ? 'good' : cents !== null ? 'warn' : ''}`}
            data-testid="tuner-hint"
          >
            {hint || ' '}
          </div>
        </div>

        {running && <LevelMeter />}
        {status === 'denied' && <Notice kind="error" testid="input-error">{t('input.denied')}</Notice>}
        {status === 'unavailable' && <Notice kind="error" testid="input-error">{t('input.unavailable')}</Notice>}
        {status === 'error' && <Notice kind="error" testid="input-error">{t('input.error')}</Notice>}
        {!running && status !== 'starting' && <p class="help center">{t('tuner.intro')}</p>}

        {running ? (
          <button type="button" class="btn block" onClick={stop} data-testid="tuner-stop">
            <Icon name="stop" /> {t('tuner.stop')}
          </button>
        ) : (
          <button
            type="button"
            class="btn primary block big"
            onClick={start}
            disabled={status === 'starting'}
            data-testid="tuner-start"
          >
            <Icon name="mic" /> {t('tuner.start')}
          </button>
        )}
      </Card>

      <Card title={t('tuner.tuning')}>
        <select
          class="select"
          aria-label={t('tuner.tuning')}
          value={tuning.id}
          onChange={(e) => (settings.tuningId.value = (e.target as HTMLSelectElement).value)}
          data-testid="tuning-select"
        >
          {TUNINGS.map((tn) => (
            <option value={tn.id}>
              {t(tn.name)}
              {tn.notes.length ? ` — ${tuningLetters(tn)}` : ''}
            </option>
          ))}
        </select>

        {tuning.notes.length > 0 ? (
          <>
            <div class="strings" role="group" aria-label={t('tuner.strings')} data-testid="strings">
              {tuning.notes.map((midi, i) => {
                const label = midiLabel(midi, tuning.id === 'halfDown');
                const cls = [
                  'string-btn',
                  activeString === i ? 'active' : '',
                  locked === i ? 'locked' : '',
                  tuned.includes(i) ? 'tuned' : '',
                ].join(' ');
                return (
                  <button
                    type="button"
                    class={cls}
                    aria-pressed={locked === i}
                    aria-label={t('tuner.string', { n: 6 - i, note: label })}
                    onClick={() => onString(i)}
                    data-testid={`string-${i}`}
                  >
                    <span class="string-note">{label.replace(/\d+$/, '')}</span>
                    <span class="string-num">{locked === i ? <Icon name="lock" size={14} /> : tuned.includes(i) ? <Icon name="check" size={14} /> : 6 - i}</span>
                  </button>
                );
              })}
            </div>
            <p class="help">
              {locked !== null
                ? t('tuner.locked', { note: midiLabel(tuning.notes[locked], tuning.id === 'halfDown') })
                : t('tuner.auto')}
              {' · '}
              {t('tuner.stringsHint')}
            </p>
          </>
        ) : (
          <p class="help">{t('tuner.chromaticHint')}</p>
        )}
      </Card>
    </div>
  );
}
