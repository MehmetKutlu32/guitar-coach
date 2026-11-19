import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeDbForTests,
  DATA_STORES,
  DB_NAME,
  dbAll,
  dbClear,
  dbDelete,
  dbGet,
  dbPut,
  exportAll,
  importAll,
  kvGet,
  kvSet,
  newId,
  onDbWrite,
} from '../../src/db/db';
import { dictionaries } from '../../src/i18n';
import { applySettings, loadSettings, settings, snapshotSettings } from '../../src/settings';

async function resetDb(): Promise<void> {
  await closeDbForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

describe('veritabanı', () => {
  beforeEach(resetDb);

  it('anahtar/değer okuma-yazma', async () => {
    expect(await kvGet('yok')).toBeUndefined();
    await kvSet('a', { n: 1 });
    expect(await kvGet('a')).toEqual({ n: 1 });
  });

  it('yazma bildirimi: ekleme, silme, temizleme ve içe aktarmada çağrılır (kv yazmasında değil)', async () => {
    const seen: string[] = [];
    const off = onDbWrite((store) => seen.push(store));
    await kvSet('a', 1);
    await dbPut('results', { id: 'x', type: 'ear', date: 1 });
    await dbDelete('results', 'x');
    await dbClear('items');
    await importAll({ app: 'gitar-app', format: 1, exportedAt: '', stores: { sessions: [] } });
    off();
    await dbPut('results', { id: 'y', type: 'ear', date: 1 });
    expect(seen).toEqual(['results', 'results', 'items', 'sessions']);
  });

  it('kayıt ekleme, türe göre listeleme, silme', async () => {
    const a = await dbPut('results', { id: newId(), type: 'transition', date: 1, count: 30 });
    await dbPut('results', { id: newId(), type: 'rhythm', date: 2, score: 80 });
    expect(await dbAll('results')).toHaveLength(2);
    expect(await dbAll('results', 'transition')).toEqual([a]);
    expect(await dbGet('results', a.id)).toEqual(a);
    await dbDelete('results', a.id);
    expect(await dbAll('results')).toHaveLength(1);
    await dbClear('results');
    expect(await dbAll('results')).toHaveLength(0);
  });

  it('dışa aktarılan veri içe aktarılınca aynen geri gelir', async () => {
    await kvSet('settings', { lang: 'en', a4: 442 });
    await dbPut('sessions', { id: 's1', date: 123, seconds: 600 });
    await dbPut('items', { id: 'i1', type: 'song', title: 'Deneme' });
    const file = await exportAll();
    expect(file.app).toBe('gitar-app');
    expect(Object.keys(file.stores).sort()).toEqual([...DATA_STORES].sort());

    // JSON'a gidip gelebilmeli.
    const json: unknown = JSON.parse(JSON.stringify(file));
    await resetDb();
    await dbPut('sessions', { id: 'eski', date: 1 });
    await importAll(json);
    expect(await kvGet('settings')).toEqual({ lang: 'en', a4: 442 });
    expect(await dbAll('sessions')).toEqual([{ id: 's1', date: 123, seconds: 600 }]);
    expect(await dbAll('items', 'song')).toHaveLength(1);
  });

  it('geçersiz dosyayı reddeder ve mevcut veriye dokunmaz', async () => {
    await dbPut('sessions', { id: 's1', date: 1 });
    await expect(importAll({ foo: 1 })).rejects.toThrow('invalid-file');
    await expect(importAll(null)).rejects.toThrow('invalid-file');
    await expect(importAll({ app: 'gitar-app', format: 1, stores: {} })).rejects.toThrow('invalid-file');
    expect(await dbAll('sessions')).toHaveLength(1);
  });
});

describe('ayarlar', () => {
  beforeEach(resetDb);

  it('kaydedilir ve yeniden yüklenir; geçersiz değerler yok sayılır', async () => {
    await loadSettings();
    settings.lang.value = 'en';
    settings.a4.value = 443;
    await new Promise((r) => setTimeout(r, 20));
    expect(await kvGet('settings')).toMatchObject({ lang: 'en', a4: 443 });

    settings.lang.value = 'tr';
    settings.a4.value = 440;
    applySettings({ a4: 'bozuk' as unknown as number, lang: 'en' });
    expect(snapshotSettings()).toMatchObject({ lang: 'en', a4: 440 });
  });
});

describe('çeviriler', () => {
  it('iki dilde aynı anahtarlar ve aynı yer tutucular var', () => {
    const { tr, en } = dictionaries;
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(tr) as (keyof typeof tr)[]) {
      expect(holes(en[key]), key).toEqual(holes(tr[key]));
      expect(tr[key].trim().length, key).toBeGreaterThan(0);
      expect(en[key].trim().length, key).toBeGreaterThan(0);
    }
  });
});
