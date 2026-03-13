import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import Store from 'electron-store';
import type { AppSettings, DictationMode } from '../../shared/types';
import { DICTATION_MODE_PROMPTS } from '../../shared/constants';

export class AIService {
  private openaiClient: OpenAI | null = null;
  private openaiClientKey: string | null = null;
  private anthropicClient: Anthropic | null = null;
  private anthropicClientKey: string | null = null;

  constructor(private store: Store<AppSettings>) {}

  async process(rawText: string): Promise<string> {
    const mode = (this.store.get('dictation.currentMode') as DictationMode) ?? 'voice';
    const provider = (this.store.get('ai.provider') as string) ?? 'none';

    if (provider === 'none') return rawText;

    const modePrompts = this.store.get('dictation.modePrompts') as Record<string, string> | undefined;
    const basePrompt = modePrompts?.[mode] ?? DICTATION_MODE_PROMPTS[mode] ?? '';

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
    const model = (this.store.get('ai.openaiModel') as string) ?? 'gpt-4o-mini';
    const temperature = (this.store.get('ai.temperature') as number) ?? 0.3;

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature,
    });

    return response.choices[0]?.message?.content?.trim() ?? text;
  }

  private async processAnthropic(text: string, systemPrompt: string): Promise<string> {
    const client = this.getAnthropicClient();
    const model = (this.store.get('ai.anthropicModel') as string) ?? 'claude-sonnet-4-20250514';
    const temperature = (this.store.get('ai.temperature') as number) ?? 0.3;

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    });

    const block = response.content[0];
    return block?.type === 'text' ? block.text.trim() : text;
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
        stream: false,
        options: { temperature },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data.message?.content?.trim() ?? text;
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
