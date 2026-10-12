import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const dataMode = env.VITE_DATA_MODE || 'api';
  if (!['api', 'static'].includes(dataMode)) throw new Error('VITE_DATA_MODE must be api or static');
  const staticMode = dataMode === 'static';
  const base = command === 'build' && !staticMode ? '/static/spa/' : '/';
  const site = env.VITE_SITE_URL ? new URL(env.VITE_SITE_URL).origin : '';
  return {
  plugins: [react(), tailwindcss(), {
    name: 'historical-demo-assets',
    transformIndexHtml: html => html.replaceAll('__SOCIAL_IMAGE__', `${site}${base}social-preview.png`),
    async closeBundle() {
      if (!staticMode || mode === 'test') return;
      await mkdir('dist/static/fonts', { recursive: true });
      await cp('../src/grid_report/static/fonts', 'dist/static/fonts', { recursive: true });
      // Fail rather than publishing an empty demo; exports are deliberate, never live at build time.
      const manifest = JSON.parse(await readFile('demo/v1/manifest.json', 'utf8'));
      if (manifest.schema_version !== 1 || !/^[a-f0-9]{16}$/.test(manifest.revision)
          || !manifest.dates?.length || manifest.dates.some((day: string) => !/^\d{4}-\d{2}-\d{2}$/.test(day))) {
        throw new Error('Export valid historical demo data before building');
      }
      await mkdir(`dist/demo/v1/${manifest.revision}`, { recursive: true });
      // Only publish explicitly listed public files, never arbitrary neighboring exports.
      for (const day of manifest.dates) {
        await cp(`demo/v1/${manifest.revision}/${day}.json`, `dist/demo/v1/${manifest.revision}/${day}.json`);
      }
      await cp('demo/v1/manifest.json', 'dist/demo/v1/manifest.json');
      await cp('pages/_headers', 'dist/_headers');
    },
    configureServer(server) {
      if (!staticMode) return;
      server.middlewares.use(async (request, response, next) => {
        const url = request.url?.split('?')[0] || '';
        const font = /^\/static\/fonts\/(hanken-grotesk-(400|500|900)\.ttf)$/.exec(url);
        const data = /^\/demo\/v1\/(manifest\.json|[a-f0-9]{16}\/\d{4}-\d{2}-\d{2}\.json)$/.exec(url);
        if (!font && !data) return next();
        try {
          const file = font ? resolve('../src/grid_report/static/fonts', font[1]) : resolve('demo/v1', data![1]);
          response.setHeader('Content-Type', font ? 'font/ttf' : 'application/json');
          response.end(await readFile(file));
        } catch { response.statusCode = 404; response.end('Not found'); }
      });
    },
  }],
  base,
  publicDir: 'public',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: staticMode ? undefined : {
      '/api': 'http://127.0.0.1:8000',
      '/static/fonts': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
};
});
