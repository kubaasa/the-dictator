import { useState, useEffect, useCallback, useRef } from 'react';
import log from 'electron-log/renderer';
import type { ModelStatus } from '../hooks/useModelStatus';
import type { AIProviderType, TranscriptionEngine, AppSettings, SavedPrompt, PasteMode } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { WHISPER_MODEL_DESCRIPTIONS, AI_MODEL_DESCRIPTIONS, OPENAI_MODELS, ANTHROPIC_MODELS } from '../../shared/constants';
import { ApiKeyInput } from './ApiKeyInput';
import { useToast } from './Toast';

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
  const { downloaded, downloadedModels, downloading, progress, error, download, cancel, recheck } = props;
  const { addToast } = useToast();

  const [engine, setEngine] = useState<TranscriptionEngine>('cloud');
  const [modelSize, setModelSize] = useState('base');
  const [language, setLanguage] = useState('en');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [groqValidation, setGroqValidation] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [groqValidationError, setGroqValidationError] = useState('');

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

  const [autoPaste, setAutoPaste] = useState(DEFAULT_SETTINGS.dictation.autoPaste);
  const [pasteMode, setPasteMode] = useState<PasteMode>(DEFAULT_SETTINGS.dictation.pasteMode);
  const [restoreClipboard, setRestoreClipboard] = useState(DEFAULT_SETTINGS.dictation.restoreClipboard);

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
    setCustomPrompt(s.dictation.customPrompt);
    setSavedPrompts(s.dictation.savedPrompts ?? []);
    setSelectedPromptId(s.dictation.selectedPromptId ?? 'default');
    setAutoPaste(s.dictation.autoPaste);
    setPasteMode(s.dictation.pasteMode ?? 'shortcut');
    setRestoreClipboard(s.dictation.restoreClipboard ?? false);
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
    }).catch((err) => log.error('Failed to load settings in ModesPage:', err));

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
      await window.dictator.setSettings({
        transcription: { ...current.transcription, language: newLang },
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
      await window.dictator.setSettings({
        transcription: { ...current.transcription, engine: newEngine },
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

  const handleToggleCompatibilityMode = async () => {
    const next: PasteMode = pasteMode === 'shortcut' ? 'type' : 'shortcut';
    setPasteMode(next);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: { ...current.dictation, pasteMode: next },
      });
    } catch (err) {
      log.error('[ModesPage] Failed to toggle paste mode:', err);
    }
  };

  // UI shows "keep transcription" which is the inverse of stored restoreClipboard.
  const handleToggleKeepTranscription = async () => {
    const next = !restoreClipboard;
    setRestoreClipboard(next);
    try {
      const current = await window.dictator.getSettings();
      await window.dictator.setSettings({
        dictation: { ...current.dictation, restoreClipboard: next },
      });
    } catch (err) {
      log.error('[ModesPage] Failed to toggle clipboard behavior:', err);
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
      const generatedName = res.success && res.name ? res.name.trim() : '';
      const name = generatedName || `Prompt ${savedPrompts.length + 1}`;
      if (!generatedName) addToast('info', 'Could not generate name — using fallback');
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

  const transcriptionSummary = engine === 'cloud' ? 'Cloud' : `Local (${modelSize.charAt(0).toUpperCase() + modelSize.slice(1)})`;
  const languageLabel = LANGUAGE_OPTIONS.find(o => o.value === language)?.value.toUpperCase() ?? 'EN';

  const aiModelLabel = aiProvider === 'openai'
    ? openaiModels.find(m => m.value === aiOpenaiModel)?.label ?? aiOpenaiModel
    : ANTHROPIC_MODELS.find(m => m.value === aiAnthropicModel)?.label ?? aiAnthropicModel;

  const providerLabel = aiProvider === 'openai' ? 'OpenAI' : 'Anthropic';
  const aiSummary = !aiPostProcessing
    ? 'OFF'
    : !isAiConfigured
      ? `${providerLabel} / No key`
      : `${providerLabel} / ${aiModelLabel}`;

  const transcriptionStatus: 'ready' | 'warning' | 'off' =
    engine === 'cloud' ? (groqApiKey ? 'ready' : 'warning') : (downloaded ? 'ready' : 'warning');
  const aiStatus: 'ready' | 'warning' | 'off' =
    !aiPostProcessing ? 'off' : isAiConfigured ? 'ready' : 'warning';
  const outputStatus: 'ready' | 'warning' | 'off' = 'ready';

  const statusColor = (s: 'ready' | 'warning' | 'off') =>
    s === 'ready' ? 'bg-green-600/60' : s === 'warning' ? 'bg-amber-600/60' : 'bg-neutral-700';

  return (
    <main className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex flex-col gap-8">

        <div className="rounded-xl border border-neutral-800 bg-[#0f0f0f] p-4">
          <div className="flex items-center">
            <div className="flex-1 flex flex-col items-center gap-1.5 px-3 py-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">Stage 01</span>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-400">Transcribe</span>
              <span className="text-xs text-neutral-500">{transcriptionSummary} ({languageLabel})</span>
              <div className={`mt-1 h-1 w-full rounded-full ${statusColor(transcriptionStatus)}`} />
            </div>

            <svg className="h-4 w-4 shrink-0 text-neutral-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>

            <div className="flex-1 flex flex-col items-center gap-1.5 px-3 py-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">Stage 02</span>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-400">AI Process</span>
              <span className="text-xs text-neutral-500">{aiSummary}</span>
              <div className={`mt-1 h-1 w-full rounded-full ${statusColor(aiStatus)}`} />
            </div>

            <svg className="h-4 w-4 shrink-0 text-neutral-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>

            <div className="flex-1 flex flex-col items-center gap-1.5 px-3 py-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">Stage 03</span>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-400">Output</span>
              <span className="text-xs text-neutral-500">{autoPaste ? 'Auto-paste' : 'Clipboard only'}</span>
              <div className={`mt-1 h-1 w-full rounded-full ${statusColor(outputStatus)}`} />
            </div>
          </div>
        </div>

        <section>
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
            Transcription
          </h2>
          <div className="rounded-xl border border-neutral-800 bg-[#141414] p-5 flex flex-col gap-5">

            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-2">
                Engine
              </span>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: 'local' as TranscriptionEngine, label: 'Local',
                    badges: [
                      { text: 'Private', icon: <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg> },
                      { text: 'Secure', icon: <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg> },
                      { text: 'English', icon: <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802" /></svg> },
                    ],
                    icon: <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h9a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 15.75 4.5h-9A2.25 2.25 0 0 0 4.5 6.75v10.5A2.25 2.25 0 0 0 6.75 19.5Z" /></svg> },
                  { value: 'cloud' as TranscriptionEngine, label: 'Cloud',
                    badges: [
                      { text: 'Fast', icon: <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" /></svg> },
                      { text: 'Free', icon: <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg> },
                      { text: 'Multilingual', icon: <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" /></svg> },
                    ],
                    icon: <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" /></svg> },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleEngineChange(opt.value)}
                    className={`rounded-lg border px-4 py-5 flex flex-col items-center justify-center gap-2 transition-all duration-200 cursor-pointer ${
                      engine === opt.value
                        ? 'border-red-600/50 bg-red-600/10'
                        : 'border-neutral-700 bg-neutral-800 hover:border-neutral-600'
                    }`}
                  >
                    <span className={engine === opt.value ? 'text-red-400' : 'text-neutral-500'}>
                      {opt.icon}
                    </span>
                    <span className={`font-mono text-xs font-semibold uppercase tracking-[0.15em] ${
                      engine === opt.value ? 'text-red-400' : 'text-neutral-400'
                    }`}>
                      {opt.label}
                    </span>
                    <div className="flex flex-wrap justify-center gap-1 mt-1">
                      {opt.badges.map((badge) => (
                        <span
                          key={badge.text}
                          className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider transition-colors ${
                            engine === opt.value
                              ? 'border-red-900/40 bg-red-950/30 text-red-400/80'
                              : 'border-neutral-700 bg-neutral-800/50 text-neutral-500'
                          }`}
                        >
                          {badge.icon}
                          {badge.text}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {engine === 'cloud' && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">
                    Groq API Key
                  </span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-orange-600/10 text-orange-400 border border-orange-600/20">
                    Whisper v3
                  </span>
                </div>
                <p className="text-xs text-neutral-600 mb-3">
                  Groq runs Whisper large-v3 on dedicated hardware — up to 10x faster than local inference.
                </p>
                <ApiKeyInput
                  value={groqApiKey}
                  onChange={handleGroqKeyChange}
                  onSave={handleGroqKeyVerify}
                  onDelete={handleGroqKeyDelete}
                  saved={groqValidation === 'valid'}
                  buttonLabel={
                    groqValidation === 'validating' ? 'Verifying...'
                    : 'Verify'
                  }
                  buttonDisabled={groqValidation === 'validating' || !groqApiKey.trim()}
                />
                {groqValidation === 'validating' && (
                  <p className="mt-2 font-mono text-xs text-neutral-500 animate-pulse">
                    Checking API key...
                  </p>
                )}
                {groqValidation === 'valid' && (
                  <p className="mt-2 flex items-center gap-1.5 font-mono text-xs text-green-500">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                    API key is valid — saved
                  </p>
                )}
                {groqValidation === 'invalid' && (
                  <p className="mt-2 flex items-center gap-1.5 font-mono text-xs text-red-400">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                    {groqValidationError}
                  </p>
                )}
              </div>
            )}

            {engine === 'local' && (
            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-2">
                Whisper Model
              </span>
              <div className="grid grid-cols-3 gap-2">
                {MODEL_OPTIONS.map((opt) => {
                  const isSelected = opt.value === modelSize;
                  const isReady = downloadedModels.includes(opt.value);
                  const isDownloading = downloading && isSelected;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleModelChange(opt.value)}
                      disabled={downloading && !isSelected}
                      className={`relative flex flex-col items-start rounded-lg border p-3 text-left transition-all duration-200 ${
                        isSelected
                          ? 'border-red-600/50 bg-red-600/5 cursor-pointer'
                          : downloading
                            ? 'border-neutral-800 bg-[#0f0f0f] opacity-50 cursor-not-allowed'
                            : 'border-neutral-800 bg-[#0f0f0f] hover:border-neutral-700 cursor-pointer'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className={`font-mono text-sm font-semibold ${isSelected ? 'text-red-400' : 'text-neutral-300'}`}>
                          {opt.label} <span className="text-neutral-600 font-normal">({opt.size})</span>
                        </span>
                        {isReady ? (
                          <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                        ) : (
                          <svg className="h-5 w-5 text-neutral-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
                          </svg>
                        )}
                      </div>
                      {isDownloading ? (
                        <div className="mt-1 w-full">
                          <div className={`h-1 w-full rounded-full overflow-hidden ${
                            progress === 0 ? 'bg-red-900/40 animate-pulse' : 'bg-neutral-700'
                          }`}>
                            {progress > 0 && (
                              <div
                                className="h-full rounded-full bg-red-600 transition-all duration-300"
                                style={{ width: `${progress}%` }}
                              />
                            )}
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <span className="font-mono text-[10px] text-neutral-500">
                              {progress > 0 ? `${progress}%` : 'Preparing...'}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); cancel(); }}
                              className="font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="mt-1 text-xs text-neutral-600 leading-tight">
                          {WHISPER_MODEL_DESCRIPTIONS[opt.value]}
                        </span>
                      )}
                    </button>
                  );
                })}

                {!downloaded && !downloading && (
                  <button
                    onClick={download}
                    className="flex items-center justify-center rounded-lg bg-red-600/20 border border-red-600/30 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-red-400 transition-colors hover:bg-red-600/30 cursor-pointer"
                  >
                    Download
                  </button>
                )}
              </div>

              {error && (
                <p role="alert" className="mt-2 rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
                  {error}
                </p>
              )}

            </div>
            )}

            <div>
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-2">
                Language
              </span>
              <div className="flex gap-2">
                {LANGUAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleLanguageChange(opt.value)}
                    className={`rounded-lg border px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.15em] transition-all duration-200 cursor-pointer ${
                      language === opt.value
                        ? 'border-red-600/50 bg-red-600/10 text-red-400'
                        : 'border-neutral-700 bg-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </section>

        <section>
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
            AI Processing
          </h2>

          <div className="rounded-xl border border-neutral-800 bg-[#141414] p-5 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-200">
                  Process with AI
                </span>
                <span className="text-xs text-neutral-500">
                  When enabled, transcribed text is processed through AI before pasting
                </span>
              </div>
              <button
                onClick={handleToggleAi}
                role="switch"
                aria-checked={aiPostProcessing}
                aria-label="Process with AI"
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  aiPostProcessing ? 'bg-red-600' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    aiPostProcessing ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {aiPostProcessing && aiKeyValidation !== 'valid' && (
              <div className="flex items-center gap-3 rounded-lg border border-green-800/40 bg-green-950/20 px-4 py-3">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-50" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-green-500">[IDLE]</span>
                </div>
                <span className="text-xs text-green-400/70">
                  Provider selected — enter your API key below and click Save to activate.
                </span>
              </div>
            )}

            {aiPostProcessing && (
              <>
                <div>
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-2">
                    Provider
                  </span>
                  <div className="flex gap-2">
                    {AI_PROVIDER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => handleProviderChange(opt.value)}
                        className={`rounded-lg border px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.15em] transition-all duration-200 cursor-pointer ${
                          aiProvider === opt.value
                            ? 'border-red-600/50 bg-red-600/10 text-red-400'
                            : 'border-neutral-700 bg-neutral-800 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {(aiProvider === 'openai' || aiProvider === 'anthropic') && (
                  <div>
                    <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600 block mb-2">
                      Model
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      {currentAiModels.map((opt) => {
                        const isSelected = opt.value === currentAiModel;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => handleAiModelChange(opt.value)}
                            className={`flex flex-col items-start rounded-lg border p-3 text-left transition-all duration-200 cursor-pointer ${
                              isSelected
                                ? 'border-red-600/50 bg-red-600/5'
                                : 'border-neutral-800 bg-[#0f0f0f] hover:border-neutral-700'
                            }`}
                          >
                            <span className={`font-mono text-sm font-semibold ${isSelected ? 'text-red-400' : 'text-neutral-300'}`}>
                              {opt.label}
                            </span>
                            <span className="mt-1 text-xs text-neutral-600 leading-tight">
                              {AI_MODEL_DESCRIPTIONS[opt.value] ?? ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(aiProvider === 'openai' || aiProvider === 'anthropic') && (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">
                        API Key
                      </span>
                      {aiProvider === 'openai' && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-emerald-600/10 text-emerald-400 border border-emerald-600/20">
                          GPT
                        </span>
                      )}
                      {aiProvider === 'anthropic' && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-amber-600/10 text-amber-400 border border-amber-600/20">
                          Claude
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-600 mb-3">
                      Used for AI text processing. Separate from transcription key.
                    </p>
                    <ApiKeyInput
                      value={aiProvider === 'openai' ? aiOpenaiKey : aiAnthropicKey}
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
                      saved={aiProvider === 'openai' ? openaiKeySaved : anthropicKeySaved}
                      buttonLabel={aiKeyValidation === 'validating' ? 'Verifying...' : 'Verify'}
                      buttonDisabled={aiKeyValidation === 'validating' || !(aiProvider === 'openai' ? aiOpenaiKey.trim() : aiAnthropicKey.trim())}
                    />
                    {aiKeyValidation === 'validating' && (
                      <p className="mt-2 font-mono text-xs text-neutral-500 animate-pulse">
                        Checking API key...
                      </p>
                    )}
                    {aiKeyValidation === 'valid' && (
                      <p className="mt-2 flex items-center gap-1.5 font-mono text-xs text-green-500">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                        API key is valid — saved
                      </p>
                    )}
                    {aiKeyValidation === 'invalid' && (
                      <p className="mt-2 flex items-center gap-1.5 font-mono text-xs text-red-400">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                        {aiKeyValidationError}
                      </p>
                    )}
                  </div>
                )}

                <div className="border-t border-neutral-800 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-600">
                        System Prompt
                      </span>
                      {isPromptModified && (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-amber-600/70">Modified</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-neutral-500 mb-3">
                    A set of instructions the AI uses to clean up, correct, and reformat your dictated text.
                  </p>

                  <div className="relative mb-3" ref={promptDropdownRef}>
                    <button
                      onClick={() => setPromptDropdownOpen(!promptDropdownOpen)}
                      className="w-full flex items-center justify-between rounded-lg border border-neutral-700/50 bg-neutral-900 px-4 py-2.5 font-mono text-xs text-neutral-300 focus:outline-none focus:border-red-600/30 cursor-pointer text-left"
                    >
                      <span>{
                        isCreatingNewPrompt ? 'New Prompt...' :
                        selectedPromptId === 'default' ? 'Voice to Text (Default)' :
                        savedPrompts.find(p => p.id === selectedPromptId)?.name ?? 'Voice to Text (Default)'
                      }</span>
                      <svg className={`h-4 w-4 text-neutral-500 transition-transform ${promptDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>
                    {promptDropdownOpen && (
                      <div className="absolute z-10 mt-1 w-full rounded-lg border border-neutral-700/50 bg-neutral-900 py-1 shadow-lg">
                        <button
                          onClick={() => { handleSelectPrompt('default'); setPromptDropdownOpen(false); }}
                          className={`w-full px-4 py-2 text-left font-mono text-xs transition-colors cursor-pointer ${
                            selectedPromptId === 'default' ? 'text-red-400 bg-red-950/20' : 'text-neutral-300 hover:bg-neutral-800'
                          }`}
                        >
                          Voice to Text (Default)
                        </button>
                        {savedPrompts.map((p) => (
                          <div
                            key={p.id}
                            className={`flex items-center justify-between px-4 py-2 transition-colors ${
                              selectedPromptId === p.id ? 'text-red-400 bg-red-950/20' : 'text-neutral-300 hover:bg-neutral-800'
                            }`}
                          >
                            <button
                              onClick={() => { handleSelectPrompt(p.id); setPromptDropdownOpen(false); }}
                              className="flex-1 text-left font-mono text-xs cursor-pointer"
                            >
                              {p.name}
                            </button>
                            <button
                              onClick={(e) => handleDeletePrompt(e, p.id)}
                              className="ml-2 text-neutral-600 hover:text-red-400 transition-colors cursor-pointer"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                        {isCreatingNewPrompt && (
                          <button
                            className="w-full px-4 py-2 text-left font-mono text-xs text-red-400 bg-red-950/20 cursor-default"
                            disabled
                          >
                            New Prompt...
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    onBlur={savingPrompt || enhancing ? undefined : handlePromptSave}
                    placeholder={isCreatingNewPrompt ? 'Write your instruction, then click ENHANCE PROMPT to refine it with AI!' : 'Enter system prompt...'}
                    maxLength={4000}
                    rows={6}
                    className="w-full rounded-lg border border-neutral-700/50 bg-neutral-900 px-4 py-3 text-sm text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-red-600/30 resize-none leading-relaxed"
                  />
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handlePromptEnhance}
                        disabled={!customPrompt.trim() || enhancing || !isAiConfigured}
                        className={`rounded-lg border px-3 py-1.5 min-w-[145px] text-center font-mono text-xs font-semibold uppercase tracking-wider transition-colors ${
                          enhancing
                            ? 'border-red-800/50 text-red-400 cursor-wait'
                            : customPrompt.trim() && !enhancing && isAiConfigured
                              ? 'border-red-800/50 text-red-400 hover:border-red-700 hover:text-red-300 cursor-pointer'
                              : 'border-neutral-800 text-neutral-700 cursor-not-allowed'
                        }`}
                      >
                        {enhancing ? <EnhancingDots /> : 'Enhance Prompt'}
                      </button>
                      <button
                        onClick={handleSavePrompt}
                        disabled={!canSavePrompt || savingPrompt}
                        className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider transition-colors ${
                          canSavePrompt && !savingPrompt
                            ? 'border-red-800/50 text-red-400 hover:border-red-700 hover:text-red-300 cursor-pointer'
                            : 'border-neutral-800 text-neutral-700 cursor-not-allowed'
                        }`}
                      >
                        {savingPrompt ? 'Saving...' : savedPrompts.length >= 5 ? 'Limit Reached' : 'Save Prompt'}
                      </button>
                      <button
                        onClick={handleNewPrompt}
                        disabled={isCreatingNewPrompt || savedPrompts.length >= 5 || savingPrompt || enhancing}
                        className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider transition-colors ${
                          !isCreatingNewPrompt && savedPrompts.length < 5 && !savingPrompt && !enhancing
                            ? 'border-red-800/50 text-red-400 hover:border-red-700 hover:text-red-300 cursor-pointer'
                            : 'border-neutral-800 text-neutral-700 cursor-not-allowed'
                        }`}
                      >
                        New Prompt
                      </button>
                    </div>
                    <button
                      onClick={handlePromptReset}
                      disabled={!isPromptModified}
                      className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider transition-colors ${
                        isPromptModified
                          ? 'border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-300 cursor-pointer'
                          : 'border-neutral-800 text-neutral-700 cursor-not-allowed'
                      }`}
                    >
                      Reset to Default
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">
            Output
          </h2>

          <div className="rounded-xl border border-neutral-800 bg-[#141414] p-5 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5 pr-4">
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-200">
                  Keep transcription in clipboard
                </span>
                <span className="text-xs text-neutral-500">
                  When on, the last transcription stays in your clipboard so you can paste it again with Ctrl+V (or Shift+Insert). When off, your previous clipboard content is restored after auto-paste.
                </span>
              </div>
              <button
                onClick={handleToggleKeepTranscription}
                role="switch"
                aria-checked={!restoreClipboard}
                aria-label="Keep transcription in clipboard"
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  !restoreClipboard ? 'bg-red-600' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    !restoreClipboard ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5 pr-4">
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-neutral-200">
                  Compatibility mode
                </span>
                <span className="text-xs text-neutral-500">
                  Types the transcription character-by-character instead of pasting it. Slower, but works in apps that block synthetic Ctrl+V. Leave off unless auto-paste fails somewhere.
                </span>
              </div>
              <button
                onClick={handleToggleCompatibilityMode}
                role="switch"
                aria-checked={pasteMode === 'type'}
                aria-label="Compatibility mode"
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  pasteMode === 'type' ? 'bg-red-600' : 'bg-neutral-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    pasteMode === 'type' ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}
