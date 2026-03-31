import { defineConfig } from 'vite';

// Only electron is external — the preload runs in Electron's sandbox
// where require() can only load built-in modules (like 'electron').
// Everything else (electron-log/preload, sentry/preload) gets bundled.
export default defineConfig({
  build: {
    outDir: 'dist/main',
    emptyOutDir: false,
    lib: {
      entry: 'src/preload/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});
