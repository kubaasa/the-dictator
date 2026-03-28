import React, { useCallback, useEffect, useRef, useState } from 'react';
import log from 'electron-log/renderer';
import type { RecordingState, HotkeyMode, AppSettings } from '../../../shared/types';

interface MaxiWidgetProps {
  voiceLevel: number;
  state: RecordingState;
  shortcuts: AppSettings['hotkey']['shortcuts'];
  hotkeyMode: HotkeyMode;
  errorMessage?: string;
  audioDeviceId?: string;
}

const BAR_COUNT  = 60;
const BAR_WIDTH  = 3;
const BAR_GAP    = 3;
const MAX_BAR_H  = 88;
const MIN_BAR_H  = 2.5;

// LERP smoothing: 0 = frozen, 1 = instant
const LERP_ATTACK  = 0.75;
const LERP_RELEASE = 0.18;

const ERROR_RED = '#DC2626';
const BASE_COLOR = 'rgba(255,255,255,0.85)';

const KEY_ALIASES: Record<string, string> = {
  BracketRight: ']', BracketLeft: '[', Backquote: '`', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Minus: '-', Equal: '=', Escape: 'Esc', Space: 'Space',
};

function formatKey(k: string): string {
  return KEY_ALIASES[k] ?? k;
}

// Hanning window: w(i) = sin²(π * i / (N-1)) — spindle/diamond shape
const HANNING_WEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) =>
  Math.pow(Math.sin(Math.PI * i / (BAR_COUNT - 1)), 2)
);

const IDLE_SCALES = HANNING_WEIGHTS.map(w =>
  ((MIN_BAR_H + w * 6) / MAX_BAR_H).toFixed(4)
);

const INIT_PEAK_SCALE = ((MIN_BAR_H + MAX_BAR_H * 0.2) / MAX_BAR_H).toFixed(4);

// Negative delays create 3 simultaneous wave phases flowing right-to-left
const INIT_DELAYS = Array.from({ length: BAR_COUNT }, (_, i) =>
  (-((BAR_COUNT - 1 - i) / (BAR_COUNT - 1)) * 3).toFixed(3)
);

// Per-bar pseudo-random variation for organic movement
const BAR_PROPS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const rand = seed - Math.floor(seed);
  return { multiplier: 0.80 + rand * 0.20, jitter: 0.95 + rand * 0.1 };
});

const KEYFRAMES = `
@keyframes rec-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
@keyframes maxi-error-shake {
  0%        { transform: translateX(0); }
  20%       { transform: translateX(4px); }
  40%       { transform: translateX(-4px); }
  60%       { transform: translateX(3px); }
  80%, 100% { transform: translateX(0); }
}
@keyframes maxi-init {
  0%, 100% { transform: scaleY(var(--init-idle, 0.05)); }
  50%       { transform: scaleY(var(--init-peak, 0.35)); }
}
@keyframes maxi-enter {
  from { opacity: 0; transform: scale(0.92); }
  to   { opacity: 1; transform: scale(1.0); }
}
@keyframes maxi-exit {
  from { opacity: 1; transform: scale(1.0); }
  to   { opacity: 0; transform: scale(0.9); }
}
@keyframes processing-pulse {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 1; }
}
@keyframes dot-blink {
  0%        { opacity: 0; }
  20%, 60%  { opacity: 1; }
  100%      { opacity: 0; }
}
@keyframes error-flicker {
  0%, 12%, 40%, 57%, 74%, 90%, 100% { opacity: 1; }
  3%  { opacity: 0.4; }
  6%  { opacity: 0.9; }
  9%  { opacity: 0.3; }
  55% { opacity: 0.7; }
  72% { opacity: 0.4; }
  92% { opacity: 0.6; }
}
`;

type AnimPhase = 'idle' | 'entering' | 'active' | 'exiting';

