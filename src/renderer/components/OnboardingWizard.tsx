import { useState, useEffect, useRef, useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { TranscriptionEngine } from '../../shared/types';
import { ApiKeyInput } from './ApiKeyInput';
import appIcon from '../../../assets/icon.png';

type ValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid';
type MicPermission = 'pending' | 'granted' | 'denied' | 'error';
type WizardStep = 0 | 1 | 2;

const STEP_LABELS = ['Engine', 'Config', 'Test'] as const;

interface OnboardingWizardProps {
  onComplete: (selectedMicId?: string | null) => void;
  onClose?: () => void;
}

// ─── Stepper ────────────────────────────────────────────────────────────────

function WizardStepper({ currentStep }: { currentStep: WizardStep }) {
  return (
    <div className="mb-6 flex items-center justify-center gap-0">
      {STEP_LABELS.map((label, i) => {
        const isCompleted = i < currentStep;
        const isActive = i === currentStep;

        return (
          <div key={label} className="flex items-center">
                {i > 0 && (
              <div className={`h-0.5 w-12 transition-colors duration-300 ${
                i <= currentStep ? 'bg-red-600' : 'bg-neutral-700'
              }`} />
            )}

            <div className="flex flex-col items-center">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                isCompleted
                  ? 'border-red-600 bg-red-600'
                  : isActive
                    ? 'border-red-600 bg-red-600 ring-4 ring-red-600/20'
                    : 'border-neutral-600 bg-transparent'
              }`}>
                {isCompleted ? (
                  <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  <span className={`font-mono text-[10px] font-bold ${
                    isActive ? 'text-white' : 'text-neutral-600'
                  }`}>
                    {i + 1}
                  </span>
                )}
              </div>
              <span className={`mt-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors duration-300 ${
                isActive
                  ? 'text-neutral-200'
                  : isCompleted
                    ? 'text-neutral-400'
                    : 'text-neutral-600'
              }`}>
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Engine Selection ───────────────────────────────────────────────

function StepEngine({
  engine,
  onEngineChange,
}: {
  engine: TranscriptionEngine;
  onEngineChange: (e: TranscriptionEngine) => void;
}) {
  return (
    <div>
      <label className="mb-3 block font-mono text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Choose transcription engine
      </label>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => onEngineChange('local')}
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
          onClick={() => onEngineChange('cloud')}
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
  );
}

// ─── Step 2: Configuration ──────────────────────────────────────────────────

const LOCAL_MODELS = [
  { value: 'tiny',     label: 'Tiny',     size: '~40 MB',   precision: 'Basic',     strengths: 'Fastest, lowest resource usage' },
  { value: 'base',     label: 'Base',     size: '~75 MB',   precision: 'Good',      strengths: 'Best balance of speed and quality' },
  { value: 'small',    label: 'Small',    size: '~250 MB',  precision: 'High',      strengths: 'Accurate, still reasonably fast' },
  { value: 'medium',   label: 'Medium',   size: '~770 MB',  precision: 'Very High', strengths: 'Near-professional transcription' },
  { value: 'large-v3', label: 'Large v3', size: '~1.5 GB',  precision: 'Highest',   strengths: 'Maximum accuracy, multilingual' },
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
      <div>
        <label className="mb-3 block font-mono text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Choose Whisper model
        </label>

        <div className="mb-4 overflow-hidden rounded-lg border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-900/80">
                <th className="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Model</th>
                <th className="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Precision</th>
                <th className="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Size</th>
                <th className="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Strengths</th>
              </tr>
            </thead>
            <tbody>
              {LOCAL_MODELS.map((model) => {
                const isSelected = model.value === modelSize;
                return (
                  <tr
                    key={model.value}
                    onClick={() => onModelSizeChange(model.value)}
                    className={`cursor-pointer border-b border-neutral-800/50 last:border-b-0 transition-colors ${
                      isSelected
                        ? 'bg-red-950/30'
                        : 'bg-neutral-900/30 hover:bg-neutral-800/40'
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`h-3 w-3 shrink-0 rounded-full border-2 transition-colors ${
                          isSelected ? 'border-red-600 bg-red-600' : 'border-neutral-600'
                        }`} />
                        <span className={`font-mono text-xs font-semibold ${
                          isSelected ? 'text-neutral-100' : 'text-neutral-300'
                        }`}>
                          {model.label}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`font-mono text-xs ${isSelected ? 'text-red-400/80' : 'text-neutral-400'}`}>
                        {model.precision}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`font-mono text-xs ${isSelected ? 'text-neutral-200' : 'text-neutral-500'}`}>
                        {model.size}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs ${isSelected ? 'text-neutral-300' : 'text-neutral-500'}`}>
                        {model.strengths}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-neutral-700/40 bg-neutral-800/40 px-3 py-2">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <p className="text-xs text-neutral-500">
            The model will be downloaded on the <span className="font-semibold text-neutral-400">Processing</span> page after setup. Download is one-time only.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-3 block font-mono text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Groq API key
      </label>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-neutral-300">
          How to get your free API key
        </p>
        <ol className="mb-3 space-y-1.5 text-sm text-neutral-400">
          <li className="flex gap-2">
            <span className="shrink-0 font-mono text-red-500/70">1.</span>
            <span>
              Open{' '}
              <button
                autoFocus
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
          onChange={onKeyChange}
          onSave={onValidate}
          onDelete={onKeyDelete}
          saved={validation === 'valid'}
          buttonLabel={
            validation === 'validating' ? 'Verifying...'
            : 'Verify'
          }
          buttonDisabled={validation === 'validating' || !groqApiKey.trim()}
          placeholder="paste access key..."
        />

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
    </div>
  );
}

// ─── Step 3: Microphone Test ────────────────────────────────────────────────

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
  const [volumePercent, setVolumePercent] = useState(0);
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
  const lastVolRef = useRef(0);

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
      if (!prev || !mics.find((m) => m.deviceId === prev)) {
        return mics[0]?.deviceId ?? null;
      }
      return prev;
    });
  }, []);

  const startMicTest = useCallback(async (deviceId?: string | null) => {
    onAudioReset();
    setMicPermission('pending');
    setMicError('');
    setVolumePercent(0);
    detectCountRef.current = 0;
    lastVolRef.current = 0;
    smoothedRef.current.fill(MIC_MIN_BAR_H);
    activeRef.current = true;

    let analyser: AnalyserNode | null = null;
    let dataArray: Uint8Array | null = null;
    let samplesPerBar = 0;

    try {
      const micStatus = await window.dictator.checkMicSystemPermission();
      if (!activeRef.current) return;
      if (micStatus === 'denied') {
        setMicPermission('denied');
        setMicError('Microphone access blocked by Windows. Enable it in Settings > Privacy & Security > Microphone.');
        return;
      }

      const audioConstraints: MediaTrackConstraints = {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
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

      const volPct = Math.round(maxPeak * 100);
      if (volumeBarRef.current) {
        volumeBarRef.current.style.width = `${volPct}%`;
      }
      // Throttle React state update to avoid excessive re-renders
      if (Math.abs(volPct - lastVolRef.current) > 2 || volPct === 0) {
        lastVolRef.current = volPct;
        setVolumePercent(volPct);
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
      // selectedDeviceId is set inside refreshDevices via setState,
      // but we need the value now — read from enumerateDevices directly
      navigator.mediaDevices.enumerateDevices().then((all) => {
        const firstMic = all.find((d) => d.kind === 'audioinput');
        const micId = firstMic?.deviceId ?? null;
        onDeviceSelect(micId);
        startMicTest(micId);
      });
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
    <div>
      <label className="mb-1 block font-mono text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Test your microphone
      </label>
      <p className="mb-4 text-sm text-neutral-500">
        Speak or make noise to verify your mic works.
      </p>

      {devices.length > 0 && (
        <div className="mb-4">
          <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Input device
          </label>
          <div className="relative">
            <select
              value={selectedDeviceId ?? ''}
              onChange={(e) => handleDeviceChange(e.target.value)}
              className="w-full appearance-none rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 py-2 pr-8 font-mono text-xs text-neutral-200 outline-none transition-colors hover:border-neutral-600 focus:border-red-700"
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        </div>
      )}

      {micPermission === 'granted' && (
        <>
          <div className="mb-4 flex items-end justify-center gap-1.5" style={{ height: MIC_MAX_BAR_H + 8 }}>
            {Array.from({ length: MIC_BAR_COUNT }, (_, i) => (
              <div
                key={i}
                ref={el => { barElemsRef.current[i] = el; }}
                className="rounded-sm bg-red-500"
                style={{
                  width: 6,
                  height: MIC_MAX_BAR_H,
                  transformOrigin: 'bottom',
                  transform: `scaleY(${(MIC_MIN_BAR_H / MIC_MAX_BAR_H).toFixed(4)})`,
                }}
              />
            ))}
          </div>

          <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-neutral-700">
            <div
              ref={volumeBarRef}
              className="h-full rounded-full bg-red-600 transition-none"
              style={{ width: '0%' }}
            />
          </div>
          <p className="mb-4 text-center font-mono text-[10px] uppercase tracking-wider text-neutral-500">
            Volume: {volumePercent}%
          </p>

          {audioDetected && (
            <div className="flex items-center justify-center gap-2 animate-fade-in">
              <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <span className="font-mono text-sm font-semibold text-green-500">
                Microphone working!
              </span>
            </div>
          )}
        </>
      )}

      {micPermission === 'pending' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-red-500" />
          <p className="font-mono text-xs text-neutral-500">Requesting microphone access...</p>
        </div>
      )}

      {(micPermission === 'denied' || micPermission === 'error') && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
          <div className="flex items-start gap-3">
            <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <div>
              <p className="font-mono text-sm font-semibold text-neutral-200">
                {micPermission === 'denied' ? 'Permission denied' : 'Microphone error'}
              </p>
              <p className="mt-1 text-sm text-neutral-400">{micError}</p>
              {micPermission === 'error' && (
                <button
                  onClick={handleRetry}
                  className="mt-3 rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-neutral-300 transition-colors hover:bg-neutral-700/50 hover:text-neutral-200"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Wizard Shell ───────────────────────────────────────────────────────────

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
        deviceId: selectedMicId ?? '',
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Setup guide"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-lg rounded-2xl border border-neutral-800 bg-[#141414] p-8 shadow-2xl outline-none"
      >
        {onClose && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
            title="Close"
            aria-label="Close setup guide"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        <div className="mb-6 text-center">
          <img src={appIcon} alt="The Dictator" className="mx-auto mb-2 h-20 w-20 rounded-xl" />
          <h2 className="font-mono text-lg font-bold tracking-wider text-white uppercase">
            Welcome to The Dictator
          </h2>
          <p className="mt-2 text-sm text-neutral-400">
            Voice dictation for your desktop. Let's get you set up.
          </p>
        </div>

        <WizardStepper currentStep={currentStep} />

        <div key={currentStep} className="animate-fade-in">
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

        <div className="mt-6 flex gap-3">
          {currentStep > 0 && (
            <button
              onClick={handleBack}
              className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900/50 py-3 font-mono text-sm font-semibold uppercase tracking-wider text-neutral-400 transition-all hover:bg-neutral-800 hover:text-neutral-200"
            >
              Back
            </button>
          )}
          {currentStep < 2 ? (
            <button
              onClick={handleNext}
              disabled={currentStep === 1 && !canProceedFromStep1}
              className="flex-1 rounded-xl border-2 border-red-700 bg-red-950/50 py-3 font-mono text-sm font-bold uppercase tracking-wider text-red-400 transition-all hover:bg-red-900/40 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-red-950/50 disabled:hover:text-red-400"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleFinish}
              className="flex-1 rounded-xl border-2 border-red-700 bg-red-950/50 py-3 font-mono text-sm font-bold uppercase tracking-wider text-red-400 transition-all hover:bg-red-900/40 hover:text-red-300"
            >
              {audioDetected ? 'Get Started' : 'Skip & Finish'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
