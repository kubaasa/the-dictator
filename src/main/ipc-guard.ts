import { ipcMain, type BrowserWindow, type WebContents } from 'electron';
import { IPC } from '../shared/constants';
import logger from './services/logger';

const log = logger.scope('IPC');

type HandleListener = Parameters<typeof ipcMain.handle>[1];
type EventListener = Parameters<typeof ipcMain.on>[1];
type WindowGetter = () => BrowserWindow | null;

const OVERLAY_CHANNELS = new Set<string>([
  IPC.SETTINGS_GET,
  IPC.RECORDING_STATE_CHANGED,
  IPC.OVERLAY_TOGGLE,
  IPC.OVERLAY_CANCEL,
  IPC.WIDGET_DRAG_START,
  IPC.WIDGET_DRAG_END,
]);

let getMainWindow: WindowGetter = () => null;
let getOverlayWindow: WindowGetter = () => null;
const reportedRejections = new Set<string>();

export function setIpcWindows(mainWindow: WindowGetter, overlayWindow: WindowGetter): void {
  getMainWindow = mainWindow;
  getOverlayWindow = overlayWindow;
}

function owns(win: BrowserWindow | null, sender: WebContents): boolean {
  return win !== null && !win.isDestroyed() && win.webContents === sender;
}

function isTrustedSender(channel: string, sender: WebContents): boolean {
  const trusted = owns(getMainWindow(), sender)
    || (OVERLAY_CHANNELS.has(channel) && owns(getOverlayWindow(), sender));
  if (!trusted && !reportedRejections.has(channel)) {
    reportedRejections.add(channel);
    log.warn('Rejected IPC "%s" from an untrusted sender', channel);
  }
  return trusted;
}

export const guardedIpc = {
  handle(channel: string, listener: HandleListener): void {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(channel, event.sender)) {
        throw new Error(`IPC "${channel}" is not available to this window`);
      }
      return listener(event, ...args);
    });
  },

  on(channel: string, listener: EventListener): void {
    ipcMain.on(channel, (event, ...args) => {
      if (isTrustedSender(channel, event.sender)) listener(event, ...args);
    });
  },
};
