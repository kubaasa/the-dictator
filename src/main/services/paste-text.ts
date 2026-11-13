const UNSAFE_CHARS_RE = /(?![\t\n\r])[\p{Cc}‪-‮⁦-⁩]/gu;
const LINE_BREAKS_RE = /[\r\n]+/g;

const SINGLE_LINE_WINDOW_CLASSES = new Set(['ConsoleWindowClass', 'PuTTY', 'mintty', 'VirtualConsoleClass']);

export function stripUnsafeChars(text: string): string {
  return text.replace(UNSAFE_CHARS_RE, '');
}

export function textForPasteTarget(text: string, windowClass: string | null): string {
  if (windowClass === null || !SINGLE_LINE_WINDOW_CLASSES.has(windowClass)) return text;
  return text.replace(LINE_BREAKS_RE, ' ').trim();
}
