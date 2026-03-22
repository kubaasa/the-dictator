import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import Store from 'electron-store';
import type { AppSettings } from '../../shared/types';

export class AIService {
  private openaiClient: OpenAI | null = null;
  private openaiClientKey: string | null = null;
  private anthropicClient: Anthropic | null = null;
  private anthropicClientKey: string | null = null;

  constructor(private store: Store<AppSettings>) {}

  /**
   * Pre-establish TCP+TLS connection with the configured AI provider.
   * Call this when transcription starts so the connection is ready when AI processing begins.
   * Failures are silently ignored — warmup is a best-effort optimization.
   */
  async warmup(): Promise<void> {
    const aiEnabled = (this.store.get('dictation.aiPostProcessing') as boolean) ?? true;
    if (!aiEnabled) return;

    const provider = (this.store.get('ai.provider') as string) ?? 'none';
    if (provider === 'none') return;

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
        case 'ollama': {
          const baseUrl = (this.store.get('ai.ollamaUrl') as string) ?? 'http://localhost:11434';
          await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
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

    const provider = (this.store.get('ai.provider') as string) ?? 'none';
    if (provider === 'none') return rawText;

    const basePrompt = (this.store.get('dictation.customPrompt') as string) ?? '';
    if (!basePrompt) return rawText;

    const language = (this.store.get('transcription.language') as string) ?? 'en';
    const languageNames: Record<string, string> = { en: 'English', pl: 'Polish' };
    const languageName = languageNames[language] ?? 'English';
    const systemPrompt = `${basePrompt} Always respond in ${languageName}.`;

    switch (provider) {
      case 'openai':
        return this.processOpenAI(rawText, systemPrompt);
      case 'anthropic':
        return this.processAnthropic(rawText, systemPrompt);
      case 'ollama':
        return this.processOllama(rawText, systemPrompt);
      default:
        return rawText;
    }
  }

  private getOpenAIClient(): OpenAI {
    const apiKey = (this.store.get('ai.openaiApiKey') as string) ?? '';
    if (!apiKey) throw new Error('OpenAI API key for AI processing is not set.');
    if (!this.openaiClient || this.openaiClientKey !== apiKey) {
      this.openaiClient = new OpenAI({ apiKey });
      this.openaiClientKey = apiKey;
    }
    return this.openaiClient;
  }

  private getAnthropicClient(): Anthropic {
    const apiKey = (this.store.get('ai.anthropicApiKey') as string) ?? '';
    if (!apiKey) throw new Error('Anthropic API key for AI processing is not set.');
    if (!this.anthropicClient || this.anthropicClientKey !== apiKey) {
      this.anthropicClient = new Anthropic({ apiKey });
      this.anthropicClientKey = apiKey;
    }
    return this.anthropicClient;
  }

  private async processOpenAI(text: string, systemPrompt: string): Promise<string> {
    const client = this.getOpenAIClient();
    const model = (this.store.get('ai.openaiModel') as string) ?? 'gpt-4.1-nano';
    const temperature = (this.store.get('ai.temperature') as number) ?? 0.3;

    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature,
      stream: true,
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) chunks.push(delta);
    }
    return chunks.join('').trim() || text;
  }

  private async processAnthropic(text: string, systemPrompt: string): Promise<string> {
    const client = this.getAnthropicClient();
    const model = (this.store.get('ai.anthropicModel') as string) ?? 'claude-haiku-4-5-20251001';
    const temperature = (this.store.get('ai.temperature') as number) ?? 0.3;

    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    });

    const chunks: string[] = [];
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        chunks.push(event.delta.text);
      }
    }
    return chunks.join('').trim() || text;
  }

  private async processOllama(text: string, systemPrompt: string): Promise<string> {
    const baseUrl = (this.store.get('ai.ollamaUrl') as string) ?? 'http://localhost:11434';
    const model = (this.store.get('ai.ollamaModel') as string) ?? 'llama3';
    const temperature = (this.store.get('ai.temperature') as number) ?? 0.3;

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        options: { temperature },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status} ${res.statusText}`);

    // Ollama streams NDJSON — one JSON object per line
    const chunks: string[] = [];
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Ollama response has no body');

    const decoder = new TextDecoder();
    let buffer = '';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.error) throw new Error(`Ollama: ${json.error}`);
          if (json.message?.content) chunks.push(json.message.content);
        } catch (e) {
          if (e instanceof SyntaxError) continue; // skip malformed lines
          throw e;
        }
      }
    }
    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer);
        if (json.error) throw new Error(`Ollama: ${json.error}`);
        if (json.message?.content) chunks.push(json.message.content);
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
    }

    return chunks.join('').trim() || text;
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
    const provider = (this.store.get('ai.provider') as string) ?? 'none';
    if (provider === 'none') throw new Error('No AI provider configured.');
    if (!systemPrompt) throw new Error('System prompt is empty.');

    const language = (this.store.get('transcription.language') as string) ?? 'en';
    const languageNames: Record<string, string> = { en: 'English', pl: 'Polish' };
    const languageName = languageNames[language] ?? 'English';
    const fullPrompt = `${systemPrompt} Always respond in ${languageName}.`;

    switch (provider) {
      case 'openai':
        return this.processOpenAI(text, fullPrompt);
      case 'anthropic':
        return this.processAnthropic(text, fullPrompt);
      case 'ollama':
        return this.processOllama(text, fullPrompt);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
