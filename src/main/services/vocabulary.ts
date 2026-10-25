import type { VocabularyEntry } from '../../shared/types';

export interface VocabularyResult {
  text: string;
  applied: number;
  summary: string;
}

interface VocabularyPattern {
  entry: VocabularyEntry;
  source: string;
  inputLength: number;
  keepSuffix: boolean;
}

interface ProtectedSpan {
  start: number;
  end: number;
  exact: boolean;
}

const VOCAB_WORD_CHAR = '[\\p{L}\\p{N}_]';

function looksLikeCliCommand(replacement: string): boolean {
  return (
    replacement.includes('--') ||
    replacement.includes(' -') ||
    replacement.includes('/') ||
    replacement.includes('\\') ||
    replacement.startsWith('$') ||
    replacement.startsWith('>')
  );
}

function buildVocabularyPatterns(vocabulary: VocabularyEntry[]): VocabularyPattern[] {
  const patterns: VocabularyPattern[] = [];
  for (const entry of vocabulary) {
    if (entry.replacement == null) continue;
    const cli = looksLikeCliCommand(entry.replacement);
    const replacementKeepsSuffix = entry.replacement.endsWith('*');

    for (const rawAlt of entry.input.split('|')) {
      const alt = rawAlt.trim();
      if (!alt) continue;
      const wildcard = alt.endsWith('*');
      const base = wildcard ? alt.slice(0, -1).trim() : alt;
      if (!base) continue;

      const escapedWords = base
        .split(/\s+|(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/u)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s-]+');
      const boundaryStart = `(?<!${VOCAB_WORD_CHAR})`;
      const boundaryEnd = `(?!${VOCAB_WORD_CHAR})`;
      const suffix = wildcard ? '(\\p{L}*)' : '';
      const trailing = cli ? '(?:[.!?](?=\\s*$))?' : '';

      patterns.push({
        entry,
        source: `${boundaryStart}${escapedWords}${suffix}${boundaryEnd}${trailing}`,
        inputLength: base.length,
        keepSuffix: wildcard && replacementKeepsSuffix,
      });
    }
  }
  return patterns.sort((a, b) => b.inputLength - a.inputLength);
}

function matchCapitalization(matched: string, replacement: string): string {
  if (looksLikeCliCommand(replacement)) return replacement;
  if (!/^\p{Lu}/u.test(matched)) return replacement;
  if (!/^\p{Ll}[\p{L}\s-]*$/u.test(replacement)) return replacement;
  return replacement.charAt(0).toUpperCase() + replacement.slice(1);
}

function findProtectedSpans(text: string, vocabulary: VocabularyEntry[]): ProtectedSpan[] {
  const lower = text.toLowerCase();
  const spans: ProtectedSpan[] = [];
  for (const entry of vocabulary) {
    const replacement = (entry.replacement ?? '').replace(/\*$/, '');
    if (replacement.length < 2) continue;
    const needle = replacement.toLowerCase();
    let from = 0;
    for (;;) {
      const at = lower.indexOf(needle, from);
      if (at === -1) break;
      spans.push({ start: at, end: at + needle.length, exact: text.slice(at, at + needle.length) === replacement });
      from = at + needle.length;
    }
  }
  return spans;
}

export function selectTriggeredEntries(text: string, vocabulary: VocabularyEntry[]): VocabularyEntry[] {
  const triggered = new Set<VocabularyEntry>();
  for (const pattern of buildVocabularyPatterns(vocabulary)) {
    if (triggered.has(pattern.entry)) continue;
    if (new RegExp(pattern.source, 'iu').test(text)) triggered.add(pattern.entry);
  }
  return vocabulary.filter((entry) => triggered.has(entry));
}

export function applyVocabularyReplacements(text: string, vocabulary: VocabularyEntry[]): VocabularyResult {
  if (!vocabulary || vocabulary.length === 0) return { text, applied: 0, summary: '' };
  const patterns = buildVocabularyPatterns(vocabulary);
  if (patterns.length === 0) return { text, applied: 0, summary: '' };

  const source = patterns
    .map((p, i) => `(?<m${i}>${p.source.replace('(\\p{L}*)', `(?<s${i}>\\p{L}*)`)})`)
    .join('|');
  const combined = new RegExp(source, 'giu');
  const protectedSpans = findProtectedSpans(text, vocabulary);

  const applied = new Map<string, number>();
  const result = text.replace(combined, (...args: unknown[]) => {
    const groups = args[args.length - 1] as Record<string, string | undefined>;
    const offset = args[args.length - 3] as number;
    const matched = args[0] as string;
    const index = patterns.findIndex((_, i) => groups[`m${i}`] !== undefined);
    if (index === -1) return matched;

    const covering = protectedSpans.find((s) => s.start <= offset && offset + matched.length <= s.end);
    if (covering && (covering.end - covering.start > matched.length || covering.exact)) return matched;

    const { entry, keepSuffix } = patterns[index];
    let replacement = entry.replacement as string;
    if (replacement.endsWith('*')) replacement = replacement.slice(0, -1);
    if (keepSuffix) replacement += groups[`s${index}`] ?? '';

    const key = `"${entry.input}" → "${entry.replacement}"`;
    applied.set(key, (applied.get(key) ?? 0) + 1);
    return matchCapitalization(matched, replacement);
  });

  const total = [...applied.values()].reduce((a, b) => a + b, 0);
  const summary = [...applied.entries()].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ');
  return { text: result, applied: total, summary };
}
