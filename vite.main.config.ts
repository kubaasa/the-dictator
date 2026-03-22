import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['uiohook-napi', '@huggingface/transformers', 'onnxruntime-node', 'openai', '@anthropic-ai/sdk', 'better-sqlite3'],
    },
  },
});
