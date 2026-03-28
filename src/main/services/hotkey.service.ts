import { uIOhook, UiohookKey } from 'uiohook-napi';
import type { HotkeyMode } from '../../shared/types';
import logger from './logger';

const log = logger.scope('Hotkey');

// Maps readable key names (from renderer shortcut recorder) to uiohook scan codes.
// Recorder uses e.code-based names (physical keys), so names like "BracketRight"
// match regardless of Shift state.
const KEY_MAP: Record<string, number> = {
  // Modifiers
  Ctrl: UiohookKey.Ctrl,
  Shift: UiohookKey.Shift,
  Alt: UiohookKey.Alt,

  // Letters
  A: UiohookKey.A, B: UiohookKey.B, C: UiohookKey.C, D: UiohookKey.D,
  E: UiohookKey.E, F: UiohookKey.F, G: UiohookKey.G, H: UiohookKey.H,
  I: UiohookKey.I, J: UiohookKey.J, K: UiohookKey.K, L: UiohookKey.L,
  M: UiohookKey.M, N: UiohookKey.N, O: UiohookKey.O, P: UiohookKey.P,
  Q: UiohookKey.Q, R: UiohookKey.R, S: UiohookKey.S, T: UiohookKey.T,
  U: UiohookKey.U, V: UiohookKey.V, W: UiohookKey.W, X: UiohookKey.X,
  Y: UiohookKey.Y, Z: UiohookKey.Z,

  // Digits (scan codes: 1=0x02 .. 9=0x0a, 0=0x0b)
  '1': 0x02, '2': 0x03, '3': 0x04, '4': 0x05, '5': 0x06,
  '6': 0x07, '7': 0x08, '8': 0x09, '9': 0x0a, '0': 0x0b,

  // F-keys
  F1: UiohookKey.F1, F2: UiohookKey.F2, F3: UiohookKey.F3, F4: UiohookKey.F4,
  F5: UiohookKey.F5, F6: UiohookKey.F6, F7: UiohookKey.F7, F8: UiohookKey.F8,
  F9: UiohookKey.F9, F10: UiohookKey.F10, F11: UiohookKey.F11, F12: UiohookKey.F12,

  // Special keys
  Space: UiohookKey.Space,
  Escape: UiohookKey.Escape,
  Enter: 0x1c,
  Tab: 0x0f,
  Backspace: 0x0e,

  // Punctuation (physical key names from e.code)
  Minus: 0x0c,
  Equal: 0x0d,
  BracketLeft: 0x1a,
  BracketRight: 0x1b,
  Backslash: 0x2b,
  Semicolon: 0x27,
  Quote: 0x28,
  Backquote: 0x29,
  Comma: 0x33,
  Period: 0x34,
  Slash: 0x35,
};

interface ShortcutBinding {
  action: string;
  keys: number[];
  callback: () => void;
}

export class HotkeyService {
  private bindings: ShortcutBinding[] = [];
  private pressedKeys = new Set<number>();
  private mode: HotkeyMode = 'toggle';
  private isRecordingActive = false;
  private suppressPttRestart = false;
  private onRecordingStart: () => void;
  private onRecordingStop: () => void;
  private keydownHandler: ((e: { keycode: number }) => void) | null = null;
  private keyupHandler: ((e: { keycode: number }) => void) | null = null;

  constructor(onRecordingStart: () => void, onRecordingStop: () => void) {
    this.onRecordingStart = onRecordingStart;
    this.onRecordingStop = onRecordingStop;
  }

  start(
    shortcuts: { toggleRecording: string; cancelRecording: string; pushToTalk: string; showWindow: string },
    mode: HotkeyMode,
    callbacks: { onCancel: () => void; onShowWindow: () => void },
  ): void {
    this.mode = mode;

    this.bindings = [
      { action: 'toggleRecording', keys: this.parseShortcut(shortcuts.toggleRecording), callback: () => this.handleToggle() },
      { action: 'cancelRecording', keys: this.parseShortcut(shortcuts.cancelRecording), callback: callbacks.onCancel },
      { action: 'pushToTalk', keys: this.parseShortcut(shortcuts.pushToTalk), callback: () => this.handlePushToTalkStart() },
      { action: 'showWindow', keys: this.parseShortcut(shortcuts.showWindow), callback: callbacks.onShowWindow },
    ];

    if (this.keydownHandler) uIOhook.off('keydown', this.keydownHandler);
    if (this.keyupHandler) uIOhook.off('keyup', this.keyupHandler);

    this.keydownHandler = (e) => {
      // Skip OS auto-repeat events — without this, holding a toggle shortcut
      // (e.g. Ctrl+Tab) causes rapid start/stop cycling (~30 toggles/second)
      if (this.pressedKeys.has(e.keycode)) return;
      this.pressedKeys.add(e.keycode);
      this.checkBindings();
    };

    this.keyupHandler = (e) => {
      // Clear PTT suppress flag when a PTT key is released — allows next press to start fresh.
      // Only check the pushToTalk binding — toggleRecording is inactive in PTT mode,
      // and checking it would clear the flag on unrelated key releases.
      if (this.suppressPttRestart) {
        const pttBinding = this.bindings.find((b) => b.action === 'pushToTalk');
        if (pttBinding && pttBinding.keys.includes(e.keycode)) {
          this.suppressPttRestart = false;
        }
      }

      // PTT stop: a key from the PTT combo released → stop recording.
      // Only check the pushToTalk binding — toggleRecording is inactive in PTT mode,
      // and checking it would cause false stops when releasing unrelated shortcut keys.
      if (this.isRecordingActive && this.mode === 'push-to-talk') {
        const pttBinding = this.bindings.find((b) => b.action === 'pushToTalk');
        if (pttBinding && pttBinding.keys.length > 0 && pttBinding.keys.includes(e.keycode)) {
          this.isRecordingActive = false;
          this.onRecordingStop();
        }
      }
      this.pressedKeys.delete(e.keycode);
    };

    uIOhook.on('keydown', this.keydownHandler);
    uIOhook.on('keyup', this.keyupHandler);
    uIOhook.start();
  }

