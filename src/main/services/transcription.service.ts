import { pipeline, env } from '@xenova/transformers';
import OpenAI, { toFile } from 'openai';
import type { AppSettings } from '../../shared/types';
import Store from 'electron-store';
import * as path from 'node:path';
import * as fs from 'node:fs';

const MODEL_MAP: Record<string, string> = {
  tiny: 'Xenova/whisper-tiny',
  'tiny.en': 'Xenova/whisper-tiny.en',
  base: 'Xenova/whisper-base',
  'base.en': 'Xenova/whisper-base.en',
  small: 'Xenova/whisper-small',
  medium: 'Xenova/whisper-medium',
  large: 'Xenova/whisper-large-v2',
  'large-v3': 'Xenova/whisper-large-v3',
};

env.allowLocalModels = false;

// Explicitly pin the cache dir so both download and detection always use the same path.
// Relying on env.cacheDir from @xenova/transformers is fragile in Electron (ESM loaded
// via CJS require — import.meta.url may be unavailable, leaving env.cacheDir null).
const MODELS_CACHE_DIR = path.join(
  path.dirname(require.resolve('@xenova/transformers')),
  '../.cache',
);

export class TranscriptionService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;
  private loadedModelId: string | null = null;
  private cancelController: AbortController | null = null;
  private loadingPromise: Promise<void> | null = null;
  private openaiClient: OpenAI | null = null;
  private openaiClientKey: string | null = null;
  private transcriptionCount = 0;
  private static readonly PIPELINE_RESET_INTERVAL = 8;

  constructor(private store: Store<AppSettings>) {
    env.cacheDir = MODELS_CACHE_DIR;
  }

  /** Preload model into memory on app startup (background, non-blocking). */
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

    console.log('[Dictator] Preloading local model in background…');
    const t0 = Date.now();
    await this.loadFromCache(modelId);
    console.log('[Dictator] Model preloaded in %dms', Date.now() - t0);
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

  // Ordered from largest/best to smallest — used for fallback selection
  private static readonly MODEL_SIZE_PRIORITY = [
    'large-v3', 'large', 'medium', 'small', 'base', 'base.en', 'tiny', 'tiny.en',
  ];

  /** Find the largest downloaded model key, or null if none downloaded. */
  private findBestDownloadedModel(): string | null {
    for (const size of TranscriptionService.MODEL_SIZE_PRIORITY) {
      if (this.isModelDownloaded(size)) return size;
    }
    return null;
  }

  /** Resolve model to use: selected if downloaded, otherwise best available fallback. */
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

    console.warn(`[Dictator] Model "${selectedSize}" not downloaded — falling back to "${bestSize}"`);
    return { modelId: MODEL_MAP[bestSize], fallback: true };
  }

  async downloadModel(onProgress: (pct: number) => void): Promise<void> {
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

    // Monkey-patch global.fetch to inject AbortSignal — the only way to stop
    // xenova's internal HTTP requests since it calls fetch() directly without
    // exposing any cancellation API.
    this.cancelController = new AbortController();
    const { signal } = this.cancelController;
    const originalFetch = global.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = (input: any, init?: any) => originalFetch(input, { ...init, signal });

    try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.pipe = await pipeline('automatic-speech-recognition', modelId, {
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
    } finally {
      global.fetch = originalFetch;
      this.cancelController = null;
    }
  }

  cancelDownload(): void {
    this.cancelController?.abort();
  }

  getModelsCacheDir(): string {
    return MODELS_CACHE_DIR;
  }

  async transcribeFromBuffer(audioBuffer: ArrayBuffer, sampleRate: number): Promise<string> {
    const engine = (this.store.get('transcription.engine') as string) ?? 'local';
    return engine === 'api'
      ? this.transcribeApiFromBuffer(audioBuffer, sampleRate)
      : this.transcribeLocalFromBuffer(audioBuffer, sampleRate);
  }

  /** Returns a cached OpenAI client (re-creates only when API key changes). */
  private getOpenAIClient(): OpenAI {
    const apiKey = (this.store.get('transcription.openaiApiKey') as string) ?? '';
    if (!apiKey) throw new Error('OpenAI API key is not set. Go to Modes and enter your key.');
    if (!this.openaiClient || this.openaiClientKey !== apiKey) {
      this.openaiClient = new OpenAI({ apiKey });
      this.openaiClientKey = apiKey;
    }
    return this.openaiClient;
  }

  private async transcribeApiFromBuffer(audioBuffer: ArrayBuffer, sampleRate: number): Promise<string> {
    const client = this.getOpenAIClient();
    const language = (this.store.get('transcription.language') as string) ?? 'auto';

    const float32 = ipcBufferToFloat32(audioBuffer);
    const wavBuffer = encodeWavFast(float32, sampleRate);
    const file = await toFile(wavBuffer, 'audio.wav', { type: 'audio/wav' });

    const response = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      ...(language !== 'auto' && { language }),
    });

    return response.text.trim();
  }

  private async transcribeLocalFromBuffer(audioBuffer: ArrayBuffer, sampleRate: number): Promise<string> {
    const { modelId } = this.resolveModelId();
    const language = (this.store.get('transcription.language') as string) ?? 'auto';

    if (!this.pipe || this.loadedModelId !== modelId) {
      await this.loadFromCache(modelId);
    }

    const float32 = ipcBufferToFloat32(audioBuffer);
    // Skip resampling if audio is already at 16kHz (renderer records at 16kHz)
    const audio = sampleRate === 16000 ? float32 : resampleFloat32(float32, sampleRate, 16000);

    const durationSeconds = float32.length / 16000;
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
    if (language === 'pl') options.initial_prompt = 'Dyktowanie tekstu po polsku.';

    const result = await this.pipe(audio, options);
    const text = ((result as { text: string }).text ?? '').trim();

    // Reset WASM heap periodically — ONNX Runtime heap grows monotonically,
    // causing slowdowns after many recordings. Reload in background so the
    // next call doesn't block.
    this.transcriptionCount++;
    if (this.transcriptionCount % TranscriptionService.PIPELINE_RESET_INTERVAL === 0) {
      this.pipe = null;
      this.loadedModelId = null;
      // loadFromCache() guards against concurrent loads via loadingPromise — don't null it here
      this.loadFromCache().catch((e) => console.warn('[Dictator] Background model reload failed:', e));
    }

    return text;
  }

  private async loadFromCache(overrideModelId?: string): Promise<void> {
    // Prevent concurrent model loads (race condition when user changes model mid-transcription)
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    const modelId = overrideModelId ?? this.getModelId();
    this.loadingPromise = (async () => {
      this.pipe = await pipeline('automatic-speech-recognition', modelId);
      this.loadedModelId = modelId;
    })();

    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

}

/** Converts IPC-transferred ArrayBuffer (arrives as Node.js Buffer) to Float32Array. */
function ipcBufferToFloat32(buffer: ArrayBuffer): Float32Array {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** Linear interpolation resample. */
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

