import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

export class AudioRecorderService {
  private recordingsDir: string;

  constructor() {
    this.recordingsDir = path.join(app.getPath('userData'), 'recordings');
    if (!fs.existsSync(this.recordingsDir)) {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
    }
  }

  /**
   * Saves raw PCM Float32 audio data as a WAV file.
   * Returns the path to the saved file.
   */
  async saveWav(audioBuffer: ArrayBuffer, sampleRate: number): Promise<string> {
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `recording_${timestamp}.wav`;
    const filepath = path.join(this.recordingsDir, filename);

    const wavBuffer = this.encodeWav(audioBuffer, sampleRate);
    fs.writeFileSync(filepath, Buffer.from(wavBuffer));

    return filepath;
  }

  getRecordingsDir(): string {
    return this.recordingsDir;
  }

  // PCM Float32 -> WAV (16-bit PCM)
  // IPC sends ArrayBuffer as Node.js Buffer — we need to reinterpret bytes as Float32
  private encodeWav(samples: ArrayBuffer | Buffer, sampleRate: number): ArrayBuffer {
    const buf = Buffer.isBuffer(samples) ? samples : Buffer.from(samples);
    const float32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const dataLength = float32.length * bytesPerSample;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;

    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);

    // RIFF header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    this.writeString(view, 8, 'WAVE');

    // fmt chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // Convert Float32 [-1, 1] to Int16
    let offset = 44;
    for (let i = 0; i < float32.length; i++, offset += 2) {
      const sample = Math.max(-1, Math.min(1, float32[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    return buffer;
  }

  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
}
