import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['uiohook-napi', '@xenova/transformers', 'openai', '@anthropic-ai/sdk', 'better-sqlite3'],
    },
  },
});
