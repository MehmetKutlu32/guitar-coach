import { useEffect, useRef, useState } from 'preact/hooks';
import { acquireInput, applyDeviceChange, inputDevices, inputStatus, refreshDevices } from '../../audio/input';
import { exportAll, importAll, isExportFile } from '../../db/db';
import { LANGS, t } from '../../i18n';
import { settings } from '../../settings';
import { Card, LevelMeter, Notice, Segmented, Stepper } from '../../ui/controls';
import { Icon } from '../../ui/Icon';

declare const __APP_VERSION__: string;

function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function InputSection() {
  const devices = inputDevices.value;
  const status = inputStatus.value;
  const release = useRef<(() => void) | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void refreshDevices();
    return () => {
      release.current?.();
      release.current = null;
    };
  }, []);

  const toggleTest = async () => {
    if (testing) {
      release.current?.();
      release.current = null;
      setTesting(false);
      return;
    }
    try {
      release.current = await acquireInput();
      setTesting(true);
    } catch {
      setTesting(false);
    }
  };

  return (
    <Card title={t('settings.input')} testid="settings-input">
      <label class="field">
        <span class="field-label">{t('settings.inputDevice')}</span>
        <select
          class="select"
          value={settings.inputDeviceId.value}
          onChange={(e) => {
            settings.inputDeviceId.value = (e.target as HTMLSelectElement).value;
            void applyDeviceChange();
          }}
          data-testid="input-device"
        >
          <option value="">{t('settings.inputDefault')}</option>
          {devices
            .filter((d) => d.deviceId && d.deviceId !== 'default')
            .map((d, i) => (
              <option value={d.deviceId}>{d.label || t('settings.inputUnnamed', { n: i + 1 })}</option>
            ))}
        </select>
      </label>
      <p class="help">{t('settings.inputHelp')}</p>
      {testing && status === 'running' && (
        <div class="field">
          <span class="field-label">{t('input.level')}</span>
          <LevelMeter />
        </div>
      )}
      {status === 'denied' && <Notice kind="error">{t('input.denied')}</Notice>}
      {status === 'unavailable' && <Notice kind="error">{t('input.unavailable')}</Notice>}
      {status === 'error' && <Notice kind="error">{t('input.error')}</Notice>}
      <button type="button" class="btn block" onClick={toggleTest} data-testid="input-test">
        <Icon name="mic" /> {testing ? t('settings.inputTestStop') : t('settings.inputTest')}
      </button>
    </Card>
  );
}

function DataSection() {
  const [message, setMessage] = useState<{ kind: 'good' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    const data = await exportAll();
    downloadJson(`gitar-yedek-${new Date().toISOString().slice(0, 10)}.json`, data);
    setMessage({ kind: 'good', text: t('settings.exportDone') });
  };

  const doImport = async (file: File) => {
    try {
      const data: unknown = JSON.parse(await file.text());
      if (!isExportFile(data)) throw new Error('invalid-file');
      if (!confirm(t('settings.importConfirm'))) return;
      await importAll(data);
      setMessage({ kind: 'good', text: t('settings.importDone') });
      // Ayarlar ve tüm ekranlar yeni veriyi okusun.
      setTimeout(() => location.reload(), 600);
    } catch {
      setMessage({ kind: 'error', text: t('settings.importError') });
    }
  };

  return (
    <Card title={t('settings.data')} testid="settings-data">
      <p class="help">{t('settings.dataHelp')}</p>
      <div class="row">
        <button type="button" class="btn grow" onClick={doExport} data-testid="export">
          {t('settings.export')}
        </button>
        <button type="button" class="btn grow" onClick={() => fileRef.current?.click()} data-testid="import">
          {t('settings.import')}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="import-file"
        onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const file = input.files?.[0];
          if (file) void doImport(file);
          input.value = '';
        }}
      />
      {message && <Notice kind={message.kind} testid="data-message">{message.text}</Notice>}
    </Card>
  );
}

export function Settings() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let alive = true;
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (alive && reg?.active) setOffline(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div class="stack">
      <Card title={t('settings.language')}>
        <Segmented
          label={t('settings.language')}
          options={LANGS.map((l) => ({ value: l.id, label: l.label }))}
          value={settings.lang.value}
          onChange={(v) => (settings.lang.value = v)}
          testid="lang"
        />
      </Card>

      <InputSection />

      <Card title={t('settings.a4')}>
        <Stepper
          label={t('settings.a4')}
          value={settings.a4.value}
          min={415}
          max={466}
          onChange={(v) => (settings.a4.value = v)}
          format={(v) => `${v} Hz`}
          testid="a4"
        />
        <p class="help">{t('settings.a4Help')}</p>
      </Card>

      <DataSection />

      <Card title={t('settings.about')}>
        <p class="help">{t('settings.aboutText', { v: __APP_VERSION__ })}</p>
        {offline && <Notice kind="good" testid="offline-ready">{t('settings.offlineReady')}</Notice>}
      </Card>
    </div>
  );
}
