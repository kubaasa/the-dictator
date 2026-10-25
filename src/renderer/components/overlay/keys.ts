// Display names for uiohook key codes that read badly as-is (shared by both widgets)
const KEY_ALIASES: Record<string, string> = {
  BracketRight: ']', BracketLeft: '[', Backquote: '`', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Minus: '-', Equal: '=', Escape: 'Esc', Space: 'Space',
};

export function formatKey(k: string): string {
  return KEY_ALIASES[k] ?? k;
}

export function formatShortcut(raw: string): string {
  return raw.split('+').map(formatKey).join('+');
}
