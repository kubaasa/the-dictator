import { useState, useEffect, useCallback, useRef } from 'react';
import log from 'electron-log/renderer';
import type { ModelStatus } from '../hooks/useModelStatus';
import type { AIProviderType, TranscriptionEngine, AppSettings, SavedPrompt } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { WHISPER_MODEL_DESCRIPTIONS, OPENAI_MODELS, ANTHROPIC_MODELS } from '../../shared/constants';
import { ApiKeyInput } from './ApiKeyInput';
import { useToast } from './Toast';
import { Segmented } from './ui/Segmented';
import { Switch } from './ui/Switch';
import { StepCard } from './ui/StepCard';
import { FieldRow } from './ui/FieldRow';

const MODEL_OPTIONS = [
  { value: 'tiny', label: 'Tiny', size: '75 MB' },
  { value: 'base', label: 'Base', size: '150 MB' },
  { value: 'small', label: 'Small', size: '470 MB' },
  { value: 'medium', label: 'Medium', size: '1.5 GB' },
  { value: 'large-v3', label: 'Large', size: '3.1 GB' },
];

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'pl', label: 'Polish' },
];

const AI_PROVIDER_OPTIONS: { value: AIProviderType; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];

const MAX_PROMPT_NAME_LENGTH = 40;
const MAX_PROMPT_NAME_WORDS = 6;

