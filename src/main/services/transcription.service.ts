import OpenAI, { toFile } from 'openai';
import type { AppSettings, VocabularyEntry } from '../../shared/types';
import { app } from 'electron';
import Store from 'electron-store';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getApiKey } from './secure-storage';
import logger from './logger';

const log = logger.scope('Transcription');

// Lazy-loaded @huggingface/transformers — the library eagerly loads onnxruntime-node
// native bindings at import time, which crashes on systems without DirectML support
// (e.g. VirtualBox VMs). Dynamic import() defers loading until local transcription
// is actually needed, allowing the app to start even without ONNX runtime.
type TransformersModule = typeof import('@huggingface/transformers');
let _transformers: TransformersModule | null = null;

async function getTransformers(): Promise<TransformersModule> {
  if (!_transformers) {
    _transformers = await import('@huggingface/transformers');
    _transformers.env.allowLocalModels = false;
    _transformers.env.cacheDir = MODELS_CACHE_DIR;
  }
  return _transformers;
}

/** Retry on transient network/server errors (5xx, timeout). Auth errors (401/403) are never retried. */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2, delayMs = 1000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) throw err;
      if (attempt < maxAttempts) {
        log.warn('Retry attempt %d/%d after error:', attempt, maxAttempts, err instanceof Error ? err.message : err);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

const MODEL_MAP: Record<string, string> = {
  tiny: 'onnx-community/whisper-tiny',
  'tiny.en': 'onnx-community/whisper-tiny.en',
  base: 'onnx-community/whisper-base',
  'base.en': 'onnx-community/whisper-base.en',
  small: 'onnx-community/whisper-small',
  medium: 'onnx-community/whisper-medium-ONNX',
  large: 'onnx-community/whisper-large-v2-ONNX',
  'large-v3': 'onnx-community/whisper-large-v3-ONNX',
  'large-v3-turbo': 'onnx-community/whisper-large-v3-turbo',
  'distil-medium.en': 'distil-whisper/distil-medium.en',
  'distil-large-v3': 'distil-whisper/distil-large-v3',
};

// Large models (medium+) have fp32 encoders >2GB split into .onnx + .onnx_data files
// which fail to load. fp16 quantization keeps them in a single file with negligible accuracy loss.
const NEEDS_QUANTIZATION = new Set(['medium', 'large', 'large-v3', 'large-v3-turbo']);
const QUANTIZED_DTYPE = { encoder_model: 'fp16', decoder_model_merged: 'fp16' };

function getDtypeForModel(modelId: string): Record<string, string> | undefined {
  for (const [size, id] of Object.entries(MODEL_MAP)) {
    if (id === modelId && NEEDS_QUANTIZATION.has(size)) return QUANTIZED_DTYPE;
  }
  return undefined;
}

// Store models in userData — always writable, survives app updates.
// The old require.resolve() approach pointed inside app.asar in production,
// causing ENOTDIR when the library tried to create the cache directory.
const MODELS_CACHE_DIR = path.join(app.getPath('userData'), 'models');

// Capture the pristine global.fetch once at module load — never lost even if overrides overlap.
const pristineFetch = global.fetch;
let fetchOverrideCount = 0;

export class TranscriptionService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;
  private loadedModelId: string | null = null;
  private cancelController: AbortController | null = null;
  private downloadPromise: Promise<void> | null = null;
  private loadingPromise: Promise<void> | null = null;
  private groqClient: OpenAI | null = null;
  private groqClientKey: string | null = null;
  private transcriptionCount = 0;
  private static readonly PIPELINE_RESET_INTERVAL = 8;

  constructor(private store: Store<AppSettings>) {}

  static async validateGroqApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
      await client.models.list({ timeout: 5000 });
      return { valid: true };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) return { valid: false, error: 'Invalid API key. Check that you copied it correctly.' };
      if (status === 403) return { valid: false, error: 'API key does not have permission. Generate a new one.' };
      return { valid: false, error: err instanceof Error ? err.message : 'Validation failed' };
    }
  }

  async preloadModel(): Promise<void> {
    const engine = (this.store.get('transcription.engine') as string) ?? 'local';
    if (engine !== 'local') return;

    let modelId: string;
    try {
      ({ modelId } = this.resolveModelId());
    } catch {
      return; // no model downloaded — skip preload
    }

    if (this.pipe && this.loadedModelId === modelId) return;

    log.info('Preloading local model in background…');
    const t0 = Date.now();
    await this.loadFromCache(modelId);
    log.info('Model preloaded in %dms', Date.now() - t0);
  }

  private getModelId(): string {
    const modelSize = (this.store.get('transcription.localModelSize') as string) ?? 'base';
    return MODEL_MAP[modelSize] ?? MODEL_MAP['base'];
  }

  isModelDownloaded(modelSize?: string): boolean {
    const modelId = modelSize ? (MODEL_MAP[modelSize] ?? MODEL_MAP['base']) : this.getModelId();
    const onnxDir = path.join(this.getModelsCacheDir(), modelId, 'onnx');
    try {
      return fs.readdirSync(onnxDir).some((f) => f.endsWith('.onnx'));
    } catch {
      return false;
    }
  }

  getDownloadedModels(): string[] {
    return Object.keys(MODEL_MAP).filter((size) => this.isModelDownloaded(size));
  }

  private static readonly MODEL_SIZE_PRIORITY = [
    'distil-large-v3', 'large-v3-turbo', 'large-v3', 'large', 'distil-medium.en', 'medium', 'small', 'base', 'base.en', 'tiny', 'tiny.en',
  ];

  private findBestDownloadedModel(): string | null {
    for (const size of TranscriptionService.MODEL_SIZE_PRIORITY) {
      if (this.isModelDownloaded(size)) return size;
    }
    return null;
  }

  private resolveModelId(): { modelId: string; fallback: boolean } {
    const selectedId = this.getModelId();
    const selectedSize = (this.store.get('transcription.localModelSize') as string) ?? 'base';

    if (this.isModelDownloaded(selectedSize)) {
      return { modelId: selectedId, fallback: false };
    }

    const bestSize = this.findBestDownloadedModel();
    if (!bestSize) {
      throw new Error('No model downloaded. Visit Modes to download one.');
    }

    log.warn('Model "%s" not downloaded — falling back to "%s"', selectedSize, bestSize);
    return { modelId: MODEL_MAP[bestSize], fallback: true };
  }

  // TODO: Downloaded ONNX model files are not verified against checksums.
  // HuggingFace doesn't expose simple per-file checksums in its API, so proper
  // integrity verification would require parsing the repo's LFS metadata.
  // Corrupted-in-transit files could cause silent transcription failures.
  async downloadModel(onProgress: (pct: number) => void): Promise<void> {
    // Wait for any previous download/cleanup to fully finish before starting.
    // Prevents EPERM on Windows when Cancel → Download is clicked rapidly
    // (rmSync / stream close races with new file open).
    if (this.downloadPromise) {
      await this.downloadPromise.catch((err) => { logger.debug('Previous download promise rejected (already handled):', err); });
    }

    this.downloadPromise = this.executeDownload(onProgress);
    try {
      await this.downloadPromise;
    } finally {
      this.downloadPromise = null;
    }
  }

  private async executeDownload(onProgress: (pct: number) => void): Promise<void> {
    const modelId = this.getModelId();

    // Only count files > 20 MB (actual ONNX model weights).
    // Smaller files — tokenizer.json (~2 MB), merges.txt, config.json — download in seconds
    // and cause a fake 0→100% spike before the real large-file download even starts.
    const LARGE_FILE_THRESHOLD = 20 * 1024 * 1024;

    // High-watermark: progress never goes backwards.
    // Sequential ONNX files (encoder then decoder) would otherwise reset the bar
    // when the second file starts (e.g. encoder done → 100%, decoder starts → 33%).
    let hwm = -1;
    const fileBytes = new Map<string, { loaded: number; total: number }>();

    // Scoped fetch override: inject AbortSignal ONLY into HuggingFace model download
    // requests. Other fetch calls (Groq API, etc.) pass through untouched.
    // Uses ref-counted pristineFetch captured at module load — safe even if downloads overlap.
    this.cancelController = new AbortController();
    const { signal } = this.cancelController;
    fetchOverrideCount++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as { url?: string })?.url ?? '';
      const isHfRequest = url.includes('huggingface.co') || url.includes('hf.co');
      return pristineFetch(input, { ...init, ...(isHfRequest ? { signal } : {}) });
    };

    try {
    // Download with CPU first — reliable, and caches model files for DML reuse.
    const dtype = getDtypeForModel(modelId);
    const { pipeline } = await getTransformers();
    this.pipe = await pipeline('automatic-speech-recognition', modelId, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      device: 'cpu' as any,
      ...(dtype && { dtype }),
      progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (info.status === 'progress' && info.file != null) {
          fileBytes.set(info.file, {
            loaded: info.loaded ?? 0,
            total: info.total ?? 0,
          });

          const largeFiles = [...fileBytes.values()].filter((f) => f.total > LARGE_FILE_THRESHOLD);
          if (largeFiles.length === 0) return;

          const totalBytes = largeFiles.reduce((s, f) => s + f.total, 0);
          const loadedBytes = largeFiles.reduce((s, f) => s + f.loaded, 0);
          // Cap at 99 so only MODEL_DOWNLOAD_DONE can flip the bar to 100%
          const pct = Math.min(Math.round((loadedBytes / totalBytes) * 100), 99);

          if (pct > hwm) {
            hwm = pct;
            onProgress(pct);
          }
        }
      },
    });
    this.loadedModelId = modelId;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Windows doesn't release file handles from aborted fetch streams immediately.
        // Without this delay, a rapid Cancel → Download sequence would EPERM
        // because the new pipeline tries to open files still locked by the old stream.
        await new Promise((r) => setTimeout(r, 500));
        const modelDir = path.join(MODELS_CACHE_DIR, modelId);
        try {
          fs.rmSync(modelDir, { recursive: true, force: true });
          log.info('Cleaned up partial download: %s', modelId);
        } catch (cleanupErr) {
          log.warn('Failed to clean up partial download:', cleanupErr);
        }
      }
      throw err;
    } finally {
      fetchOverrideCount--;
      if (fetchOverrideCount <= 0) {
        global.fetch = pristineFetch;
        fetchOverrideCount = 0;
      }
      this.cancelController = null;
    }
  }

  cancelDownload(): void {
    this.cancelController?.abort();
    this.pipe = null;
    this.loadedModelId = null;
  }

  getModelsCacheDir(): string {
    return MODELS_CACHE_DIR;
  }

  async transcribeFromBuffer(audioBuffer: ArrayBuffer, sampleRate: number, compressedAudio?: ArrayBuffer): Promise<string> {
    const engine = (this.store.get('transcription.engine') as string) ?? 'local';

    // Cloud path: prefer pre-compressed WebM/Opus from MediaRecorder (~8x smaller upload).
    // Trade-off: compressed blob is raw recording (no trimSilence/normalizeAudio) because
    // we can't apply Float32 preprocessing to an already-encoded WebM. Groq Whisper API
    // is robust to silence and volume variations, so faster upload outweighs preprocessing.
    const compressedSize = compressedAudio ? (Buffer.isBuffer(compressedAudio) ? compressedAudio.length : compressedAudio.byteLength) : 0;
    if (engine === 'cloud' && compressedSize > 0) {
      return this.transcribeGroqFromCompressed(compressedAudio);
    }

    // Preprocess: trim silence edges + normalize peak level before transcription.
    // Both are near-zero-cost (single pass over Float32) but improve accuracy and reduce
    // wasted inference time on leading/trailing silence.
    const raw = ipcBufferToFloat32(audioBuffer);
    const trimmed = trimSilence(raw, sampleRate);
    const normalized = normalizeAudio(trimmed);
    const preprocessed = Buffer.from(normalized.buffer, normalized.byteOffset, normalized.byteLength);

    return engine === 'cloud'
      ? this.transcribeGroqFromBuffer(preprocessed, sampleRate)
      : this.transcribeLocalFromBuffer(preprocessed, sampleRate);
  }

  private getGroqClient(): OpenAI {
    const apiKey = getApiKey(this.store, 'transcription.groqApiKey');
    if (!apiKey) throw new Error('Groq API key is not set. Go to Modes and enter your key.');
    if (!this.groqClient || this.groqClientKey !== apiKey) {
      this.groqClient = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
      this.groqClientKey = apiKey;
    }
    return this.groqClient;
  }

  private getVocabularyPromptHint(): string {
    const vocab = this.store.get('vocabulary') as (VocabularyEntry | string)[];
    if (!Array.isArray(vocab) || vocab.length === 0) return '';
    const words = vocab
      .map(entry => typeof entry === 'string' ? entry : entry.input)
      .filter(Boolean);
    if (words.length === 0) return '';
    return words.join(', ');
  }

  /**
   * Build Groq Whisper prompt: a style-formatted sentence (guides the model to
   * produce consistent capitalization and punctuation) + vocabulary hints.
   */
  private buildGroqPrompt(): string {
    const language = (this.store.get('transcription.language') as string) ?? 'auto';
    const vocabHint = this.getVocabularyPromptHint();

    const STYLE_HINTS: Record<string, string> = {
      pl: 'Witaj. Dyktowanie tekstu po polsku, z poprawną interpunkcją.',
      en: 'Hello. Dictating text with proper punctuation and capitalization.',
    };
    const styleHint = STYLE_HINTS[language] ?? STYLE_HINTS['en'];

    return [styleHint, vocabHint].filter(Boolean).join(' ');
  }

  private async transcribeGroqFromBuffer(audioBuffer: ArrayBuffer, sampleRate: number): Promise<string> {
    return withRetry(async () => {
      const client = this.getGroqClient();
      const language = (this.store.get('transcription.language') as string) ?? 'auto';
      const prompt = this.buildGroqPrompt();

      const float32 = ipcBufferToFloat32(audioBuffer);
      const wavBuffer = encodeWavFast(float32, sampleRate);
      const file = await toFile(wavBuffer, 'audio.wav', { type: 'audio/wav' });

      const response = await client.audio.transcriptions.create({
        model: 'whisper-large-v3',
        file,
        prompt,
        ...(language !== 'auto' && { language }),
      });

      return response.text.trim();
    });
  }

  private async transcribeGroqFromCompressed(compressedAudio: ArrayBuffer): Promise<string> {
    return withRetry(async () => {
      const client = this.getGroqClient();
      const language = (this.store.get('transcription.language') as string) ?? 'auto';
      const prompt = this.buildGroqPrompt();

      const buf = Buffer.isBuffer(compressedAudio) ? compressedAudio : Buffer.from(compressedAudio);
      const file = await toFile(buf, 'audio.webm', { type: 'audio/webm' });

      const response = await client.audio.transcriptions.create({
        model: 'whisper-large-v3',
        file,
        prompt,
        ...(language !== 'auto' && { language }),
      });

      return response.text.trim();
    });
  }

  private async transcribeLocalFromBuffer(audioBuffer: ArrayBuffer, sampleRate: number): Promise<string> {
    const { modelId } = this.resolveModelId();
    const language = (this.store.get('transcription.language') as string) ?? 'auto';

    if (!this.pipe || this.loadedModelId !== modelId) {
      await this.loadFromCache(modelId);
    }

    const float32 = ipcBufferToFloat32(audioBuffer);
    const audio = sampleRate === 16000 ? float32 : resampleFloat32(float32, sampleRate, 16000);

    const durationSeconds = float32.length / sampleRate;
    const options: Record<string, unknown> = { task: 'transcribe' };

    // Long-form pipeline (chunk_length_s + stride_length_s) is needed only for audio > 30s.
    // For short recordings it causes hallucinations: the long-form pipeline conditions on
    // previous tokens via return_timestamps, which makes the model repeat spoken numbers
    // or invent continuations for the silence-padded portion of the 30s context window.
    if (durationSeconds > 30) {
      options.chunk_length_s = 30;
      options.stride_length_s = 5;
    }

    if (language !== 'auto') options.language = language;
    const vocabHint = this.getVocabularyPromptHint();
    const langHints: Record<string, string> = {
      pl: 'Dyktowanie tekstu po polsku.',
    };
    const langHint = langHints[language] ?? '';
    const promptParts = [langHint, vocabHint].filter(Boolean);
    if (promptParts.length > 0) {
      options.initial_prompt = promptParts.join(' ');
    }

    // Cap output tokens based on audio duration to prevent hallucination loops.
    // Normal speech: ~2-4 tokens/s, 8 tokens/s is a safe margin.
    // Normal transcriptions hit EOS well before this limit (zero impact).
    // Hallucinations: cut from up to 448 tokens down to a reasonable cap (saves 1-5s).
    options.max_new_tokens = Math.min(4096, Math.max(50, Math.ceil(durationSeconds * 8)));

    const result = await this.pipe(audio, options);
    const text = ((result as { text: string }).text ?? '').trim();

    // Reset pipeline periodically — native ONNX Runtime can accumulate memory over
    // many inference sessions. Reload in background so the next call doesn't block.
    this.transcriptionCount++;
    if (this.transcriptionCount % TranscriptionService.PIPELINE_RESET_INTERVAL === 0) {
      this.pipe = null;
      this.loadedModelId = null;
      // loadFromCache() guards against concurrent loads via loadingPromise — don't null it here
      this.loadFromCache().catch((e) => log.warn('Background model reload failed:', e));
    }

    return text;
  }

  private async loadFromCache(overrideModelId?: string): Promise<void> {
    // Prevent concurrent model loads (race condition when user changes model mid-transcription)
    if (this.loadingPromise) {
      await this.loadingPromise;
      const modelId = overrideModelId ?? this.getModelId();
      if (this.loadedModelId === modelId) return;
    }

    const modelId = overrideModelId ?? this.getModelId();
    const dtype = getDtypeForModel(modelId);
    this.loadingPromise = (async () => {
      const { pipeline } = await getTransformers();
      this.pipe = await pipeline('automatic-speech-recognition', modelId, {
        ...(dtype && { dtype }),
      });
      this.loadedModelId = modelId;
      log.info('Pipeline loaded (model=%s)', modelId);
    })();

    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

}

