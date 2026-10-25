export interface SpeechMetrics {
  durationSeconds: number;
  speechSeconds: number;
  rms: number;
  peak: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  avg_logprob: number;
}

export const SPEECH_FRAME_RMS = 0.02;
export const MIN_SPEECH_SECONDS = 0.1;
export const CREDITS_MAX_SPEECH_SECONDS = 1.0;
export const LOW_CONFIDENCE_LOGPROB = -0.7;

const FRAME_SECONDS = 0.05;

export function meanSegmentLogprob(segments: TranscriptSegment[] | undefined): number | null {
  if (!segments || segments.length === 0) return null;
  let weighted = 0;
  let total = 0;
  for (const s of segments) {
    const span = Math.max(s.end - s.start, 0.01);
    weighted += s.avg_logprob * span;
    total += span;
  }
  return weighted / total;
}

export function isLowConfidence(avgLogprob: number | null): avgLogprob is number {
  return avgLogprob !== null && avgLogprob < LOW_CONFIDENCE_LOGPROB;
}

export function measureSpeech(samples: Float32Array, sampleRate: number): SpeechMetrics {
  const frame = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  let sumSquares = 0;
  let peak = 0;
  let speechFrames = 0;
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(start + frame, samples.length);
    let frameSum = 0;
    for (let i = start; i < end; i++) {
      const s = samples[i];
      frameSum += s * s;
      const abs = Math.abs(s);
      if (abs > peak) peak = abs;
    }
    sumSquares += frameSum;
    if (end - start === frame && Math.sqrt(frameSum / frame) > SPEECH_FRAME_RMS) speechFrames++;
  }
  return {
    durationSeconds: samples.length / sampleRate,
    speechSeconds: speechFrames * FRAME_SECONDS,
    rms: samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0,
    peak,
  };
}

const NOISE_TAG_RE = /^\s*[[(]?(muzyka|music|cisza|silence|szum|noise|applause|oklaski|śmiech|laughter)[\])]?\s*$/iu;

const CREDIT_PHRASES = [
  'wsz(?:elkie|ystkie) prawa zastrzeżone',
  'napisy stworzone przez społeczność amara\\.org',
  'dzięku(?:ję|jemy) za (?:oglądanie|uwagę)',
  'zdjęcia i montaż[\\p{L}\\s]{0,30}',
  'dyskusja o (?:wyborach|odpowiedzi)[\\p{L}\\s-]{0,40}',
  'www\\.[\\w.-]+(?:\\s+www\\.[\\w.-]+)*',
  'thanks? (?:you )?for watching',
  'subtitles by the amara\\.org community',
  '[\\p{L}\\s,-]{0,40}\\d{1,2}\\.\\d{2}\\.(?:19|20)\\d{2}\\s*r?',
];

const CREDITS_ONLY_RE = new RegExp(`^\\s*(?:${CREDIT_PHRASES.join('|')})[.!…]?\\s*$`, 'iu');

const TRAILING_CREDITS_RE = new RegExp(
  '(\\s*(?<![\\p{L}\\p{N}])(?:wsz(?:elkie|ystkie) prawa zastrzeżone|dyskusja o wyborach[\\p{L}\\s-]{0,30}|napisy stworzone przez społeczność amara\\.org|dzięku(?:ję|jemy) za oglądanie)[.!…]?\\s*)$',
  'iu',
);

const MIN_WORDS_BEFORE_TRAILING_CREDITS = 3;

export function isNoiseTag(text: string): boolean {
  return NOISE_TAG_RE.test(text);
}

export function isCreditsOnly(text: string): boolean {
  return CREDITS_ONLY_RE.test(text);
}

export function stripTrailingCredits(text: string): { text: string; stripped: string | null } {
  const match = TRAILING_CREDITS_RE.exec(text);
  if (!match || match.index === 0) return { text, stripped: null };
  const head = text.slice(0, match.index).trimEnd();
  const wordsBefore = head.split(/\s+/).filter(Boolean).length;
  if (wordsBefore < MIN_WORDS_BEFORE_TRAILING_CREDITS) return { text, stripped: null };
  return { text: head, stripped: match[1].trim() };
}
