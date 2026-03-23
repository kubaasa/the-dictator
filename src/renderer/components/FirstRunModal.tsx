import { useState } from 'react';
import type { TranscriptionEngine } from '../../shared/types';
import { ApiKeyInput } from './ApiKeyInput';
import appIcon from '../../../assets/icon.png';

type ValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid';

interface FirstRunModalProps {
  onComplete: () => void;
}

export function FirstRunModal({ onComplete }: FirstRunModalProps) {
  const [engine, setEngine] = useState<TranscriptionEngine>('local');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [validation, setValidation] = useState<ValidationStatus>('idle');
  const [validationError, setValidationError] = useState('');

  // Reset API key state when switching away from cloud
  const handleEngineChange = (newEngine: TranscriptionEngine) => {
    setEngine(newEngine);
    if (newEngine === 'local') {
      setGroqApiKey('');
      setValidation('idle');
      setValidationError('');
    }
  };

  // Reset validation when key text changes after a validation attempt
  const handleKeyChange = (value: string) => {
    setGroqApiKey(value);
    if (validation === 'valid' || validation === 'invalid') {
      setValidation('idle');
      setValidationError('');
    }
  };

  const handleValidateKey = async () => {
    const key = groqApiKey.trim();
    if (!key) return;
    setValidation('validating');
    setValidationError('');
    try {
      const result = await window.dictator.groq.validateKey(key);
      if (result.valid) {
        setValidation('valid');
      } else {
        setValidation('invalid');
        setValidationError(result.error ?? 'Invalid API key');
        setGroqApiKey('');
      }
    } catch {
      setValidation('invalid');
      setValidationError('Validation failed. Check your internet connection.');
      setGroqApiKey('');
    }
  };

  const canProceed = engine === 'local' || validation === 'valid';

  const handleGetStarted = async () => {
    if (!canProceed) return;
    await window.dictator.setSettings({
      transcription: { engine, localModelSize: 'base', language: 'en', groqApiKey: engine === 'cloud' ? groqApiKey.trim() : '' },
      general: {
        autoStart: false,
        minimizeToTray: true,
        overlayPosition: 'top-right',
        firstRunComplete: true,
      },
    });
    onComplete();
  };

  const verifyButtonLabel = (() => {
    switch (validation) {
      case 'validating': return 'Verifying...';
      case 'valid': return 'Verified';
      case 'invalid': return 'Verify';
      default: return 'Verify';
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-[#141414] p-8 shadow-2xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <img src={appIcon} alt="The Dictator" className="mx-auto mb-2 h-20 w-20 rounded-xl" />
          <h2 className="font-mono text-lg font-bold tracking-wider text-white uppercase">
            Welcome to The Dictator
          </h2>
          <p className="mt-2 text-sm text-neutral-400">
            Voice dictation for your desktop. Let's get you set up.
          </p>
        </div>

        {/* Engine selection */}
        <div className="mb-6">
          <label className="mb-3 block font-mono text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Choose transcription engine
          </label>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => handleEngineChange('local')}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                engine === 'local'
                  ? 'border-red-700 bg-red-950/30'
                  : 'border-neutral-700 bg-neutral-900/50 hover:border-neutral-600'
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                engine === 'local' ? 'border-red-600 bg-red-600' : 'border-neutral-600'
              }`} />
              <div>
                <p className="font-mono text-sm font-semibold text-neutral-200">Local (Whisper)</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {['Private', 'Secure', 'English'].map((text) => (
                    <span key={text} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                      engine === 'local'
                        ? 'border-red-900/40 bg-red-950/30 text-red-400/80'
                        : 'border-neutral-700 bg-neutral-800/50 text-neutral-500'
                    }`}>
                      {text === 'Private' && <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>}
                      {text === 'Secure' && <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" /></svg>}
                      {text === 'English' && <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802" /></svg>}
                      {text}
                    </span>
                  ))}
                </div>
              </div>
            </button>
            <button
              onClick={() => handleEngineChange('cloud')}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                engine === 'cloud'
                  ? 'border-red-700 bg-red-950/30'
                  : 'border-neutral-700 bg-neutral-900/50 hover:border-neutral-600'
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                engine === 'cloud' ? 'border-red-600 bg-red-600' : 'border-neutral-600'
              }`} />
              <div>
                <p className="font-mono text-sm font-semibold text-neutral-200">Cloud (Groq API)</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {['Fast', 'Free', 'Multilingual'].map((text) => (
                    <span key={text} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                      engine === 'cloud'
                        ? 'border-red-900/40 bg-red-950/30 text-red-400/80'
                        : 'border-neutral-700 bg-neutral-800/50 text-neutral-500'
                    }`}>
                      {text === 'Fast' && <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" /></svg>}
                      {text === 'Free' && <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>}
                      {text === 'Multilingual' && <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" /></svg>}
                      {text}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Cloud: API key setup */}
        {engine === 'cloud' && (
          <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
            <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-neutral-300">
              How to get your free API key
            </p>
            <ol className="mb-3 space-y-1.5 text-sm text-neutral-400">
              <li className="flex gap-2">
                <span className="shrink-0 font-mono text-red-500/70">1.</span>
                <span>
                  Open{' '}
                  <button
                    onClick={() => window.dictator.openExternal('https://console.groq.com/keys')}
                    className="text-red-400 underline underline-offset-2 hover:text-red-300 cursor-pointer"
                  >
                    Groq Console
                  </button>
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-mono text-red-500/70">2.</span>
                <span>Create a free account (or sign in)</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-mono text-red-500/70">3.</span>
                <span>Generate a new API key and copy it</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-mono text-red-500/70">4.</span>
                <span>Paste it below and verify</span>
              </li>
            </ol>

            <div className="mb-3 flex items-start gap-2 rounded-md border border-neutral-700/40 bg-neutral-800/40 px-3 py-2">
              <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
              </svg>
              <p className="text-xs text-neutral-500">
                Groq's free plan is more than enough for daily use — no payment needed.
              </p>
            </div>

            <ApiKeyInput
              value={groqApiKey}
              onChange={handleKeyChange}
              onSave={handleValidateKey}
              saved={validation === 'valid'}
              buttonLabel={verifyButtonLabel}
              buttonDisabled={validation === 'validating' || !groqApiKey.trim()}
              placeholder="paste access key..."
            />

            {/* Validation feedback */}
            {validation === 'validating' && (
              <p className="mt-2 font-mono text-xs text-neutral-500 animate-pulse">
                Checking API key...
              </p>
            )}
            {validation === 'valid' && (
              <p className="mt-2 flex items-center gap-1.5 font-mono text-xs text-green-500">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                API key is valid
              </p>
            )}
            {validation === 'invalid' && (
              <p className="mt-2 flex items-center gap-1.5 font-mono text-xs text-red-400">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                {validationError}
              </p>
            )}
          </div>
        )}

        {/* Local: hint */}
        {engine === 'local' && (
          <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
            <p className="font-mono text-xs text-neutral-400">
              After setup, go to the Modes page to download the transcription model.
            </p>
          </div>
        )}

        {/* Get Started button */}
        <button
          onClick={handleGetStarted}
          disabled={!canProceed}
          className="w-full rounded-xl border-2 border-red-700 bg-red-950/50 py-3 font-mono text-sm font-bold uppercase tracking-wider text-red-400 transition-all hover:bg-red-900/40 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-red-950/50 disabled:hover:text-red-400"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}