export function MaxiWidget({ voiceLevel, state, shortcuts, hotkeyMode, errorMessage, audioDeviceId }: MaxiWidgetProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [animPhase, setAnimPhase] = useState<AnimPhase>('idle');
  const prevIsActiveRef = useRef(false);
  const dragMouseUpRef = useRef<(() => void) | null>(null);

  // Audio visualization refs — updated in RAF loop, not React state
  const vizActiveRef   = useRef(false);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const analyserRef    = useRef<AnalyserNode | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const rafRef         = useRef<number>(0);
  const voiceLevelRef  = useRef(0);
  const smoothedRef    = useRef<Float32Array>(new Float32Array(BAR_COUNT).fill(MIN_BAR_H));
  const barElemsRef    = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => { voiceLevelRef.current = voiceLevel; }, [voiceLevel]);

  const isInitializing = state === 'initializing';
  const isRecording    = state === 'recording';
  const isTranscribing = state === 'transcribing' || state === 'processing';
  const isDone         = state === 'done';
  const isError        = state === 'error';

  // 'done' is NOT active — widget starts fading out immediately when transcription completes
  const isActive = isInitializing || isRecording || isTranscribing || isError;

  // Sticky state: remember last content during exit animation to prevent flash
  const wasErrorRef = useRef(false);
  const wasProcessingRef = useRef(false);

  if (isActive && !prevIsActiveRef.current) {
    wasErrorRef.current = false;
    wasProcessingRef.current = false;
  }

  if (isError) wasErrorRef.current = true;
  if (isTranscribing) wasProcessingRef.current = true;

  const isExiting = animPhase === 'exiting' || !isActive;
  const showError = isError || (wasErrorRef.current && isExiting);
  const showProcessing = isTranscribing || (!showError && wasProcessingRef.current && isExiting);
  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (isActive && !wasActive) {
      setAnimPhase('entering');
      const t = setTimeout(() => setAnimPhase('active'), 220);
      return () => clearTimeout(t);
    } else if (!isActive && wasActive) {
      setAnimPhase('exiting');
      // Transition to 'idle' after exit animation (250ms) + small buffer
      const t = setTimeout(() => setAnimPhase('idle'), 300);
      return () => clearTimeout(t);
    }
  }, [isActive]);

  useEffect(() => {
    if (!isRecording) {
      vizActiveRef.current = false;
      stopVisualization();
      return;
    }
    vizActiveRef.current = true;
    startVisualization().catch(() => {
      vizActiveRef.current = false;
      stopVisualization();
    });
    return () => {
      vizActiveRef.current = false;
      stopVisualization();
    };
  }, [isRecording]);

  async function startVisualization() {
    let localAnalyser: AnalyserNode | null = null;
    let dataArray: Uint8Array | null = null;
    let samplesPerBar = 0;

    try {
      const audioConstraints: MediaTrackConstraints = audioDeviceId
        ? { deviceId: { exact: audioDeviceId } }
        : {};
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...audioConstraints }, video: false });

      if (!vizActiveRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;

      const ctx = new AudioContext();
      await ctx.resume();

      if (!vizActiveRef.current) {
        stream.getTracks().forEach(t => t.stop());
        ctx.close();
        return;
      }
      audioCtxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyserRef.current = analyser;
      localAnalyser = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      dataArray    = new Uint8Array(analyser.fftSize);
      samplesPerBar = Math.floor(analyser.fftSize / BAR_COUNT);
    } catch (err) {
      log.warn('[MaxiWidget] getUserMedia failed, falling back to voiceLevel prop:', err);
    }

    if (!vizActiveRef.current) return;

    const tick = () => {
      if (localAnalyser && dataArray) {
        localAnalyser.getByteTimeDomainData(dataArray);

        for (let i = 0; i < BAR_COUNT; i++) {
          let peak = 0;
          const offset = i * samplesPerBar;
          for (let s = 0; s < samplesPerBar; s++) {
            const amplitude = Math.abs(dataArray[offset + s] - 128) / 128;
            if (amplitude > peak) peak = amplitude;
          }

          const boosted = Math.min(1, peak * 4);
          const varied = boosted * BAR_PROPS[i].multiplier * BAR_PROPS[i].jitter;
          const enveloped = varied * HANNING_WEIGHTS[i];
          const targetH   = MIN_BAR_H + enveloped * (MAX_BAR_H - MIN_BAR_H);

          const current = smoothedRef.current[i];
          const factor  = targetH > current ? LERP_ATTACK : LERP_RELEASE;
          smoothedRef.current[i] = current + (targetH - current) * factor;
        }
      } else {
        const level = Math.min(1, Math.pow(Math.min(1, Math.max(0, voiceLevelRef.current)), 0.3) * 1.5);
        for (let i = 0; i < BAR_COUNT; i++) {
          const varied = level * BAR_PROPS[i].multiplier * BAR_PROPS[i].jitter;
          const enveloped = varied * HANNING_WEIGHTS[i];
          const targetH   = MIN_BAR_H + enveloped * (MAX_BAR_H - MIN_BAR_H);

          const current = smoothedRef.current[i];
          const factor  = targetH > current ? LERP_ATTACK : LERP_RELEASE;
          smoothedRef.current[i] = current + (targetH - current) * factor;
        }
      }

      for (let i = 0; i < BAR_COUNT; i++) {
        const el = barElemsRef.current[i];
        if (el) {
          const scaleY = (smoothedRef.current[i] / MAX_BAR_H).toFixed(4);
          el.style.transform  = `scaleY(${scaleY})`;
          el.style.transition = 'none';
          el.style.animation  = 'none';
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }

  function stopVisualization() {
    cancelAnimationFrame(rafRef.current);

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    analyserRef.current = null;
    smoothedRef.current.fill(MIN_BAR_H);
  }

  useEffect(() => {
    return () => {
      if (dragMouseUpRef.current) {
        document.removeEventListener('mouseup', dragMouseUpRef.current);
        dragMouseUpRef.current = null;
      }
      window.dictator.widgetDragEnd();
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    window.dictator.widgetDragStart(e.screenX - window.screenX, e.screenY - window.screenY);
    setIsDragging(true);
    const onUp = () => {
      window.dictator.widgetDragEnd();
      setIsDragging(false);
      document.removeEventListener('mouseup', onUp);
      dragMouseUpRef.current = null;
    };
    dragMouseUpRef.current = onUp;
    document.addEventListener('mouseup', onUp);
  }, []);

  const indicator = isRecording
    ? { dot: true,  text: 'REC',   color: ERROR_RED }
    : isError
      ? { dot: false, text: 'ERROR', color: ERROR_RED }
      : null;

  const recShortcut = hotkeyMode === 'push-to-talk'
    ? shortcuts.pushToTalk
    : shortcuts.toggleRecording;
  const recLabel = hotkeyMode === 'push-to-talk' ? 'Hold to Rec' : 'Stop';

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{KEYFRAMES}</style>

      {/* Transparent hit zone — required for mouse events on Electron transparent window */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          padding: 8,
          borderRadius: 24,
          background: 'rgba(0,0,0,0.01)',
          cursor: isDragging ? 'grabbing' : 'grab',
          transformOrigin: 'center',
          opacity: animPhase === 'idle' ? 0 : undefined,
          animation:
            animPhase === 'entering' ? 'maxi-enter 200ms ease-out both' :
            animPhase === 'exiting'  ? 'maxi-exit 250ms ease-in both'   :
            'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '10px 20px 8px',
            borderRadius: 20,
            background: 'rgba(10, 10, 10, 0.75)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            boxShadow: 'none',
            border: '1px solid rgba(255,255,255,0.06)',
            minWidth: 500,
            animation: 'none',
          } as React.CSSProperties}
        >
            <div style={{ height: 22, display: 'flex', alignItems: 'center' }}>
                {indicator && (
                  <span style={{
                    fontFamily: 'monospace', fontSize: 14, fontWeight: 700,
                    letterSpacing: '0.08em', color: indicator.color,
                    display: 'inline-flex', alignItems: 'center',
                  }}>
                    [
                    {indicator.dot && (
                      <span style={{
                        width: 9, height: 9, borderRadius: '50%',
                        background: ERROR_RED, display: 'inline-block', flexShrink: 0,
                        animation: 'rec-blink 1s step-start infinite',
                      }} />
                    )}
                    {indicator.text}]
                  </span>
                )}
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: MAX_BAR_H,
                gap: (showError || showProcessing) ? 0 : BAR_GAP,
              }}>
                {showError ? (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    gap: 8,
                    animation: 'error-flicker 2s linear infinite',
                  }}>
                    {(() => {
                      const msg = errorMessage || 'Error';
                      const dotIdx = msg.indexOf('.');
                      const line1 = dotIdx >= 0 ? msg.slice(0, dotIdx + 1) : msg;
                      const line2 = dotIdx >= 0 ? msg.slice(dotIdx + 1).trim() : '';
                      const lineStyle: React.CSSProperties = {
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 14,
                        fontWeight: 600,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: ERROR_RED,
                        textAlign: 'center',
                      };
                      return (
                        <>
                          <span style={lineStyle}>[ {line1} ]</span>
                          {line2 && <span style={{ ...lineStyle, fontSize: 12, fontWeight: 400 }}>{line2}</span>}
                        </>
                      );
                    })()}
                  </div>
                ) : showProcessing ? (
                  <span style={{
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                    fontSize: 16,
                    fontWeight: 500,
                    letterSpacing: '0.05em',
                    color: 'rgba(255,255,255,0.6)',
                    userSelect: 'none',
                    animation: 'processing-pulse 2s ease-in-out infinite',
                  }}>
                    {'Processing'}
                    <span style={{ display: 'inline-block', width: '1.5em', textAlign: 'left' }}>
                      {[0, 1, 2].map(i => (
                        <span
                          key={i}
                          style={{
                            animation: 'dot-blink 1.4s infinite',
                            animationDelay: `${i * 0.3}s`,
                            opacity: 0,
                          }}
                        >.</span>
                      ))}
                    </span>
                  </span>
                ) : (
                  Array.from({ length: BAR_COUNT }, (_, i) => {
                    const barColor = isError ? ERROR_RED : BASE_COLOR;

                    let transform: string;
                    let animation = 'none';
                    let transition = 'transform 0.3s ease-out';
                    let barOpacity: number;
                    if (isInitializing) {
                      transform  = `scaleY(${IDLE_SCALES[i]})`;
                      animation  = `maxi-init 1s ease-in-out ${INIT_DELAYS[i]}s infinite`;
                      transition = 'none';
                      barOpacity = 0.65;
                    } else if (isRecording) {
                      transform  = `scaleY(${(MIN_BAR_H / MAX_BAR_H).toFixed(4)})`;
                      transition = 'none';
                      barOpacity = 0.92;
                    } else if (isDone) {
                      transform  = `scaleY(${IDLE_SCALES[i]})`;
                      barOpacity = 0.35;
                    } else if (isError) {
                      transform  = 'scaleY(0.3)';
                      barOpacity = 0.9;
                    } else {
                      transform  = `scaleY(${IDLE_SCALES[i]})`;
                      barOpacity = 0.35;
                    }

                    return (
                      <div
                        key={i}
                        ref={el => { barElemsRef.current[i] = el; }}
                        style={{
                          width: BAR_WIDTH,
                          height: MAX_BAR_H,
                          borderRadius: 1.5,
                          background: barColor,
                          transformOrigin: 'center',
                          flexShrink: 0,
                          transform,
                          animation,
                          transition,
                          opacity: barOpacity,
                          ...(isInitializing && { '--init-idle': IDLE_SCALES[i], '--init-peak': INIT_PEAK_SCALE }),
                        } as React.CSSProperties}
                      />
                    );
                  })
                )}
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 0, paddingTop: 7, whiteSpace: 'nowrap',
              }}>
                <ShortcutEntry label={recLabel}  raw={recShortcut} />
                {hotkeyMode === 'toggle' && (
                  <>
                    <Divider />
                    <ShortcutEntry label="Cancel"    raw={shortcuts.cancelRecording} />
                  </>
                )}
            </div>
        </div>
      </div>
    </div>
  );
}

function ShortcutEntry({ label, raw }: { label: string; raw: string }) {
  const keys = raw.split('+').map(formatKey);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: '22px' }}>{label}</span>
      {keys.map((k, i) => <KeyBadge key={i} k={k} />)}
    </span>
  );
}

function KeyBadge({ k }: { k: string }) {
  return (
    <span style={{
      padding: '2px 6px',
      borderRadius: 4,
      background: 'rgba(255,255,255,0.07)',
      border: '1px solid rgba(255,255,255,0.12)',
      color: 'rgba(255,255,255,0.45)',
      fontSize: 11,
      fontFamily: 'monospace',
      display: 'inline-block',
    }}>
      {k}
    </span>
  );
}

function Divider() {
  return <span style={{ color: '#2a2a2a', margin: '0 9px' }}>|</span>;
}