  stop(): void {
    if (this.keydownHandler) uIOhook.off('keydown', this.keydownHandler);
    if (this.keyupHandler) uIOhook.off('keyup', this.keyupHandler);
    this.keydownHandler = null;
    this.keyupHandler = null;
    uIOhook.stop();
    this.pressedKeys.clear();
  }

  updateShortcuts(shortcuts: { toggleRecording: string; cancelRecording: string; pushToTalk: string; showWindow: string }): void {
    // If a recording is active when shortcuts change, stop it to avoid a state where
    // the old shortcut key can no longer trigger stop (binding was replaced).
    if (this.isRecordingActive) {
      this.isRecordingActive = false;
      this.onRecordingStop();
    }
    for (const binding of this.bindings) {
      const shortcutStr = shortcuts[binding.action as keyof typeof shortcuts];
      if (shortcutStr) {
        binding.keys = this.parseShortcut(shortcutStr);
      }
    }
  }

  setMode(mode: HotkeyMode): void {
    // Stop active recording before switching — prevents a state where the old
    // mode's stop mechanism no longer works (e.g. toggle can't stop in PTT mode)
    if (this.isRecordingActive) {
      this.isRecordingActive = false;
      this.onRecordingStop();
    }
    this.mode = mode;
  }

  notifyRecordingStarted(): void {
    this.isRecordingActive = true;
  }

  notifyRecordingStopped(): void {
    this.isRecordingActive = false;

    // In PTT mode, if the PTT key combo is still physically held, suppress auto-repeat
    // from re-triggering a new recording. The flag is cleared on key release.
    if (this.mode === 'push-to-talk') {
      const pttBinding = this.bindings.find(b => b.action === 'pushToTalk');
      if (pttBinding && pttBinding.keys.length > 0 && pttBinding.keys.every(k => this.pressedKeys.has(k))) {
        this.suppressPttRestart = true;
      }
    }
  }

  onGlobalMouseUp(callback: () => void): () => void {
    const handler = () => {
      uIOhook.off('mouseup', handler);
      callback();
    };
    uIOhook.on('mouseup', handler);
    return () => uIOhook.off('mouseup', handler);
  }

  private parseShortcut(shortcut: string): number[] {
    const codes: number[] = [];
    for (const key of shortcut.split('+')) {
      const code = KEY_MAP[key.trim()];
      if (code === undefined) {
        log.warn('Unknown key in shortcut "%s": "%s" — binding disabled', shortcut, key);
        return []; // disable entire binding if any key is unknown
      }
      codes.push(code);
    }
    return codes;
  }

  private checkBindings(): void {
    const sorted = [...this.bindings]
      .filter((b) => b.keys.length > 0)
      .sort((a, b) => b.keys.length - a.keys.length);

    for (const binding of sorted) {
      if (binding.keys.every((k) => this.pressedKeys.has(k)) && this.pressedKeys.size === binding.keys.length) {
        binding.callback();
        return;
      }
    }
  }

  private handlePushToTalkStart(): void {
    if (this.mode !== 'push-to-talk') return;
    if (this.suppressPttRestart) return;
    if (!this.isRecordingActive) {
      this.isRecordingActive = true;
      this.onRecordingStart();
    }
  }

  private handleToggle(): void {
    if (this.mode !== 'toggle') return;
    if (this.isRecordingActive) {
      this.isRecordingActive = false;
      this.onRecordingStop();
    } else {
      this.isRecordingActive = true;
      this.onRecordingStart();
    }
  }
}
