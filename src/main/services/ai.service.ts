import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import Store from 'electron-store';
import type { AppSettings, VocabularyEntry } from '../../shared/types';
import { getApiKey } from './secure-storage';
import logger from './logger';

const log = logger.scope('AI');

/** Per-method timeout for AI streaming — clean cancellation if a stream hangs. */
const AI_METHOD_TIMEOUT_MS = 25_000;

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

export class AIService {
  private openaiClient: OpenAI | null = null;
  private openaiClientKey: string | null = null;
  private anthropicClient: Anthropic | null = null;
  private anthropicClientKey: string | null = null;

  constructor(private store: Store<AppSettings>) {}

  /** Validate an OpenAI API key by calling the lightweight /models endpoint. */
  static async validateOpenAIKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = new OpenAI({ apiKey });
      await client.models.list({ timeout: 5000 });
      return { valid: true };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) return { valid: false, error: 'Invalid API key. Check that you copied it correctly.' };
      if (status === 403) return { valid: false, error: 'API key does not have permission. Generate a new one.' };
      return { valid: false, error: err instanceof Error ? err.message : 'Validation failed' };
    }
  }

  /** Validate an Anthropic API key by calling the lightweight count_tokens endpoint. */
  static async validateAnthropicKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = new Anthropic({ apiKey });
      await client.messages.countTokens({
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: 'validate' }],
      });
      return { valid: true };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) return { valid: false, error: 'Invalid API key. Check that you copied it correctly.' };
      if (status === 403) return { valid: false, error: 'API key does not have permission. Generate a new one.' };
      return { valid: false, error: err instanceof Error ? err.message : 'Validation failed' };
    }
  }

  /**
   * Pre-establish TCP+TLS connection with the configured AI provider.
   * Call this when transcription starts so the connection is ready when AI processing begins.
   * Failures are silently ignored — warmup is a best-effort optimization.
   */
  async warmup(): Promise<void> {
    const aiEnabled = (this.store.get('dictation.aiPostProcessing') as boolean) ?? true;
    if (!aiEnabled) return;

    const provider = (this.store.get('ai.provider') as string) ?? 'openai';

    try {
      switch (provider) {
        case 'openai': {
          const client = this.getOpenAIClient();
          // Tiny models.list() call — just enough to establish the connection
          await client.models.list({ timeout: 5000 });
          break;
        }
        case 'anthropic': {
          const client = this.getAnthropicClient();
          // Send a minimal request that establishes the TLS connection.
          // count_tokens is the lightest Anthropic endpoint.
          await client.messages.countTokens({
            model: (this.store.get('ai.anthropicModel') as string) ?? 'claude-haiku-4-5-20251001',
            messages: [{ role: 'user', content: 'warmup' }],
          });
          break;
        }
      }
    } catch {
      // Warmup failure is non-critical — the real request will establish the connection
    }
  }

  async process(rawText: string): Promise<string> {
    const aiEnabled = (this.store.get('dictation.aiPostProcessing') as boolean) ?? true;
    if (!aiEnabled) return rawText;

    const provider = (this.store.get('ai.provider') as string) ?? 'openai';

    const basePrompt = (this.store.get('dictation.customPrompt') as string) ?? '';
    if (!basePrompt) return rawText;

    const language = (this.store.get('transcription.language') as string) ?? 'en';
    const languageNames: Record<string, string> = { en: 'English', pl: 'Polish', th: 'Thai' };
    const languageName = languageNames[language] ?? 'English';

    const vocab = (this.store.get('vocabulary') as VocabularyEntry[]) ?? [];
    let vocabSection = '';
    if (vocab.length > 0) {
      const lines = vocab.map(entry => {
        if (entry.replacement) return `- "${entry.input}" → "${entry.replacement}"`;
        return `- "${entry.input}"`;
      });
      vocabSection = `\n\nVocabulary/Names list (use for spelling context):\n${lines.join('\n')}`;
    }

    const systemPrompt = `${basePrompt}${vocabSection} Always respond in ${languageName}.`;

    switch (provider) {
      case 'openai':
        return this.processOpenAI(rawText, systemPrompt);
      case 'anthropic':
        return this.processAnthropic(rawText, systemPrompt);
      default:
        return rawText;
    }
  }

  private getOpenAIClient(): OpenAI {
    const apiKey = getApiKey(this.store, 'ai.openaiApiKey');
    if (!apiKey) throw new Error('OpenAI API key for AI processing is not set.');
    if (!this.openaiClient || this.openaiClientKey !== apiKey) {
      this.openaiClient = new OpenAI({ apiKey });
      this.openaiClientKey = apiKey;
    }
    return this.openaiClient;
  }

  private getAnthropicClient(): Anthropic {
    const apiKey = getApiKey(this.store, 'ai.anthropicApiKey');
    if (!apiKey) throw new Error('Anthropic API key for AI processing is not set.');
    if (!this.anthropicClient || this.anthropicClientKey !== apiKey) {
      this.anthropicClient = new Anthropic({ apiKey });
      this.anthropicClientKey = apiKey;
    }
    return this.anthropicClient;
  }

  private async processOpenAI(text: string, systemPrompt: string): Promise<string> {
    return withRetry(async () => {
      const client = this.getOpenAIClient();
      const model = (this.store.get('ai.openaiModel') as string) ?? 'gpt-4.1-nano';
      const temperature = (this.store.get('ai.temperature') as number) ?? 0.3;

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), AI_METHOD_TIMEOUT_MS);

      try {
        const stream = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
          temperature,
          stream: true,
        }, { signal: abortController.signal as AbortSignal });

        const chunks: string[] = [];
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) chunks.push(delta);
        }
        return chunks.join('').trim() || text;
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private async processAnthropic(text: string, systemPrompt: string): Promise<string> {
    return withRetry(async () => {
      const client = this.getAnthropicClient();
      const model = (this.store.get('ai.anthropicModel') as string) ?? 'claude-haiku-4-5-20251001';
      const temperature = (this.store.get('ai.temperature') as number) ?? 0.3;

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), AI_METHOD_TIMEOUT_MS);

      try {
        const stream = client.messages.stream({
          model,
          max_tokens: 4096,
          temperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: text }],
        }, { signal: abortController.signal as AbortSignal });

        const chunks: string[] = [];
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            chunks.push(event.delta.text);
          }
        }
        return chunks.join('').trim() || text;
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  async getOpenAIModels(): Promise<{ value: string; label: string }[]> {
    try {
      const client = this.getOpenAIClient();
      const response = await client.models.list();

      // Keep only chat-capable GPT/O-series models, skip fine-tuned, embedding, audio, etc.
      const ALLOWED_PREFIXES = ['gpt-4', 'gpt-3.5', 'o1', 'o3', 'o4'];
      const SKIP_KEYWORDS = ['instruct', 'embed', 'audio', 'realtime', 'tts', 'dall-e', 'whisper', 'babbage', 'davinci'];

      return response.data
        .filter(m => ALLOWED_PREFIXES.some(p => m.id.startsWith(p)))
        .filter(m => !SKIP_KEYWORDS.some(k => m.id.includes(k)))
        .sort((a, b) => b.id.localeCompare(a.id))
        .map(m => ({ value: m.id, label: m.id }));
    } catch {
      return [];
    }
  }

  async testPrompt(text: string, systemPrompt: string): Promise<string> {
    const provider = (this.store.get('ai.provider') as string) ?? 'openai';
    if (!systemPrompt) throw new Error('System prompt is empty.');

    const language = (this.store.get('transcription.language') as string) ?? 'en';
    const languageNames: Record<string, string> = { en: 'English', pl: 'Polish', th: 'Thai' };
    const languageName = languageNames[language] ?? 'English';
    const fullPrompt = `${systemPrompt} Always respond in ${languageName}.`;

    switch (provider) {
      case 'openai':
        return this.processOpenAI(text, fullPrompt);
      case 'anthropic':
        return this.processAnthropic(text, fullPrompt);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
