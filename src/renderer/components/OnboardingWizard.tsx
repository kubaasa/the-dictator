import { useState, useEffect, useRef, useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import log from 'electron-log/renderer';
import type { TranscriptionEngine } from '../../shared/types';
import { AUTO_MIC_DEVICE_ID } from '../../shared/constants';
import { resolveAutoMic } from '../utils/mic-devices';
import { ApiKeyInput } from './ApiKeyInput';
import appIcon from '../../../assets/icon.png';

type ValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid';
type MicPermission = 'pending' | 'granted' | 'denied' | 'error';
type WizardStep = 0 | 1 | 2;

const STEPS = [
  { label: 'Engine', title: 'Transcription engine' },
  { label: 'Setup', title: '' },
  { label: 'Microphone', title: 'Microphone' },
] as const;

const PRIMARY_BUTTON = 'flex h-9 min-w-[120px] items-center justify-center rounded-lg border border-text bg-text px-4 text-[13px] font-semibold text-bg transition-colors hover:border-text-muted hover:bg-text-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-text disabled:hover:bg-text';
const GHOST_BUTTON = 'flex h-9 items-center justify-center rounded-lg border border-border px-4 text-[13px] font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text';

interface OnboardingWizardProps {
  onComplete: (selectedMicId?: string | null) => void;
  onClose?: () => void;
}

function CheckIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2.6} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