/**
 * Trim leading and trailing silence from audio.
 * Scans inward from both edges until RMS of a 512-sample window exceeds threshold.
 * Keeps a safety margin (350ms) to avoid clipping speech onset/offset.
 */
function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
  const WINDOW = 512;
  const THRESHOLD = 0.01;
  const MARGIN = Math.round(sampleRate * 0.35); // 350ms

  // Too short to analyze — return as-is (also handles edge case where length < WINDOW)
  if (samples.length < WINDOW * 2) return samples;

  function windowRms(start: number): number {
    const end = Math.min(start + WINDOW, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / (end - start));
  }

  // If no window exceeds threshold (full silence), both loops complete without break,
  // leaving startIdx=0 and endIdx=samples.length → returns original audio unchanged.
  // This is fine: ipc-handlers.ts already skips transcription for RMS < 0.01 audio.
  let startIdx = 0;
  for (let i = 0; i < samples.length - WINDOW; i += WINDOW) {
    if (windowRms(i) >= THRESHOLD) { startIdx = i; break; }
  }

  let endIdx = samples.length;
  for (let i = samples.length - WINDOW; i > startIdx; i -= WINDOW) {
    if (windowRms(i) >= THRESHOLD) { endIdx = Math.min(i + WINDOW, samples.length); break; }
  }

  startIdx = Math.max(0, startIdx - MARGIN);
  endIdx = Math.min(samples.length, endIdx + MARGIN);

  // Don't trim if the result would be too short (<500ms) — likely a false positive
  if (endIdx - startIdx < sampleRate * 0.5) return samples;

  return samples.subarray(startIdx, endIdx);
}

