import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function maplibreWorker() {
  return {
    name: 'maplibre-worker-asset',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'assets/maplibre-gl-worker.mjs',
        source: fs.readFileSync(
          path.join(rootDir, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs'),
        ),
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), maplibreWorker()],
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
});
