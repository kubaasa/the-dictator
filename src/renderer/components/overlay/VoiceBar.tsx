import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordingState } from '../../../shared/types';

interface VoiceBarProps {
  voiceLevel: number;
  state: RecordingState;
  errorMessage?: string;
  onToggleRecording?: () => void;
}

const BAR_COUNT = 6;
const BASE_COLOR = 'rgba(255,255,255,0.85)';
const ERROR_COLOR = '#DC2626';
const MIN_BAR_H = 2;
const MAX_BAR_H = 24;

const LERP_ATTACK  = 0.75;
const LERP_RELEASE = 0.18;

const HANNING_WEIGHTS = Array.from({ length: BAR_COUNT }, () => 1.0);

const IDLE_SCALES = HANNING_WEIGHTS.map(w =>
  ((MIN_BAR_H + w * 3) / MAX_BAR_H).toFixed(4)
);

const CASCADE_PEAK_SCALE = (MAX_BAR_H * 0.7 / MAX_BAR_H).toFixed(4);
const CASCADE_DELAYS = Array.from({ length: BAR_COUNT }, (_, i) =>
  (i * 0.05).toFixed(3)
);
const CASCADE_DELAYS_REV = Array.from({ length: BAR_COUNT }, (_, i) =>
  ((BAR_COUNT - 1 - i) * 0.05).toFixed(3)
);

const PROX_V = 20;
const PROX_H = 30;

const BARS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const norm = i / (BAR_COUNT - 1);
  const dist = Math.abs(norm - 0.5) * 2;

  const envelope = 1 - Math.pow(dist, 1.8) * 0.55;

  const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const rand = seed - Math.floor(seed);

  const multiplier = 0.75 + rand * 0.25;
  const jitter = 0.95 + rand * 0.1;
  const idleScale = (0.08 + envelope * 0.07).toFixed(3);

  return { envelope, multiplier, rand, jitter, idleScale };
});

const KEYFRAMES = `
@keyframes vb-wave {
  0%, 100% { transform: scaleY(0.15); }
  50%      { transform: scaleY(0.85); }
}
@keyframes vb-error-shake {
  0%        { transform: translateX(0); }
  20%       { transform: translateX(4px); }
  40%       { transform: translateX(-4px); }
  60%       { transform: translateX(3px); }
  80%, 100% { transform: translateX(0); }
}
@keyframes vb-cascade {
  0%   { transform: scaleY(0.05) translateZ(0); opacity: 0; }
  20%  { opacity: 1; }
  45%  { transform: scaleY(var(--cascade-peak, 0.7)) translateZ(0); }
  100% { transform: scaleY(var(--init-idle, 0.21)) translateZ(0); opacity: 0.88; }
}
@keyframes vb-error-flicker {
  0%, 12%, 40%, 57%, 74%, 90%, 100% { opacity: 1; }
  3%  { opacity: 0.4; }
  6%  { opacity: 0.9; }
  9%  { opacity: 0.3; }
  55% { opacity: 0.7; }
  72% { opacity: 0.4; }
  92% { opacity: 0.6; }
}
@keyframes vb-processing-pulse {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 1; }
}
`;

type AnimPhase = 'idle' | 'entering' | 'active' | 'exiting';

