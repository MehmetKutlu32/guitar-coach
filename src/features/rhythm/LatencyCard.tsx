import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import { settings } from '../../settings';
import { Card, LevelMeter, Notice, Stepper } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { calibrateLatency, calibrating, type CalibrationMode } from './session';

/** Gecikme kalibrasyonu: otomatik (hoparlör → mikrofon), çalarak ya da elle. */
export function LatencyCard() {
  const busy = calibrating.value;
  const [message, setMessage] = useState<{ kind: 'good' | 'error' | 'info'; text: string } | null>(null);

  const run = async (mode: CalibrationMode) => {
    setMessage({ kind: 'info', text: t(mode === 'auto' ? 'latency.autoRunning' : 'latency.playRunning') });
    const result = await calibrateLatency(mode);
    if (!result) {
      setMessage({ kind: 'error', text: t(mode === 'auto' ? 'latency.autoFailed' : 'latency.playFailed') });
      return;
    }
    if (result.spreadMs > 25) {
      setMessage({ kind: 'error', text: t('latency.unstable', { n: result.latencyMs }) });
      return;
    }
    settings.latencyMs.value = result.latencyMs;
    settings.latencyCalibrated.value = true;
    setMessage({ kind: 'good', text: t('latency.done', { n: result.latencyMs, m: result.matched }) });
  };

  return (
    <Card title={t('latency.title')} testid="latency">
      <Stepper
        label={t('latency.title')}
        value={settings.latencyMs.value}
        min={0}
        max={500}
        step={5}
        onChange={(v) => {
          settings.latencyMs.value = v;
          settings.latencyCalibrated.value = true;
        }}
        format={(v) => `${v} ms`}
        testid="latency-value"
      />
      <p class="help">{t('latency.help')}</p>
      {busy && <LevelMeter />}
      {message && (
        <Notice kind={message.kind} testid="latency-message">
          {message.text}
        </Notice>
      )}
      <div class="row">
        <button type="button" class="btn grow" onClick={() => run('auto')} disabled={busy !== null} data-testid="latency-auto">
          <Icon name="speaker" /> {t('latency.auto')}
        </button>
        <button type="button" class="btn grow" onClick={() => run('play')} disabled={busy !== null} data-testid="latency-play">
          <Icon name="mic" /> {t('latency.play')}
        </button>
      </div>
      <p class="help">{t('latency.methods')}</p>
    </Card>
  );
}
