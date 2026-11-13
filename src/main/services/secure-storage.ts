import { safeStorage } from 'electron';
import Store from 'electron-store';
import type { ApiKeyProvider, ApiKeyStatus, AppSettings, RendererSettings, SettingsPatch } from '../../shared/types';
import logger from './logger';

const log = logger.scope('SecureStorage');

const ENCRYPTED_PREFIX = 'enc:';
const KEY_HINT_LENGTH = 4;

const API_KEY_PATHS = {
  groq: 'transcription.groqApiKey',
  openai: 'ai.openaiApiKey',
  anthropic: 'ai.anthropicApiKey',
} as const;

type ApiKeyPath = typeof API_KEY_PATHS[ApiKeyProvider];

const statusByStoredValue = new Map<string, ApiKeyStatus>();

function encryptValue(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return value;
  const encrypted = safeStorage.encryptString(value);
  return ENCRYPTED_PREFIX + encrypted.toString('base64');
}

function decryptValue(value: string): string {
  if (!value || !value.startsWith(ENCRYPTED_PREFIX)) return value;
  if (!safeStorage.isEncryptionAvailable()) return '';
  try {
    const buffer = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
    return safeStorage.decryptString(buffer);
  } catch {
    // Corrupted encrypted value — return empty so user re-enters the key
    return '';
  }
}

function apiKeyStatus(stored: string | undefined): ApiKeyStatus {
  if (!stored) return { set: false, hint: '', length: 0 };
  const cached = statusByStoredValue.get(stored);
  if (cached) return cached;
  const key = decryptValue(stored);
  const status: ApiKeyStatus = {
    set: key.length > 0,
    hint: key.length > KEY_HINT_LENGTH ? key.slice(0, KEY_HINT_LENGTH) : '',
    length: key.length,
  };
  statusByStoredValue.set(stored, status);
  return status;
}

// Call once after app.ready (safeStorage requires the app to be ready)
export function migrateApiKeys(store: Store<AppSettings>): void {
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('safeStorage not available — API keys will remain in plain text');
    return;
  }

  for (const keyPath of Object.values(API_KEY_PATHS)) {
    const value = store.get(keyPath) as string;
    if (value && !value.startsWith(ENCRYPTED_PREFIX)) {
      store.set(keyPath, encryptValue(value));
    }
  }
}

export function getApiKey(store: Store<AppSettings>, keyPath: ApiKeyPath): string {
  const value = (store.get(keyPath) as string) ?? '';
  return decryptValue(value);
}

export function setApiKey(store: Store<AppSettings>, provider: ApiKeyProvider, key: string): void {
  store.set(API_KEY_PATHS[provider], encryptValue(key));
}

export function deleteApiKey(store: Store<AppSettings>, provider: ApiKeyProvider): void {
  store.set(API_KEY_PATHS[provider], '');
}

export function stripApiKeyFields(patch: SettingsPatch): void {
  const sections = patch as Record<string, unknown>;
  for (const keyPath of Object.values(API_KEY_PATHS)) {
    const [section, field] = keyPath.split('.');
    const value = sections[section];
    if (typeof value === 'object' && value !== null) {
      delete (value as Record<string, unknown>)[field];
    }
  }
}

export function toRendererSettings(raw: AppSettings): RendererSettings {
  const { groqApiKey, ...transcription } = raw.transcription;
  const { openaiApiKey, anthropicApiKey, ...ai } = raw.ai;
  return {
    ...raw,
    transcription,
    ai,
    apiKeys: {
      groq: apiKeyStatus(groqApiKey),
      openai: apiKeyStatus(openaiApiKey),
      anthropic: apiKeyStatus(anthropicApiKey),
    },
  };
}
