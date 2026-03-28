import { defineConfig } from 'vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      external: ['uiohook-napi', '@huggingface/transformers', 'onnxruntime-node', 'openai', '@anthropic-ai/sdk', 'better-sqlite3', 'electron-log', 'electron-log/main', '@sentry/electron', '@sentry/electron/main'],
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