function Radio({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${selected ? 'border-text' : 'border-border-strong'}`}
    >
      {selected && <span className="h-2 w-2 rounded-full bg-text" />}
    </span>
  );
}

function WizardSteps({ currentStep }: { currentStep: WizardStep }) {
  return (
    <ol className="relative flex flex-col gap-[22px]">
      <span aria-hidden="true" className="absolute bottom-6 left-[11px] top-6 w-px bg-border" />
      {STEPS.map((step, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        return (
          <li key={step.label} className="relative flex items-center gap-2.5" aria-current={active ? 'step' : undefined}>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[11px] font-semibold ${
                done ? 'border-text bg-text text-bg' : active ? 'border-text bg-bg text-text' : 'border-border-strong bg-bg text-text-dim'
              }`}
            >
              {done ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={`text-xs ${active ? 'font-medium text-text' : 'text-text-dim'}`}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

const ENGINES: { id: TranscriptionEngine; label: string; text: string }[] = [
  { id: 'local', label: 'Local', text: 'Whisper runs on this PC. English only, one-time model download.' },
  { id: 'cloud', label: 'Cloud', text: 'Groq API with a free key. Any language, needs internet.' },
];

function StepEngine({ engine, onEngineChange }: { engine: TranscriptionEngine; onEngineChange: (e: TranscriptionEngine) => void }) {
  return (
    <div role="radiogroup" aria-label="Transcription engine" className="flex flex-col gap-2">
      {ENGINES.map((e) => {
        const selected = engine === e.id;
        return (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onEngineChange(e.id)}
            className={`flex items-start gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors ${
              selected ? 'border-text bg-surface-hover' : 'border-border bg-surface-sunken hover:border-border-strong'
            }`}
          >
            <span className="pt-px"><Radio selected={selected} /></span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-text">{e.label}</span>
              <span className="text-xs text-text-muted">{e.text}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const LOCAL_MODELS = [
  { value: 'tiny',     label: 'Tiny',     size: '40 MB',  text: 'Fastest, lowest quality' },
  { value: 'base',     label: 'Base',     size: '75 MB',  text: 'Good balance' },
  { value: 'small',    label: 'Small',    size: '250 MB', text: 'Accurate, slower' },
  { value: 'medium',   label: 'Medium',   size: '770 MB', text: 'Near-professional' },
  { value: 'large-v3', label: 'Large v3', size: '1.5 GB', text: 'Best accuracy' },
] as const;

function StepConfig({
  engine,
  modelSize,
  onModelSizeChange,
  groqApiKey,
  onKeyChange,
  onKeyDelete,
  onValidate,
  validation,
  validationError,
}: {
  engine: TranscriptionEngine;
  modelSize: string;
  onModelSizeChange: (size: string) => void;
  groqApiKey: string;
  onKeyChange: (v: string) => void;
  onKeyDelete: () => void;
  onValidate: () => void;
  validation: ValidationStatus;
  validationError: string;
}) {
  if (engine === 'local') {
    return (
      <div className="flex flex-col gap-3.5">
        <div role="radiogroup" aria-label="Whisper model" className="divide-y divide-border/60 overflow-hidden rounded-[10px] border border-border bg-surface-sunken">
          {LOCAL_MODELS.map((model) => {
            const selected = model.value === modelSize;
            return (
              <button
                key={model.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onModelSizeChange(model.value)}
                className={`flex h-10 w-full items-center gap-3 px-3.5 text-left transition-colors ${selected ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`}
              >
                <Radio selected={selected} />
                <span className="text-[13px] font-medium text-text">{model.label}</span>
                <span className="text-xs text-text-muted">{model.text}</span>
                <span className="ml-auto font-mono text-[11px] text-text-dim">{model.size}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-dim">The model downloads on the Processing page after setup.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">
        Get a free key in the{' '}
        <button
          type="button"
          autoFocus
          onClick={() => window.dictator.openExternal('https://console.groq.com/keys')}
          className="text-text underline underline-offset-[3px] transition-colors hover:text-text-muted"
        >
          Groq Console
        </button>
        , paste it here and verify.
      </p>
      <ApiKeyInput
        value={groqApiKey}
        onChange={onKeyChange}
        onSave={onValidate}
        onDelete={onKeyDelete}
        saved={validation === 'valid'}
        invalid={validation === 'invalid'}
        buttonLabel={validation === 'validating' ? 'Verifying...' : 'Verify'}
        buttonDisabled={validation === 'validating' || !groqApiKey.trim()}
        placeholder="paste access key..."
      />
      {validation === 'invalid' && (
        <p className="text-xs text-accent-strong" role="alert">{validationError}</p>
      )}
    </div>
  );
}

const MIC_BAR_COUNT = 8;
const MIC_MIN_BAR_H = 2;
const MIC_MAX_BAR_H = 40;
const MIC_LERP_ATTACK = 0.75;
const MIC_LERP_RELEASE = 0.18;
const MIC_AUDIO_THRESHOLD = 0.15;
const MIC_DETECT_FRAMES = 3;

interface MicDevice {
  deviceId: string;
  label: string;
}

function StepMicTest({
  audioDetected,
  onAudioDetected,
  onAudioReset,
  onDeviceSelect,
}: {
  audioDetected: boolean;
  onAudioDetected: () => void;
  onAudioReset: () => void;
  onDeviceSelect: (deviceId: string | null) => void;
}) {
  const [micPermission, setMicPermission] = useState<MicPermission>('pending');
  const [micError, setMicError] = useState('');
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const barElemsRef = useRef<(HTMLDivElement | null)[]>([]);
  const volumeBarRef = useRef<HTMLDivElement | null>(null);
  const smoothedRef = useRef<Float32Array>(new Float32Array(MIC_BAR_COUNT).fill(MIC_MIN_BAR_H));
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeRef = useRef(true);
  const detectCountRef = useRef(0);

  const refreshDevices = useCallback(async () => {
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    const mics = allDevices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
      }));
    setDevices(mics);
    setSelectedDeviceId((prev) => {
      if (!prev || (prev !== AUTO_MIC_DEVICE_ID && !mics.find((m) => m.deviceId === prev))) {
        return AUTO_MIC_DEVICE_ID;
      }
      return prev;
    });
  }, []);

  const startMicTest = useCallback(async (deviceId?: string | null) => {
    onAudioReset();
    setMicPermission('pending');
    setMicError('');
    detectCountRef.current = 0;
    smoothedRef.current.fill(MIC_MIN_BAR_H);
    activeRef.current = true;

    let analyser: AnalyserNode | null = null;
    let dataArray: Uint8Array | null = null;
    let samplesPerBar = 0;

    try {
      const micStatus = await window.dictator.checkMicSystemPermission();
      if (!activeRef.current) return;
      if (micStatus === 'denied' || micStatus === 'restricted') {
        setMicPermission('denied');
        setMicError('Microphone access blocked by Windows. Enable it in Settings > Privacy & Security > Microphone.');
        return;
      }

      if (deviceId === AUTO_MIC_DEVICE_ID) {
        deviceId = resolveAutoMic(await navigator.mediaDevices.enumerateDevices());
        if (!activeRef.current) return;
      }

      const audioConstraints: MediaTrackConstraints = {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      } catch (micErr) {
        // Saved device unavailable — retry with default mic before giving up
        if (micErr instanceof DOMException && micErr.name === 'OverconstrainedError' && deviceId) {
          log.warn('[OnboardingWizard] Saved mic unavailable, falling back to default device');
          stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
        // Mic temporarily busy (e.g. Teams/Zoom releasing it) — retry once after brief delay
        } else if (micErr instanceof DOMException && micErr.name === 'NotReadableError') {
          log.warn('[OnboardingWizard] Mic busy (NotReadableError), retrying in 400ms...');
          await new Promise(r => setTimeout(r, 400));
          if (!activeRef.current) return;
          stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        } else {
          throw micErr;
        }
      }
      if (!activeRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;

      const ctx = new AudioContext();
      await ctx.resume();
      if (!activeRef.current) { stream.getTracks().forEach(t => t.stop()); ctx.close(); return; }
      audioCtxRef.current = ctx;

      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      dataArray = new Uint8Array(analyser.fftSize);
      samplesPerBar = Math.floor(analyser.fftSize / MIC_BAR_COUNT);
      setMicPermission('granted');
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError') {
        setMicPermission('denied');
        setMicError('Microphone access was denied. Grant permission in your system settings.');
      } else if (name === 'NotFoundError') {
        setMicPermission('error');
        setMicError('No microphone detected. Connect a microphone and try again.');
      } else if (name === 'NotReadableError') {
        setMicPermission('error');
        setMicError('Microphone is being used by another application.');
      } else if (name === 'AbortError') {
        setMicPermission('denied');
        setMicError('Microphone access blocked by Windows. Enable it in Settings > Privacy & Security > Microphone.');
      } else if (name === 'OverconstrainedError') {
        setMicPermission('error');
        setMicError('Selected microphone is unavailable. Try a different device.');
      } else {
        setMicPermission('error');
        setMicError('Could not access microphone.');
      }
      return;
    }

    const tick = () => {
      if (!activeRef.current || !analyser || !dataArray) return;

      analyser.getByteTimeDomainData(dataArray);

      let maxPeak = 0;
      for (let i = 0; i < MIC_BAR_COUNT; i++) {
        let peak = 0;
        const offset = i * samplesPerBar;
        for (let s = 0; s < samplesPerBar; s++) {
          const amplitude = Math.abs(dataArray[offset + s] - 128) / 128;
          if (amplitude > peak) peak = amplitude;
        }
        // Noise gate: ignore quantization noise (values ≤ 2/128 ≈ 0.016)
        const gated = peak > 0.02 ? peak : 0;
        const boosted = Math.min(1, gated * 4);
        if (boosted > maxPeak) maxPeak = boosted;

        const targetH = MIC_MIN_BAR_H + boosted * (MIC_MAX_BAR_H - MIC_MIN_BAR_H);
        const current = smoothedRef.current[i];
        const factor = targetH > current ? MIC_LERP_ATTACK : MIC_LERP_RELEASE;
        smoothedRef.current[i] = current + (targetH - current) * factor;
      }

      for (let i = 0; i < MIC_BAR_COUNT; i++) {
        const el = barElemsRef.current[i];
        if (el) {
          el.style.transform = `scaleY(${(smoothedRef.current[i] / MIC_MAX_BAR_H).toFixed(4)})`;
        }
      }

      if (volumeBarRef.current) {
        volumeBarRef.current.style.width = `${Math.round(maxPeak * 100)}%`;
      }

      if (maxPeak > MIC_AUDIO_THRESHOLD) {
        detectCountRef.current++;
        if (detectCountRef.current === MIC_DETECT_FRAMES) {
          onAudioDetected();
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [onAudioDetected, onAudioReset]);

  const stopMicTest = useCallback(() => {
    activeRef.current = false;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    smoothedRef.current.fill(MIC_MIN_BAR_H);
  }, []);

  useEffect(() => {
    refreshDevices().then(() => {
      onDeviceSelect(AUTO_MIC_DEVICE_ID);
      startMicTest(AUTO_MIC_DEVICE_ID);
    });

    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      stopMicTest();
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, []);

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    onDeviceSelect(deviceId);
    stopMicTest();
    startMicTest(deviceId);
  };

  const handleRetry = () => {
    stopMicTest();
    startMicTest(selectedDeviceId);
  };

  return (
    <div className="flex flex-col gap-4">
      {devices.length > 0 && (
        <div className="relative">
          <select
            value={selectedDeviceId ?? ''}
            onChange={(e) => handleDeviceChange(e.target.value)}
            aria-label="Input device"
            className="h-[34px] w-full appearance-none rounded-lg border border-border bg-surface-sunken pl-3 pr-9 text-xs text-text outline-none transition-colors hover:border-border-strong focus:border-border-strong"
          >
            <option value={AUTO_MIC_DEVICE_ID}>Automatic (follows your headphones)</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      )}

      {micPermission === 'granted' && (
        <div className="flex flex-col gap-3.5 pt-2">
          <div className="flex items-end justify-center gap-[5px]" style={{ height: MIC_MAX_BAR_H + 4 }}>
            {Array.from({ length: MIC_BAR_COUNT }, (_, i) => (
              <div
                key={i}
                ref={el => { barElemsRef.current[i] = el; }}
                className="rounded-sm bg-text"
                style={{
                  width: 6,
                  height: MIC_MAX_BAR_H,
                  transformOrigin: 'bottom',
                  transform: `scaleY(${(MIC_MIN_BAR_H / MIC_MAX_BAR_H).toFixed(4)})`,
                }}
              />
            ))}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div ref={volumeBarRef} className="h-full rounded-full bg-text" style={{ width: '0%' }} />
          </div>
          <div className="flex h-5 items-center justify-center gap-2 text-[13px]" role="status" aria-live="polite">
            {audioDetected ? (
              <>
                <CheckIcon className="h-4 w-4 text-ok-text" />
                <span className="font-medium text-ok-text">Microphone working</span>
              </>
            ) : (
              <span className="text-text-dim">Say something to test the mic</span>
            )}
          </div>
        </div>
      )}

      {micPermission === 'pending' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border-strong border-t-text" />
          <p className="text-xs text-text-dim">Requesting microphone access...</p>
        </div>
      )}

      {(micPermission === 'denied' || micPermission === 'error') && (
        <div className="flex items-start gap-3 rounded-[10px] border border-border bg-surface-sunken px-4 py-3.5">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-warn" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-semibold text-text">
              {micPermission === 'denied' ? 'Permission denied' : 'Microphone error'}
            </p>
            <p className="text-xs text-text-muted">{micError}</p>
            {micPermission === 'error' && (
              <button type="button" onClick={handleRetry} className={`${GHOST_BUTTON} mt-2 h-8 self-start`}>Retry</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function OnboardingWizard({ onComplete, onClose }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [engine, setEngine] = useState<TranscriptionEngine>('local');
  const [modelSize, setModelSize] = useState('base');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [validation, setValidation] = useState<ValidationStatus>('idle');
  const [validationError, setValidationError] = useState('');
  const [audioDetected, setAudioDetected] = useState(false);
  const [selectedMicId, setSelectedMicId] = useState<string | null>(null);

  const handleEngineChange = (newEngine: TranscriptionEngine) => {
    setEngine(newEngine);
    if (newEngine === 'local') {
      setValidation('idle');
      setValidationError('');
    }
  };

  const handleKeyChange = (value: string) => {
    setGroqApiKey(value);
    if (validation === 'valid' || validation === 'invalid') {
      setValidation('idle');
      setValidationError('');
    }
  };

  const handleKeyDelete = () => {
    setGroqApiKey('');
    setValidation('idle');
    setValidationError('');
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

  const canProceedFromStep1 = engine === 'local' || validation === 'valid';

  const handleNext = () => {
    if (currentStep === 0) setCurrentStep(1);
    else if (currentStep === 1 && canProceedFromStep1) setCurrentStep(2);
  };

  const handleBack = () => {
    if (currentStep === 1) setCurrentStep(0);
    else if (currentStep === 2) setCurrentStep(1);
  };

  const handleFinish = async () => {
    const current = await window.dictator.getSettings();
    await window.dictator.setSettings({
      transcription: {
        engine,
        localModelSize: modelSize,
        language: 'en',
        groqApiKey: engine === 'cloud' ? groqApiKey.trim() : current.transcription.groqApiKey,
      },
      audio: {
        ...current.audio,
        deviceId: selectedMicId ?? AUTO_MIC_DEVICE_ID,
        deviceLabel: undefined,
      },
      general: {
        ...current.general,
        firstRunComplete: true,
      },
    });
    onComplete(selectedMicId);
  };

  const handleAudioDetected = useCallback(() => {
    setAudioDetected(true);
  }, []);

  const handleAudioReset = useCallback(() => {
    setAudioDetected(false);
  }, []);

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape' && onClose) {
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;

    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const stepTitle = currentStep === 1
    ? (engine === 'local' ? 'Whisper model' : 'Groq API key')
    : STEPS[currentStep].title;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Setup guide"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex bg-bg outline-none animate-fade-in"
    >
      <aside className="flex w-[260px] shrink-0 flex-col gap-8 border-r border-border px-8 py-10">
        <img src={appIcon} alt="" className="h-12 w-12 rounded-xl" />
        <div className="flex flex-col gap-1.5">
          <h2 className="text-base font-semibold leading-snug text-text">Welcome to<br />The Dictator</h2>
          <p className="text-xs text-text-dim">Three quick steps, you can change everything later.</p>
        </div>
        <WizardSteps currentStep={currentStep} />
        <div className="flex-1" />
        <span className="font-mono text-[13px] font-bold uppercase tracking-[0.35em] text-accent">The Dictator</span>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col gap-5 px-12 py-10">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-surface-hover hover:text-text"
            title="Close"
            aria-label="Close setup guide"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        <div className="flex max-w-[620px] flex-col gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">Step {currentStep + 1} of 3</span>
          <h3 className="text-xl font-semibold text-text">{stepTitle}</h3>
        </div>

        <div key={currentStep} className="max-w-[620px] animate-fade-in">
          {currentStep === 0 && (
            <StepEngine engine={engine} onEngineChange={handleEngineChange} />
          )}
          {currentStep === 1 && (
            <StepConfig
              engine={engine}
              modelSize={modelSize}
              onModelSizeChange={setModelSize}
              groqApiKey={groqApiKey}
              onKeyChange={handleKeyChange}
              onKeyDelete={handleKeyDelete}
              onValidate={handleValidateKey}
              validation={validation}
              validationError={validationError}
            />
          )}
          {currentStep === 2 && (
            <StepMicTest
              audioDetected={audioDetected}
              onAudioDetected={handleAudioDetected}
              onAudioReset={handleAudioReset}
              onDeviceSelect={setSelectedMicId}
            />
          )}
        </div>

        <div className="flex-1" />

        <div className="flex max-w-[620px] justify-end gap-2.5">
          {currentStep > 0 && (
            <button type="button" onClick={handleBack} className={GHOST_BUTTON}>Back</button>
          )}
          {currentStep < 2 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={currentStep === 1 && !canProceedFromStep1}
              className={PRIMARY_BUTTON}
            >
              Next
            </button>
          ) : (
            <button type="button" onClick={handleFinish} className={PRIMARY_BUTTON}>
              {audioDetected ? 'Get started' : 'Skip and finish'}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
