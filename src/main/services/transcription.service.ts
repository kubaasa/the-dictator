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

  constructor(private store: Store<AppSettings>) {
    env.cacheDir = MODELS_CACHE_DIR;
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

  private async transcribeApiFromBuffer(audioBuffer: ArrayBuffer, sampleRate: number): Promise<string> {
    const apiKey = (this.store.get('transcription.openaiApiKey') as string) ?? '';
    if (!apiKey) throw new Error('OpenAI API key is not set. Go to Modes and enter your key.');

    const language = (this.store.get('transcription.language') as string) ?? 'auto';
    const client = new OpenAI({ apiKey });

    const float32 = ipcBufferToFloat32(audioBuffer);
    const wavBuffer = encodeWav(float32, sampleRate);
    const file = await toFile(Buffer.from(wavBuffer), 'audio.wav', { type: 'audio/wav' });

    const response = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      ...(language !== 'auto' && { language }),
    });

    return response.text.trim();
  }

  private async transcribeLocalFromBuffer(audioBuffer: ArrayBuffer, sampleRate: number): Promise<string> {
    const modelId = this.getModelId();
    const language = (this.store.get('transcription.language') as string) ?? 'auto';

    if (!this.pipe || this.loadedModelId !== modelId) {
      if (!this.isModelDownloaded()) {
        throw new Error('Model not downloaded. Visit Modes to download it.');
      }
      await this.loadFromCache();
    }

    const float32 = ipcBufferToFloat32(audioBuffer);
    const audio = resampleFloat32(float32, sampleRate, 16000);

    const options: Record<string, unknown> = { task: 'transcribe' };
    if (language !== 'auto') options.language = language;

    const result = await this.pipe(audio, options);
    return ((result as { text: string }).text ?? '').trim();
  }

  async transcribeApi(wavPath: string): Promise<string> {
    const apiKey = (this.store.get('transcription.openaiApiKey') as string) ?? '';
    if (!apiKey) throw new Error('OpenAI API key is not set. Go to Modes and enter your key.');

    const language = (this.store.get('transcription.language') as string) ?? 'auto';
    const client = new OpenAI({ apiKey });

    const response = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(wavPath),
      ...(language !== 'auto' && { language }),
    });

    return response.text.trim();
  }

  private async loadFromCache(): Promise<void> {
    const modelId = this.getModelId();
    this.pipe = await pipeline('automatic-speech-recognition', modelId);
    this.loadedModelId = modelId;
  }

  async transcribeLocal(wavPath: string): Promise<string> {
    const modelId = this.getModelId();
    const language = (this.store.get('transcription.language') as string) ?? 'auto';

    if (!this.pipe || this.loadedModelId !== modelId) {
      if (!this.isModelDownloaded()) {
        throw new Error('Model not downloaded. Visit Modes to download it.');
      }
      await this.loadFromCache();
    }

    const audio = readWavAsFloat32(wavPath, 16000);

    const options: Record<string, unknown> = { task: 'transcribe' };
    if (language !== 'auto') {
      options.language = language;
    }

    const result = await this.pipe(audio, options);
    return ((result as { text: string }).text ?? '').trim();
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

/** Encodes Float32 PCM mono samples as a 16-bit WAV ArrayBuffer (for API upload). */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/**
 * Reads a WAV file (PCM format) and returns a Float32Array of mono samples
 * resampled to the target sample rate. Replaces @xenova/transformers read_audio
 * which requires AudioContext (browser-only API, unavailable in Node.js).
 */
function readWavAsFloat32(wavPath: string, targetSampleRate: number): Float32Array {
  const buf = fs.readFileSync(wavPath);

  const audioFormat = buf.readUInt16LE(20); // 1 = PCM, 3 = IEEE float
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  // Find "data" chunk — skip any extra chunks between fmt and data
  let dataOffset = 36;
  while (dataOffset < buf.length - 8) {
    const chunkId = buf.subarray(dataOffset, dataOffset + 4).toString('ascii');
    const chunkSize = buf.readUInt32LE(dataOffset + 4);
    if (chunkId === 'data') {
      dataOffset += 8;
      break;
    }
    dataOffset += 8 + chunkSize;
  }

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor((buf.length - dataOffset) / (bytesPerSample * numChannels));

  // Convert PCM to mono Float32
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const baseOffset = dataOffset + i * bytesPerSample * numChannels;
    let mono = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const chOffset = baseOffset + ch * bytesPerSample;
      if (bitsPerSample === 16 && audioFormat === 1) {
        mono += buf.readInt16LE(chOffset) / 32768.0;
      } else if (bitsPerSample === 32 && audioFormat === 3) {
        mono += buf.readFloatLE(chOffset);
      } else if (bitsPerSample === 32 && audioFormat === 1) {
        mono += buf.readInt32LE(chOffset) / 2147483648.0;
      }
    }
    samples[i] = mono / numChannels;
  }

  if (sampleRate === targetSampleRate) return samples;

  // Linear interpolation resample
  const ratio = sampleRate / targetSampleRate;
  const outLength = Math.floor(samples.length / ratio);
  const resampled = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = samples[idx] ?? 0;
    const b = samples[idx + 1] ?? a;
    resampled[i] = a + frac * (b - a);
  }
  return resampled;
}
