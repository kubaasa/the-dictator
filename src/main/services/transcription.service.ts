import { pipeline, read_audio, env } from '@xenova/transformers';
import OpenAI from 'openai';
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

  isModelDownloaded(): boolean {
    const modelId = this.getModelId();
    const onnxDir = path.join(this.getModelsCacheDir(), modelId, 'onnx');
    try {
      return fs.readdirSync(onnxDir).some((f) => f.endsWith('.onnx'));
    } catch {
      return false;
    }
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

  async transcribeLocal(wavPath: string): Promise<string> {
    const modelId = this.getModelId();
    const language = (this.store.get('transcription.language') as string) ?? 'auto';

    if (!this.pipe) {
      throw new Error('Model not downloaded. Visit Modes to download it.');
    }

    // Reload if model setting changed
    if (this.loadedModelId !== modelId) {
      throw new Error('Model not downloaded. Visit Modes to download it.');
    }

    const audio = await read_audio(wavPath, 16000);

    const options: Record<string, unknown> = {};
    if (language !== 'auto') {
      options.language = language;
    }

    const result = await this.pipe(audio, options);
    return ((result as { text: string }).text ?? '').trim();
  }
}
