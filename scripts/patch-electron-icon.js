/**
 * Patches the local Electron binary with the app icon.
 *
 * In dev mode Electron runs from node_modules/electron/dist/electron.exe which
 * ships with the default Electron icon. Windows uses the executable's embedded
 * icon for the taskbar, so frameless BrowserWindows always show the Electron
 * logo. This script replaces that icon with our own after every npm install.
 */

const path = require('path');

let rcedit;
try {
  rcedit = require('rcedit');
} catch {
  // rcedit not available (non-Windows or maker-wix not installed) — skip silently
  return;
}

const electronExe = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const icon = path.resolve(__dirname, '..', 'assets', 'icon.ico');

rcedit(electronExe, { icon })
  .then(() => console.log('[postinstall] Electron binary icon patched'))
  .catch((err) => console.warn('[postinstall] Could not patch Electron icon:', err.message));
