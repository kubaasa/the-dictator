import { safeStorage } from 'electron';
import Store from 'electron-store';
import type { AppSettings } from '../../shared/types';
import logger from './logger';

const log = logger.scope('SecureStorage');

const ENCRYPTED_PREFIX = 'enc:';

const API_KEY_PATHS = [
  'transcription.groqApiKey',
  'ai.openaiApiKey',
  'ai.anthropicApiKey',
] as const;

type ApiKeyPath = typeof API_KEY_PATHS[number];

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

// Call once after app.ready (safeStorage requires the app to be ready)
export function migrateApiKeys(store: Store<AppSettings>): void {
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('safeStorage not available — API keys will remain in plain text');
    return;
  }

  for (const keyPath of API_KEY_PATHS) {
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

export function encryptSettingsKeys(settings: Partial<AppSettings>): void {
  if (!safeStorage.isEncryptionAvailable()) return;

  if (settings.transcription && 'groqApiKey' in settings.transcription) {
    const key = settings.transcription.groqApiKey;
    if (key && !key.startsWith(ENCRYPTED_PREFIX)) {
      settings.transcription = { ...settings.transcription, groqApiKey: encryptValue(key) };
    }
  }
  if (settings.ai) {
    const ai = { ...settings.ai };
    if ('openaiApiKey' in ai && ai.openaiApiKey && !ai.openaiApiKey.startsWith(ENCRYPTED_PREFIX)) {
      ai.openaiApiKey = encryptValue(ai.openaiApiKey);
    }
    if ('anthropicApiKey' in ai && ai.anthropicApiKey && !ai.anthropicApiKey.startsWith(ENCRYPTED_PREFIX)) {
      ai.anthropicApiKey = encryptValue(ai.anthropicApiKey);
    }
    settings.ai = ai;
  }
}

export function decryptSettingsForRenderer(raw: AppSettings): AppSettings {
  const settings = { ...raw };

  if (settings.transcription) {
    settings.transcription = { ...settings.transcription };
    if (settings.transcription.groqApiKey) {
      settings.transcription.groqApiKey = decryptValue(settings.transcription.groqApiKey);
    }
  }
  if (settings.ai) {
    settings.ai = { ...settings.ai };
    if (settings.ai.openaiApiKey) {
      settings.ai.openaiApiKey = decryptValue(settings.ai.openaiApiKey);
    }
    if (settings.ai.anthropicApiKey) {
      settings.ai.anthropicApiKey = decryptValue(settings.ai.anthropicApiKey);
    }
  }

  return settings;
}