/**
 * Peak-normalize audio so the loudest sample reaches targetPeak (0.9).
 * Ensures consistent input level regardless of microphone gain.
 * Returns the original array if already near target or silent.
 */
function normalizeAudio(samples: Float32Array, targetPeak = 0.9): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }

  // Skip if already near target (within 10%) or audio is near-silent
  if (peak < 0.001 || (peak > targetPeak * 0.9 && peak < targetPeak * 1.1)) return samples;

  const gain = targetPeak / peak;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

function ipcBufferToFloat32(buffer: ArrayBuffer): Float32Array {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function resampleFloat32(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx] ?? 0;
    const b = samples[idx + 1] ?? a;
    out[i] = a + frac * (b - a);
  }
  return out;
}

/**
 * Fast WAV encoder using Buffer + Int16Array bulk write instead of per-sample DataView.
 * ~3-5x faster than DataView.setInt16() for large audio buffers.
 */
function encodeWavFast(samples: Float32Array, sampleRate: number): Buffer {
  const dataLength = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLength);

  // WAV header
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);       // chunk size
  buf.writeUInt16LE(1, 20);        // PCM
  buf.writeUInt16LE(1, 22);        // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);        // block align
  buf.writeUInt16LE(16, 34);       // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLength, 40);

  // Bulk convert Float32 → Int16 PCM using typed array (much faster than per-sample DataView)
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  Buffer.from(pcm.buffer).copy(buf, 44);

  return buf;
}
