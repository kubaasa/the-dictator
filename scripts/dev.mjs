/**
 * Dev script — replaces electron-forge start.
 *
 * 1. Builds preload (one-shot)
 * 2. Starts Vite dev server for renderer (HMR)
 * 3. Builds main process in watch mode
 * 4. Launches Electron, restarts on main rebuild
 */
import { createServer, build } from 'vite';
import { spawn } from 'node:child_process';

const electronPath = String((await import('electron')).default);

// 1. Build preload (one-shot — rarely changes)
await build({ configFile: 'vite.preload.config.ts', mode: 'development' });
console.log('[dev] Preload built');

// 2. Start renderer dev server
const server = await createServer({ configFile: 'vite.renderer.config.ts' });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[dev] Renderer: ${url}`);

// 3. Build main in watch mode — restart Electron on each rebuild
let electronProc = null;

function killElectron() {
  if (!electronProc) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(electronProc.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    electronProc.kill();
  }
  electronProc = null;
}

function startElectron() {
  killElectron();
  electronProc = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
  electronProc.on('close', (code) => {
    if (code !== null) {
      server.close();
      process.exit(code);
    }
  });
}

// Ensure Electron is killed when the dev script exits (Ctrl+C, terminal close, etc.)
function cleanup() {
  killElectron();
  server.close();
  process.exit();
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

const watcher = await build({
  configFile: 'vite.main.config.ts',
  mode: 'development',
  build: { watch: {}, emptyOutDir: false },
});

watcher.on('event', (e) => {
  if (e.code === 'BUNDLE_END') {
    e.result?.close();
    console.log('[dev] Main built — (re)starting Electron');
    startElectron();
  }
  if (e.code === 'ERROR') {
    console.error('[dev] Build error:', e.error);
  }
});
