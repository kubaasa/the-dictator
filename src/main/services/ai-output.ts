export interface OutputVerdict {
  text: string | null;
  reason: string | null;
}

const WRAPPER_TAGS = 'output|message|result|response|text';
const WRAPPED_RE = new RegExp(`^\\s*<(${WRAPPER_TAGS})>\\s*([\\s\\S]*?)\\s*<\\/\\1>\\s*$`, 'i');
const ORPHAN_CLOSER_RE = new RegExp(`\\s*<\\/(?:${WRAPPER_TAGS})>\\s*$`, 'i');
const ANY_WRAPPER_TAG_RE = new RegExp(`<\\/?(?:${WRAPPER_TAGS})>`, 'i');
const INPUT_TAG_RE = /<\/?input>/i;
const TOKEN_RE = /[\p{L}\p{N}]{3,}/gu;

const MIN_INPUT_TOKENS_FOR_CONTAINMENT = 6;
const MIN_CONTAINMENT = 0.6;
const MAX_LENGTH_RATIO = 3;
const MAX_LENGTH_SLACK = 80;

export function unwrapModelOutput(output: string): string {
  const trimmed = output.trim();
  const wrapped = WRAPPED_RE.exec(trimmed);
  if (wrapped) return ANY_WRAPPER_TAG_RE.test(wrapped[2]) ? trimmed : wrapped[2].trim();
  return trimmed.replace(ORPHAN_CLOSER_RE, '').trim();
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? [];
}

export function wordContainment(output: string, input: string): number {
  const outTokens = tokens(output);
  if (outTokens.length === 0) return 1;
  const inSet = new Set(tokens(input));
  const shared = outTokens.filter((t) => inSet.has(t)).length;
  return shared / outTokens.length;
}

export function validateModelOutput(output: string, input: string, strict: boolean): OutputVerdict {
  const text = unwrapModelOutput(output);
  if (INPUT_TAG_RE.test(text)) return { text: null, reason: 'input echo' };
  if (!strict) return { text, reason: null };

  if (tokens(input).length >= MIN_INPUT_TOKENS_FOR_CONTAINMENT) {
    const containment = wordContainment(text, input);
    if (containment < MIN_CONTAINMENT) return { text: null, reason: `containment ${containment.toFixed(2)}` };
  }
  if (text.length > MAX_LENGTH_RATIO * input.length + MAX_LENGTH_SLACK) {
    return { text: null, reason: `length ${text.length} vs input ${input.length}` };
  }
  return { text, reason: null };
}
