import { defineConfig } from 'vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { builtinModules } from 'node:module';

export default defineConfig({
  resolve: {
    // Main process is Node.js — prefer "node" export conditions over browser defaults
    conditions: ['node'],
  },
  build: {
    sourcemap: true,
    outDir: 'dist/main',
    emptyOutDir: true,
    lib: {
      entry: 'src/main/main.ts',
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        'uiohook-napi',
        '@huggingface/transformers',
        'onnxruntime-node',
        'openai',
        '@anthropic-ai/sdk',
        'better-sqlite3',
        'electron-log',
        'electron-log/main',
        'electron-updater',
        '@sentry/electron',
        '@sentry/electron/main',
      ],
    },
  },
  plugins: [
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      disable: !process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
});