export function VoiceBar({ voiceLevel, state, errorMessage, onToggleRecording }: VoiceBarProps) {
  const barWidth = 3;
  const gap      = 3;

  const isInitializing = state === 'initializing';
  const isRecording    = state === 'recording';
  const isTranscribing = state === 'transcribing' || state === 'processing';
  const isDone         = state === 'done';
  const isError        = state === 'error';
  const isIdle         = !isInitializing && !isRecording && !isTranscribing && !isDone && !isError;

  const [isProximate, setIsProximate] = useState(false);

  const [errorFlash, setErrorFlash] = useState(false);
  const [animPhase, setAnimPhase] = useState<AnimPhase>('idle');
  const [cascadeKey, setCascadeKey] = useState(0);

  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragMouseUpRef = useRef<(() => void) | null>(null);
  const errorFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevIsActiveRef = useRef(false);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const isExiting = animPhase === 'exiting';
  const showError = isError || (wasErrorRef.current && isExiting);
  const showProcessing = isTranscribing || (!showError && wasProcessingRef.current && isExiting);

  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }

    if (isActive && (!wasActive || animPhase === 'exiting')) {
      setAnimPhase('entering');
      animTimerRef.current = setTimeout(() => setAnimPhase('active'), 270);
    } else if (!isActive && wasActive) {
      setAnimPhase('exiting');
      animTimerRef.current = setTimeout(() => setAnimPhase('idle'), 250);
    }

    return () => {
      if (animTimerRef.current) {
        clearTimeout(animTimerRef.current);
        animTimerRef.current = null;
      }
    };
  }, [isActive]);

  useEffect(() => {
    if (isInitializing) setCascadeKey(k => k + 1);
  }, [isInitializing]);

  // Expand on error — show error for 3s then collapse
  useEffect(() => {
    if (isError) {
      setErrorFlash(true);
      errorFlashTimer.current = setTimeout(() => setErrorFlash(false), 3000);
    } else {
      setErrorFlash(false);
    }
    return () => { if (errorFlashTimer.current) clearTimeout(errorFlashTimer.current); };
  }, [isError]);

  useEffect(() => {
    if (isDone) setIsProximate(false);
  }, [isDone]);

  const barElemsRef   = useRef<(HTMLDivElement | null)[]>([]);
  const smoothedRef   = useRef<Float32Array>(new Float32Array(BAR_COUNT).fill(MIN_BAR_H));
  const voiceLevelRef = useRef(0);
  const rafRef        = useRef<number>(0);

  useEffect(() => { voiceLevelRef.current = voiceLevel; }, [voiceLevel]);

  const handleEnter = useCallback(() => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setIsProximate(true);
  }, []);

  const handleLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => setIsProximate(false), 150);
  }, []);

  const handleMove = useCallback(() => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setIsProximate(true);
  }, []);

  useEffect(() => {
    return () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      if (dragMouseUpRef.current) {
        document.removeEventListener('mouseup', dragMouseUpRef.current);
        dragMouseUpRef.current = null;
      }
      window.dictator.widgetDragEnd();
    };
  }, []);

  const handleWrapperMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();

    const offsetX = e.screenX - window.screenX;
    const offsetY = e.screenY - window.screenY;
    window.dictator.widgetDragStart(offsetX, offsetY);

    const onUp = () => {
      window.dictator.widgetDragEnd();
      document.removeEventListener('mouseup', onUp);
      dragMouseUpRef.current = null;
    };

    dragMouseUpRef.current = onUp;
    document.addEventListener('mouseup', onUp);
  }, []);

  // Voice-level driven visualization — uses IPC voiceLevel from the recording worklet
  // instead of opening a second mic stream (which blocks on many Windows audio drivers).
  useEffect(() => {
    if (!isRecording) {
      cancelAnimationFrame(rafRef.current);
      smoothedRef.current.fill(MIN_BAR_H);
      return;
    }

    const tick = () => {
      const level = Math.min(1, Math.pow(Math.min(1, Math.max(0, voiceLevelRef.current)), 0.3) * 1.5);
      const t = performance.now() / 1000;
      for (let i = 0; i < BAR_COUNT; i++) {
        const { rand, multiplier } = BARS[i];
        // Three overlapping sine waves per bar — each bar oscillates independently,
        // creating organic waveform-like motion instead of uniform expansion/contraction
        const w1 = Math.sin(t * 2.3 + i * 0.9 + rand * 6.28);
        const w2 = Math.sin(t * 3.7 + i * 1.4 + rand * 4.19) * 0.6;
        const w3 = Math.sin(t * 1.1 + i * 2.3 + rand * 2.09) * 0.3;
        const oscillation = (w1 + w2 + w3) / 3.8 + 0.5;
        const barLevel = level * (0.3 + 0.7 * oscillation) * multiplier;
        const targetH = MIN_BAR_H + barLevel * (MAX_BAR_H - MIN_BAR_H);
        const current = smoothedRef.current[i];
        const factor = targetH > current ? LERP_ATTACK : LERP_RELEASE;
        smoothedRef.current[i] = current + (targetH - current) * factor;
      }

      for (let i = 0; i < BAR_COUNT; i++) {
        const el = barElemsRef.current[i];
        if (el) {
          const scaleY = (smoothedRef.current[i] / MAX_BAR_H).toFixed(4);
          el.style.transform = `scaleY(${scaleY}) translateZ(0)`;
          el.style.transition = 'none';
          el.style.animation = 'none';
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      smoothedRef.current.fill(MIN_BAR_H);
    };
  }, [isRecording]);

  const isExpanded = isProximate || isInitializing || isRecording || isTranscribing || isDone || errorFlash;

  const collapsedH = 12;
  const expandedH  = MAX_BAR_H + gap * 6;

  const pillHeight = isExpanded ? expandedH : collapsedH;

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{KEYFRAMES}</style>

      {/* Proximity wrapper: rgba bg forces mouse events on Electron transparent window */}
      <div
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onMouseMove={handleMove}
        onMouseDown={handleWrapperMouseDown}
        style={{
          padding: `${PROX_V}px ${PROX_H}px`,
          borderRadius: 9999,
          background: 'rgba(0,0,0,0.01)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'default',
        } as React.CSSProperties}
      >
        <div
          style={{
            position: 'relative',
            width: 'fit-content',
            height: pillHeight,
            borderRadius: 9999,
            background: 'rgba(10, 10, 10, 0.75)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: 'none',
            boxShadow: '0 2px 12px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.06)',
            WebkitAppRegion: 'no-drag',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap,
            overflow: 'hidden',
            padding: `0 ${gap * 3}px`,
            boxSizing: 'border-box',
            transition: 'height 420ms cubic-bezier(0.4, 0, 0.2, 1)',
            animation: isError ? 'vb-error-shake 0.3s ease-in-out 2' : 'none',
          } as React.CSSProperties}
        >
          {(isIdle || isRecording) && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                borderRadius: 9999,
                pointerEvents: 'none',
                opacity: isProximate ? 1 : 0,
                transition: 'opacity 180ms ease, transform 180ms ease',
                transform: isProximate ? 'scale(1)' : 'scale(0.95)',
                zIndex: 10,
              } as React.CSSProperties}
            >
              <button
                onMouseDown={(e) => { e.preventDefault(); onToggleRecording?.(); }}
                style={{
                  WebkitAppRegion: 'no-drag',
                  cursor: 'default',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: isProximate ? 'auto' : 'none',
                } as React.CSSProperties}
              >
                {isRecording ? (
                  <svg width={Math.round(MAX_BAR_H * 0.75)} height={Math.round(MAX_BAR_H * 0.75)} viewBox="0 0 24 24">
                    <rect x="5" y="5" width="14" height="14" rx="2.5" fill="rgba(255,255,255,0.92)" />
                  </svg>
                ) : (
                  <svg width={Math.round(MAX_BAR_H * 0.75)} height={Math.round(MAX_BAR_H * 0.75)} viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="#EF4444" strokeWidth="1.5" />
                    <circle cx="12" cy="12" r="6" fill="#EF4444" />
                  </svg>
                )}
              </button>
            </div>
          )}

          {showError ? (
            <div
              title={errorMessage}
              aria-label={errorMessage || 'Error'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 4px',
                minWidth: BAR_COUNT * barWidth + (BAR_COUNT - 1) * gap,
                opacity: isExpanded ? 1 : 0,
                transition: 'opacity 200ms ease-out',
                animation: 'vb-error-flicker 2s linear infinite',
              }}>
              <svg
                width={18}
                height={18}
                viewBox="0 0 24 24"
                style={{ flexShrink: 0 }}
              >
                <line x1="6" y1="6" x2="18" y2="18" stroke={ERROR_COLOR} strokeWidth={2.5} strokeLinecap="round" />
                <line x1="18" y1="6" x2="6" y2="18" stroke={ERROR_COLOR} strokeWidth={2.5} strokeLinecap="round" />
              </svg>
            </div>
          ) : showProcessing ? (
            BARS.map((_, i) => (
              <div
                key={`proc-${i}-${cascadeKey}`}
                ref={el => { barElemsRef.current[i] = el; }}
                style={{
                  width: barWidth,
                  height: MAX_BAR_H,
                  borderRadius: barWidth / 2,
                  background: BASE_COLOR,
                  transformOrigin: 'center',
                  flexShrink: 0,
                  willChange: 'transform',
                  backfaceVisibility: 'hidden',
                  transform: 'scaleY(0.05) translateZ(0)',
                  animation: `vb-cascade 350ms ease-out ${CASCADE_DELAYS_REV[i]}s both`,
                  transition: 'none',
                  opacity: isExpanded ? 0.92 : 0,
                  '--init-idle': IDLE_SCALES[i],
                  '--cascade-peak': CASCADE_PEAK_SCALE,
                } as React.CSSProperties}
              />
            ))
          ) : (
            BARS.map((bar, i) => {
                const { idleScale } = bar;

                let transform: string | undefined;
                let animation = 'none';
                let transition = 'transform 0.3s ease-out, opacity 180ms ease-out';
                let barOpacity: number;
                const barColor = BASE_COLOR;

                if (isInitializing) {
                  transform = `scaleY(0.05) translateZ(0)`;
                  animation = `vb-cascade 350ms ease-out ${CASCADE_DELAYS[i]}s both`;
                  transition = 'none';
                  barOpacity = 0.92;

                } else if (isIdle) {
                  transform = `scaleY(${idleScale})`;
                  barOpacity = 0.88;

                } else if (isRecording) {
                  transform = `scaleY(${(MIN_BAR_H / MAX_BAR_H).toFixed(4)})`;
                  // Keep opacity transition for smooth bar reveal when hover ends
                  transition = 'opacity 180ms ease-out';
                  barOpacity = 0.92;

                } else if (isDone) {
                  transform = 'scaleY(0.05)';
                  barOpacity = 0;

                } else {
                  transform = 'scaleY(0.3)';
                  barOpacity = 0.9;
                }

                const buttonVisible = isProximate && (isIdle || isRecording);
                const finalOpacity = buttonVisible ? 0 : (isExpanded ? barOpacity : 0);

                return (
                  <div
                    key={isInitializing ? `${i}-${cascadeKey}` : i}
                    ref={el => { barElemsRef.current[i] = el; }}
                    style={{
                      width: barWidth,
                      height: MAX_BAR_H,
                      borderRadius: barWidth / 2,
                      background: barColor,
                      transformOrigin: 'center',
                      flexShrink: 0,
                      willChange: 'transform',
                      backfaceVisibility: 'hidden',
                      transform,
                      animation,
                      transition,
                      opacity: finalOpacity,
                      ...(isInitializing && { '--init-idle': IDLE_SCALES[i], '--cascade-peak': CASCADE_PEAK_SCALE }),
                    } as React.CSSProperties}
                  />
                );
              })
          )}
        </div>
      </div>
    </div>
  );
}
