import { defineConfig } from 'vite';

// Do NOT externalize modules here — the preload runs in Electron's sandbox
// where require() can only load built-in modules (like 'electron').
export default defineConfig({});
