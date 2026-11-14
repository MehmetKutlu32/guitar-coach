import type { ComponentChildren } from 'preact';
import { inputLevel } from '../audio/input';
import { t } from '../i18n';

export function Card(props: { title?: string; children: ComponentChildren; class?: string; testid?: string }) {
  return (
    <section class={`card ${props.class ?? ''}`} data-testid={props.testid}>
      {props.title && <h2 class="card-title">{props.title}</h2>}
      {props.children}
    </section>
  );
}

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
}

/** Yan yana büyük seçenek düğmeleri. */
export function Segmented<T extends string | number>(props: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  testid?: string;
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.label} data-testid={props.testid}>
      {props.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          class={o.value === props.value ? 'seg active' : 'seg'}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Artı/eksi düğmeli sayı seçici; küçük kaydırıcılardan daha kolay dokunulur. */
export function Stepper(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
  testid?: string;
}) {
  const step = props.step ?? 1;
  const set = (v: number) => props.onChange(Math.min(props.max, Math.max(props.min, v)));
  return (
    <div class="stepper" role="group" aria-label={props.label} data-testid={props.testid}>
      <button type="button" class="btn icon-only" aria-label="−" onClick={() => set(props.value - step)}>
        −
      </button>
      <output class="stepper-value">{props.format ? props.format(props.value) : props.value}</output>
      <button type="button" class="btn icon-only" aria-label="+" onClick={() => set(props.value + step)}>
        +
      </button>
    </div>
  );
}

/** Canlı giriş seviyesi çubuğu. */
export function LevelMeter() {
  const level = inputLevel.value;
  return (
    <div
      class="meter"
      role="meter"
      aria-label={t('input.level')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      data-testid="level-meter"
    >
      <div class={`meter-fill ${level > 0.95 ? 'hot' : ''}`} style={{ transform: `scaleX(${level})` }} />
    </div>
  );
}

export function Notice(props: { kind?: 'error' | 'info' | 'good'; children: ComponentChildren; testid?: string }) {
  return (
    <p class={`notice ${props.kind ?? 'info'}`} role={props.kind === 'error' ? 'alert' : 'status'} data-testid={props.testid}>
      {props.children}
    </p>
  );
}