// A real name is a few words on one line; anything longer is the model talking back instead of naming
function sanitizePromptName(raw: string): string {
  const firstLine = raw.split('\n')[0]
    .replace(/^["'`\s]+|["'`\s.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!firstLine) return '';
  if (firstLine.length > MAX_PROMPT_NAME_LENGTH || firstLine.split(' ').length > MAX_PROMPT_NAME_WORDS) return '';
  return firstLine;
}

function EnhancingDots() {
  return (
    <span className="inline-flex items-center">
      Enhancing
      <span className="inline-flex w-[1.2em] ml-[1px]">
        <span className="animate-[dotFade_1.4s_ease-in-out_infinite]">.</span>
        <span className="animate-[dotFade_1.4s_ease-in-out_0.2s_infinite]">.</span>
        <span className="animate-[dotFade_1.4s_ease-in-out_0.4s_infinite]">.</span>
      </span>
    </span>
  );
}

export function ModesPage(props: ModelStatus) {
  const { downloadedModels, downloading, progress, error, download, cancel, recheck } = props;
  const { addToast } = useToast();

  const [engine, setEngine] = useState<TranscriptionEngine>('cloud');
  const [modelSize, setModelSize] = useState('base');
  const [language, setLanguage] = useState('en');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [groqValidation, setGroqValidation] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [groqValidationError, setGroqValidationError] = useState('');
  const [autoPaste, setAutoPaste] = useState(DEFAULT_SETTINGS.dictation.autoPaste);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [aiPostProcessing, setAiPostProcessing] = useState(DEFAULT_SETTINGS.dictation.aiPostProcessing);
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_SETTINGS.dictation.customPrompt);
  const [aiProvider, setAiProvider] = useState<AIProviderType>('openai');
  const [aiOpenaiKey, setAiOpenaiKey] = useState('');
  const [aiOpenaiModel, setAiOpenaiModel] = useState('gpt-4.1-nano');
  const [openaiModels, setOpenaiModels] = useState(OPENAI_MODELS);
  const [aiAnthropicKey, setAiAnthropicKey] = useState('');
  const [aiAnthropicModel, setAiAnthropicModel] = useState('claude-haiku-4-5-20251001');
  const [openaiKeySaved, setOpenaiKeySaved] = useState(false);
  const [anthropicKeySaved, setAnthropicKeySaved] = useState(false);
  const [aiKeyValidation, setAiKeyValidation] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [aiKeyValidationError, setAiKeyValidationError] = useState('');
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>('default');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const savingRef = useRef(false);
  const [isCreatingNewPrompt, setIsCreatingNewPrompt] = useState(false);
  const [lastLoadedPrompt, setLastLoadedPrompt] = useState(DEFAULT_SETTINGS.dictation.customPrompt);
  const [promptDropdownOpen, setPromptDropdownOpen] = useState(false);
  const promptDropdownRef = useRef<HTMLDivElement>(null);
  const skipBlurSaveRef = useRef(false);

  const fetchOpenAIModels = useCallback(async () => {
    try {
      const res = await window.dictator.ai.getOpenAIModels();
      if (res.success && res.models.length > 0) setOpenaiModels(res.models);
    } catch (err) {
      log.error('Failed to fetch OpenAI models:', err);
    }
  }, []);

  const syncFromSettings = useCallback((s: AppSettings) => {
    setEngine(s.transcription.engine);
    setModelSize(s.transcription.localModelSize);
    setLanguage(s.transcription.language);
    setGroqApiKey(s.transcription.groqApiKey);
    setGroqValidation(s.transcription.groqApiKey ? 'valid' : 'idle');
    setAiPostProcessing(s.dictation.aiPostProcessing);
    setAutoPaste(s.dictation.autoPaste);
    setCustomPrompt(s.dictation.customPrompt);
    setSavedPrompts(s.dictation.savedPrompts ?? []);
    setSelectedPromptId(s.dictation.selectedPromptId ?? 'default');
    setAiProvider(s.ai.provider);
    setAiOpenaiKey(s.ai.openaiApiKey);
    setAiOpenaiModel(s.ai.openaiModel);
    setOpenaiKeySaved(!!s.ai.openaiApiKey);
    setAiAnthropicKey(s.ai.anthropicApiKey);
    setAiAnthropicModel(s.ai.anthropicModel);
    setAnthropicKeySaved(!!s.ai.anthropicApiKey);
    const activeKey = s.ai.provider === 'openai' ? s.ai.openaiApiKey : s.ai.anthropicApiKey;
    setAiKeyValidation(activeKey ? 'valid' : 'idle');
    setAiKeyValidationError('');
  }, []);

  useEffect(() => {
    window.dictator.getSettings().then((s) => {
      syncFromSettings(s);
      const id = s.dictation.selectedPromptId ?? 'default';
      const loaded = id === 'default'
        ? DEFAULT_SETTINGS.dictation.customPrompt
        : (s.dictation.savedPrompts ?? []).find(p => p.id === id)?.content ?? DEFAULT_SETTINGS.dictation.customPrompt;
      setLastLoadedPrompt(loaded);
      if (s.ai.provider === 'openai' && s.ai.openaiApiKey) fetchOpenAIModels();
      setSettingsLoaded(true);
    }).catch((err) => {
      log.error('Failed to load settings in ModesPage:', err);
      setSettingsLoaded(true);
    });

    const unsub = window.dictator.onSettingsChange(syncFromSettings);
    return unsub;
  }, [syncFromSettings, fetchOpenAIModels]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (promptDropdownRef.current && !promptDropdownRef.current.contains(e.target as Node)) {
        setPromptDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLanguageChange = async (newLang: string) => {
    setLanguage(newLang);
    try {
      const current = await window.dictator.getSettings();
      const patch: Partial<AppSettings['transcription']> = { language: newLang };
      if (current.transcription.engine === 'cloud') {
        patch.preferredCloudLanguage = newLang;
      }
      await window.dictator.setSettings({
        transcription: { ...current.transcription, ...patch },
      });
    } catch (err) {
      log.error('[ModesPage] Failed to save language:', err);
    }
  };

  const handleModelChange = async (newSize: string) => {
    setModelSize(newSize);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        transcription: { ...current.transcription, localModelSize: newSize },
      });
      if (!downloading) recheck();
    } catch (err) {
      log.error('[ModesPage] Failed to save model:', err);
    }
  };

  const handleEngineChange = async (newEngine: TranscriptionEngine) => {
    setEngine(newEngine);
    try {
      const current = await window.dictator.getSettings();
      const patch: Partial<AppSettings['transcription']> = { engine: newEngine };
      await window.dictator.setSettings({
        transcription: { ...current.transcription, ...patch },
      });
    } catch (err) {
      log.error('[ModesPage] Failed to save engine:', err);
    }
  };

  const handleGroqKeyChange = (value: string) => {
    setGroqApiKey(value);
    if (groqValidation === 'valid' || groqValidation === 'invalid') {
      setGroqValidation('idle');
      setGroqValidationError('');
    }
  };

  const handleGroqKeyVerify = async () => {
    const key = groqApiKey.trim();
    if (!key) return;
    setGroqValidation('validating');
    setGroqValidationError('');
    try {
      const result = await window.dictator.groq.validateKey(key);
      if (result.valid) {
        setGroqValidation('valid');
        const current = await window.dictator.getSettings();
        await window.dictator.setSettings({
          transcription: { ...current.transcription, groqApiKey: key },
        });
        addToast('success', 'Groq API key verified and saved');
      } else {
        setGroqValidation('invalid');
        setGroqValidationError(result.error ?? 'Invalid API key');
        setGroqApiKey('');
      }
    } catch {
      setGroqValidation('invalid');
      setGroqValidationError('Validation failed. Check your internet connection.');
      setGroqApiKey('');
    }
  };

  const handleGroqKeyDelete = async () => {
    try {
      setGroqApiKey('');
      setGroqValidation('idle');
      setGroqValidationError('');
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        transcription: { ...current.transcription, groqApiKey: '' },
      });
      addToast('success', 'Groq API key removed');
    } catch (err) {
      log.error('[ModesPage] Failed to delete Groq key:', err);
    }
  };

  const handleToggleAi = async () => {
    const next = !aiPostProcessing;
    setAiPostProcessing(next);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: { ...current.dictation, aiPostProcessing: next },
      });
    } catch (err) {
      log.error('[ModesPage] Failed to toggle AI:', err);
    }
  };

  const handleToggleAutoPaste = async () => {
    const next = !autoPaste;
    setAutoPaste(next);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: { ...current.dictation, autoPaste: next },
      });
    } catch (err) {
      log.error('[ModesPage] Failed to toggle auto-paste:', err);
    }
  };

  const handlePromptSave = async () => {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false;
      return;
    }
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: { ...current.dictation, customPrompt, selectedPromptId },
      });
    } catch (err) {
      log.error('[ModesPage] Failed to save prompt:', err);
    }
  };

  const [enhancing, setEnhancing] = useState(false);

  const handlePromptEnhance = async () => {
    if (!customPrompt.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const res = await window.dictator.ai.enhancePrompt(customPrompt);
      if (res.success && res.result) {
        setCustomPrompt(res.result);
        const current = await window.dictator.getSettings();
        await window.dictator.setSettings({
          dictation: { ...current.dictation, customPrompt: res.result },
        });
        addToast('success', 'Prompt enhanced successfully');
      } else {
        addToast('error', res.error ?? 'Failed to enhance prompt');
      }
    } catch (err) {
      log.error('[ModesPage] Failed to enhance prompt:', err);
      addToast('error', 'Failed to enhance prompt');
    } finally {
      setEnhancing(false);
    }
  };

  const handlePromptReset = async () => {
    skipBlurSaveRef.current = true;
    setCustomPrompt(lastLoadedPrompt);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: { ...current.dictation, customPrompt: lastLoadedPrompt },
      });
    } catch (err) {
      log.error('[ModesPage] Failed to reset prompt:', err);
    }
  };

  const handleSelectPrompt = async (id: string) => {
    skipBlurSaveRef.current = true;
    setSelectedPromptId(id);
    setIsCreatingNewPrompt(false);
    const content = id === 'default'
      ? DEFAULT_SETTINGS.dictation.customPrompt
      : savedPrompts.find(p => p.id === id)?.content ?? DEFAULT_SETTINGS.dictation.customPrompt;
    setCustomPrompt(content);
    setLastLoadedPrompt(content);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: { ...current.dictation, customPrompt: content, selectedPromptId: id },
      });
    } catch (err) {
      log.error('[ModesPage] Failed to load prompt:', err);
    }
  };

  const handleNewPrompt = () => {
    if (savingPrompt || enhancing) return;
    skipBlurSaveRef.current = true;
    const tempId = `new-${Date.now()}`;
    setIsCreatingNewPrompt(true);
    setSelectedPromptId(tempId);
    setCustomPrompt('');
    setLastLoadedPrompt('');
  };

  const handleSavePrompt = async () => {
    if (savingRef.current || savedPrompts.length >= 5 || !isAiConfigured || !customPrompt.trim()) return;
    savingRef.current = true;
    setSavingPrompt(true);
    try {
      const res = await window.dictator.ai.generatePromptName(customPrompt);
      const generatedName = res.success && res.name ? sanitizePromptName(res.name) : '';
      const name = generatedName || `Prompt ${savedPrompts.length + 1}`;
      if (!generatedName) addToast('info', 'Could not generate name, using fallback');
      const newPrompt: SavedPrompt = {
        id: crypto.randomUUID(),
        name,
        content: customPrompt,
      };
      const updated = [...savedPrompts, newPrompt];
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: { ...current.dictation, savedPrompts: updated, customPrompt: customPrompt, selectedPromptId: newPrompt.id },
      });
      setSavedPrompts(updated);
      setSelectedPromptId(newPrompt.id);
      setLastLoadedPrompt(customPrompt);
      setIsCreatingNewPrompt(false);
      addToast('success', `Prompt saved as "${name}"`);
    } catch (err) {
      log.error('[ModesPage] Failed to save prompt:', err);
      addToast('error', 'Failed to save prompt');
    } finally {
      savingRef.current = false;
      setSavingPrompt(false);
    }
  };

  const handleDeletePrompt = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = savedPrompts.filter(p => p.id !== id);
    const isSelected = selectedPromptId === id;
    if (isSelected) skipBlurSaveRef.current = true;
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: {
          ...current.dictation,
          savedPrompts: updated,
          ...(isSelected && {
            selectedPromptId: 'default',
            customPrompt: DEFAULT_SETTINGS.dictation.customPrompt,
          }),
        },
      });
      setSavedPrompts(updated);
      if (isSelected) {
        setIsCreatingNewPrompt(false);
        setSelectedPromptId('default');
        setCustomPrompt(DEFAULT_SETTINGS.dictation.customPrompt);
        setLastLoadedPrompt(DEFAULT_SETTINGS.dictation.customPrompt);
      }
    } catch (err) {
      log.error('[ModesPage] Failed to delete prompt:', err);
    }
  };

  const handleProviderChange = async (provider: AIProviderType) => {
    setAiProvider(provider);
    const activeKey = provider === 'openai' ? aiOpenaiKey : aiAnthropicKey;
    const isSaved = provider === 'openai' ? openaiKeySaved : anthropicKeySaved;
    setAiKeyValidation(isSaved && activeKey ? 'valid' : 'idle');
    setAiKeyValidationError('');
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        ai: { ...current.ai, provider },
      });
    } catch (err) {
      log.error('[ModesPage] Failed to save provider:', err);
    }
  };

  const handleAiModelChange = async (model: string) => {
    try {
      const current = await window.dictator.getSettings();
      if (aiProvider === 'openai') {
        setAiOpenaiModel(model);
        await window.dictator.setSettings({ ai: { ...current.ai, openaiModel: model } });
      } else if (aiProvider === 'anthropic') {
        setAiAnthropicModel(model);
        await window.dictator.setSettings({ ai: { ...current.ai, anthropicModel: model } });
      }
    } catch (err) {
      log.error('[ModesPage] Failed to save AI model:', err);
    }
  };

  const handleAiKeySave = async () => {
    const key = aiProvider === 'openai' ? aiOpenaiKey.trim() : aiAnthropicKey.trim();
    if (!key) return;
    setAiKeyValidation('validating');
    setAiKeyValidationError('');
    try {
      const result = await window.dictator.ai.validateKey(aiProvider, key);
      if (result.valid) {
        setAiKeyValidation('valid');
        const current = await window.dictator.getSettings();
        const updates: Record<string, unknown> = {};
        if (aiProvider === 'openai') {
          updates.openaiApiKey = key;
          updates.openaiModel = aiOpenaiModel;
        } else {
          updates.anthropicApiKey = key;
          updates.anthropicModel = aiAnthropicModel;
        }
        await window.dictator.setSettings({
          ai: { ...current.ai, ...updates },
        });
        if (aiProvider === 'openai') {
          fetchOpenAIModels();
          setOpenaiKeySaved(true);
        } else {
          setAnthropicKeySaved(true);
        }
        addToast('success', `${aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'} API key verified and saved`);
      } else {
        setAiKeyValidation('invalid');
        setAiKeyValidationError(result.error ?? 'Invalid API key');
        if (aiProvider === 'openai') setAiOpenaiKey('');
        else setAiAnthropicKey('');
      }
    } catch {
      setAiKeyValidation('invalid');
      setAiKeyValidationError('Validation failed. Check your internet connection.');
      if (aiProvider === 'openai') setAiOpenaiKey('');
      else setAiAnthropicKey('');
    }
  };

  const handleAiKeyDelete = async () => {
    try {
      const current = await window.dictator.getSettings();
      if (aiProvider === 'openai') {
        setAiOpenaiKey('');
        setOpenaiKeySaved(false);
        await window.dictator.setSettings({
          ai: { ...current.ai, openaiApiKey: '' },
        });
      } else if (aiProvider === 'anthropic') {
        setAiAnthropicKey('');
        setAnthropicKeySaved(false);
        await window.dictator.setSettings({
          ai: { ...current.ai, anthropicApiKey: '' },
        });
      }
      setAiKeyValidation('idle');
      setAiKeyValidationError('');
      addToast('success', 'API key removed');
    } catch (err) {
      log.error('[ModesPage] Failed to delete AI key:', err);
    }
  };

  const isAiConfigured =
    aiProvider === 'openai' ? !!aiOpenaiKey :
    aiProvider === 'anthropic' ? !!aiAnthropicKey :
    false;

  const isPromptModified = !isCreatingNewPrompt && customPrompt !== lastLoadedPrompt;

  const canSavePrompt = isAiConfigured && savedPrompts.length < 5 &&
    !!customPrompt.trim() &&
    customPrompt !== DEFAULT_SETTINGS.dictation.customPrompt &&
    !savedPrompts.some(p => p.content === customPrompt);

  const currentAiModels = aiProvider === 'openai' ? openaiModels : aiProvider === 'anthropic' ? ANTHROPIC_MODELS : [];
  const currentAiModel = aiProvider === 'openai' ? aiOpenaiModel : aiProvider === 'anthropic' ? aiAnthropicModel : '';

  if (!settingsLoaded) return null;

  const selectedWhisper = MODEL_OPTIONS.find((o) => o.value === modelSize);
  const whisperReady = downloadedModels.includes(modelSize);
  const activeAiKey = aiProvider === 'openai' ? aiOpenaiKey : aiAnthropicKey;
  const activeAiKeySaved = aiProvider === 'openai' ? openaiKeySaved : anthropicKeySaved;
  const promptLabel = isCreatingNewPrompt
    ? 'New Prompt...'
    : selectedPromptId === 'default'
      ? 'Voice to Text (Default)'
      : savedPrompts.find((p) => p.id === selectedPromptId)?.name ?? 'Voice to Text (Default)';

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex max-w-[860px] flex-col gap-6">

        <StepCard number={1} title="Transcribe">
          <FieldRow label="Engine">
            <Segmented
              ariaLabel="Transcription engine"
              value={engine}
              onChange={handleEngineChange}
              options={[{ value: 'local', label: 'Local' }, { value: 'cloud', label: 'Cloud' }]}
            />
          </FieldRow>

          {engine === 'cloud' && (
            <FieldRow label="Groq API key" align="start">
              <div className="flex w-full min-w-0 flex-col gap-2">
                <ApiKeyInput
                  value={groqApiKey}
                  onChange={handleGroqKeyChange}
                  onSave={handleGroqKeyVerify}
                  onDelete={handleGroqKeyDelete}
                  saved={groqValidation === 'valid'}
                  invalid={groqValidation === 'invalid'}
                  buttonLabel={groqValidation === 'validating' ? 'Verifying...' : 'Verify'}
                  buttonDisabled={groqValidation === 'validating' || !groqApiKey.trim()}
                />
                {groqValidation === 'invalid' && <KeyError message={groqValidationError} />}
              </div>
            </FieldRow>
          )}

          {engine === 'local' && (
            <FieldRow label="Whisper model" align="start">
              <div className="flex w-full flex-col items-start gap-2">
                <Segmented
                  ariaLabel="Whisper model"
                  value={modelSize}
                  onChange={handleModelChange}
                  options={MODEL_OPTIONS.map((o) => ({ value: o.value, label: o.label, disabled: downloading && o.value !== modelSize }))}
                />
                <div className="flex min-h-[30px] w-full items-center gap-3 text-xs text-text-muted">
                  <span className="font-mono text-text">{selectedWhisper?.size}</span>
                  <span>{WHISPER_MODEL_DESCRIPTIONS[modelSize]}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {whisperReady ? (
                      <span className="flex items-center gap-1 text-ok">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                        Downloaded
                      </span>
                    ) : downloading ? (
                      <button onClick={cancel} className="text-[11px] font-medium text-text-muted transition-colors hover:text-text">Cancel</button>
                    ) : (
                      <button
                        onClick={download}
                        className="rounded-lg border border-border-strong bg-surface-hover px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-text-dim"
                      >
                        Download
                      </button>
                    )}
                  </span>
                </div>
                {downloading && (
                  <div className="flex w-full items-center gap-3">
                    <div className={`h-1 flex-1 overflow-hidden rounded-full ${progress === 0 ? 'animate-pulse bg-accent/30' : 'bg-border-strong'}`}>
                      {progress > 0 && <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} />}
                    </div>
                    <span className="font-mono text-[10px] text-text-muted">{progress > 0 ? `${progress}%` : 'Preparing...'}</span>
                  </div>
                )}
                {error && (
                  <p role="alert" className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-strong">
                    {error}
                  </p>
                )}
              </div>
            </FieldRow>
          )}

          <FieldRow label="Language">
            <Segmented
              ariaLabel="Language"
              value={language}
              onChange={handleLanguageChange}
              options={LANGUAGE_OPTIONS}
            />
          </FieldRow>
        </StepCard>

        <StepCard
          number={2}
          title="Enhance with AI"
          control={(
            <span className="flex items-center gap-2 text-xs text-text-muted">
              {aiPostProcessing ? 'On' : 'Off'}
              <Switch checked={aiPostProcessing} onChange={handleToggleAi} ariaLabel="Process with AI" />
            </span>
          )}
        >
          {aiPostProcessing && (
            <>
              <FieldRow label="Provider">
                <Segmented ariaLabel="AI provider" value={aiProvider} onChange={handleProviderChange} options={AI_PROVIDER_OPTIONS} />
              </FieldRow>

              <FieldRow label="Model">
                <Segmented ariaLabel="AI model" value={currentAiModel} onChange={handleAiModelChange} options={currentAiModels} />
              </FieldRow>

              <FieldRow label="API key" align="start">
                <div className="flex w-full min-w-0 flex-col gap-2">
                  <ApiKeyInput
                    value={activeAiKey}
                    onChange={(v) => {
                      if (aiProvider === 'openai') setAiOpenaiKey(v);
                      else setAiAnthropicKey(v);
                      if (aiKeyValidation === 'valid' || aiKeyValidation === 'invalid') {
                        setAiKeyValidation('idle');
                        setAiKeyValidationError('');
                      }
                    }}
                    onSave={handleAiKeySave}
                    onDelete={handleAiKeyDelete}
                    saved={activeAiKeySaved}
                    invalid={aiKeyValidation === 'invalid'}
                    buttonLabel={aiKeyValidation === 'validating' ? 'Verifying...' : 'Verify'}
                    buttonDisabled={aiKeyValidation === 'validating' || !activeAiKey.trim()}
                  />
                  {aiKeyValidation === 'invalid' && <KeyError message={aiKeyValidationError} />}
                </div>
              </FieldRow>

              <FieldRow label="System prompt" align="start">
                <div className="flex w-full flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="relative min-w-0 flex-1" ref={promptDropdownRef}>
                      <button
                        onClick={() => setPromptDropdownOpen(!promptDropdownOpen)}
                        aria-haspopup="listbox"
                        aria-expanded={promptDropdownOpen}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-1.5 text-xs text-text transition-colors hover:border-border-strong"
                      >
                        <span className="truncate">{promptLabel}</span>
                        <svg className={`h-3.5 w-3.5 text-text-muted transition-transform ${promptDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                        </svg>
                      </button>
                      {promptDropdownOpen && (
                        <div role="listbox" aria-label="Saved prompts" className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border bg-surface pb-1 shadow-lg">
                          <div className="h-[2px] bg-accent/35" aria-hidden="true" />
                          <button
                            role="option"
                            aria-selected={selectedPromptId === 'default'}
                            onClick={() => { handleSelectPrompt('default'); setPromptDropdownOpen(false); }}
                            className={`w-full px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-hover ${
                              selectedPromptId === 'default' ? 'font-medium text-text' : 'text-text-muted hover:text-text'
                            }`}
                          >
                            Voice to Text (Default)
                          </button>
                          {savedPrompts.map((p) => (
                            <div
                              key={p.id}
                              className={`flex items-center justify-between px-3 py-2 transition-colors hover:bg-surface-hover ${
                                selectedPromptId === p.id ? 'font-medium text-text' : 'text-text-muted'
                              }`}
                            >
                              <button
                                role="option"
                                aria-selected={selectedPromptId === p.id}
                                onClick={() => { handleSelectPrompt(p.id); setPromptDropdownOpen(false); }}
                                className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-text"
                              >
                                {p.name}
                              </button>
                              <button
                                onClick={(e) => handleDeletePrompt(e, p.id)}
                                aria-label={`Delete prompt ${p.name}`}
                                className="ml-3 text-text-dim transition-colors hover:text-accent-strong"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                          {isCreatingNewPrompt && (
                            <div className="px-3 py-2 text-[13px] font-medium text-text">New Prompt...</div>
                          )}
                        </div>
                      )}
                    </div>
                    {isPromptModified && <Chip tone="warn">Modified</Chip>}
                    <ActionButton onClick={handlePromptEnhance} disabled={!customPrompt.trim() || enhancing || !isAiConfigured} primary busy={enhancing}>
                      {enhancing ? <EnhancingDots /> : 'Enhance prompt'}
                    </ActionButton>
                    <ActionButton onClick={handleSavePrompt} disabled={!canSavePrompt || savingPrompt}>
                      {savingPrompt ? 'Saving...' : savedPrompts.length >= 5 ? 'Limit reached' : 'Save'}
                    </ActionButton>
                    <ActionButton onClick={handleNewPrompt} disabled={isCreatingNewPrompt || savedPrompts.length >= 5 || savingPrompt || enhancing}>
                      New
                    </ActionButton>
                    <ActionButton onClick={handlePromptReset} disabled={!isPromptModified}>
                      Reset
                    </ActionButton>
                  </div>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    onBlur={savingPrompt || enhancing ? undefined : handlePromptSave}
                    placeholder={isCreatingNewPrompt ? 'Write your instruction, then click Enhance prompt to refine it with AI.' : 'Enter system prompt...'}
                    maxLength={4000}
                    rows={5}
                    aria-label="System prompt"
                    className="w-full resize-none rounded-lg border border-border bg-surface-sunken px-3 py-2.5 text-[13px] leading-relaxed text-text placeholder-text-dim focus:border-border-strong focus:outline-none"
                  />
                </div>
              </FieldRow>
            </>
          )}
        </StepCard>

        <StepCard
          number={3}
          title="Paste"
          last
          description="The result is typed into the app you were in when you pressed the shortcut. The text is also copied to the clipboard."
          control={(
            <span className="flex items-center gap-2 text-xs text-text-muted">
              Auto-paste
              <Switch checked={autoPaste} onChange={handleToggleAutoPaste} ariaLabel="Auto-paste" />
            </span>
          )}
        />

      </div>
    </main>
  );
}

function Chip({ tone, children }: { tone: 'ok' | 'warn'; children: React.ReactNode }) {
  const cls = tone === 'ok'
    ? 'border-ok/20 bg-ok/10 text-ok-text'
    : 'border-warn/20 bg-warn/10 text-warn-text';
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}

function KeyError({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-center gap-1.5 text-xs text-accent-strong">
      <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
      {message}
    </p>
  );
}

function ActionButton({ onClick, disabled, primary = false, busy = false, children }: {
  onClick: () => void;
  disabled: boolean;
  primary?: boolean;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        busy ? 'cursor-wait' : 'disabled:cursor-not-allowed'
      } disabled:opacity-40 ${
        primary
          ? 'border-border-strong bg-surface-hover text-text hover:border-text-dim'
          : 'border-border text-text-muted hover:border-border-strong hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}
