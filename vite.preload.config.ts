import { defineConfig } from 'vite';

// https://vitejs.dev/config
// NOTE: Do NOT externalize modules here. The preload runs in Electron's sandbox
// where require() can only load built-in modules (like 'electron').
// All npm packages must be bundled inline by Vite.
export default defineConfig({});
