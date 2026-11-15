import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// GitHub Pages alt dizini. Farklı bir repo adı için BASE_PATH ortam değişkeni verilebilir.
const base = process.env.BASE_PATH ?? '/guitar-coach/';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Build sonrası dist/sw.js içine önbelleğe alınacak dosya listesini ve sürüm özetini yazar. */
function serviceWorkerManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'gitar-sw-manifest',
    apply: 'build',
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      let sw: string;
      try {
        sw = readFileSync(swPath, 'utf8');
      } catch {
        return;
      }
      const hash = createHash('sha256');
      const files = walk(outDir)
        .filter((f) => !f.endsWith('sw.js'))
        .sort()
        .map((f) => {
          hash.update(f).update(readFileSync(f));
          return './' + relative(outDir, f).split(sep).join('/');
        });
      sw = sw
        .replace('/*__PRECACHE__*/[]', JSON.stringify(files))
        .replace('__VERSION__', hash.digest('hex').slice(0, 12));
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  base,
  plugins: [preact(), serviceWorkerManifest()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', sourcemap: false },
  worker: { format: 'es' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
