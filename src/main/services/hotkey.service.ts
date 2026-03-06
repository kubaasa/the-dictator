import { uIOhook, UiohookKey } from 'uiohook-napi';
import type { HotkeyMode } from '../../shared/types';

// Maps readable key names to uiohook key codes
const KEY_MAP: Record<string, number> = {
  Ctrl: UiohookKey.Ctrl,
  Shift: UiohookKey.Shift,
  Alt: UiohookKey.Alt,
  Space: UiohookKey.Space,
};

export class HotkeyService {
  private shortcutKeys: number[] = [];
  private pressedKeys = new Set<number>();
  private mode: HotkeyMode = 'toggle';
  private isActive = false;
  private onStart: () => void;
  private onStop: () => void;

  constructor(onStart: () => void, onStop: () => void) {
    this.onStart = onStart;
    this.onStop = onStop;
  }

  start(shortcut: string, mode: HotkeyMode): void {
    this.setShortcut(shortcut);
    this.mode = mode;

    uIOhook.on('keydown', (e) => {
      this.pressedKeys.add(e.keycode);
      this.checkHotkey();
    });

    uIOhook.on('keyup', (e) => {
      // Push-to-talk: release any shortcut key → stop
      if (this.mode === 'push-to-talk' && this.isActive && this.shortcutKeys.includes(e.keycode)) {
        this.isActive = false;
        this.onStop();
      }
      this.pressedKeys.delete(e.keycode);
    });

    uIOhook.start();
  }

  stop(): void {
    uIOhook.stop();
  }

  setShortcut(shortcut: string): void {
    // Parse "Ctrl+Shift+Space" → [29, 42, 57]
    this.shortcutKeys = shortcut.split('+').map((key) => {
      const code = KEY_MAP[key.trim()];
      if (code === undefined) {
        console.warn(`Unknown key in shortcut: "${key}"`);
        return -1;
      }
      return code;
    }).filter((k) => k !== -1);
  }

  setMode(mode: HotkeyMode): void {
    this.mode = mode;
  }

  private checkHotkey(): void {
    const allPressed = this.shortcutKeys.every((k) => this.pressedKeys.has(k));
    if (!allPressed) return;

    if (this.mode === 'toggle') {
      if (this.isActive) {
        this.isActive = false;
        this.onStop();
      } else {
        this.isActive = true;
        this.onStart();
      }
    } else {
      // push-to-talk: keydown → start (keyup handled above)
      if (!this.isActive) {
        this.isActive = true;
        this.onStart();
      }
    }
  }
}
