import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordingState } from '../../../shared/types';

interface VoiceBarProps {
  voiceLevel: number;
  state: RecordingState;
  onToggleRecording?: () => void;
}

const BAR_COUNT = 6;
const BASE_COLOR = 'rgba(255,255,255,0.88)';
const ERROR_COLOR = '#F87171';
const MIN_BAR_H = 2;
const MAX_BAR_H = 30;

// LERP smoothing factors — tuned for 6 bars (more responsive than MAXI's 40-bar defaults)
const LERP_ATTACK  = 0.75;
const LERP_RELEASE = 0.18;

// Flat envelope — all 6 bars react at full amplitude
const HANNING_WEIGHTS = Array.from({ length: BAR_COUNT }, () => 1.0);

// Idle height per bar — tiny spindle silhouette while waiting
const IDLE_SCALES = HANNING_WEIGHTS.map(w =>
  ((MIN_BAR_H + w * 3) / MAX_BAR_H).toFixed(4)
);

// Init animation peak height
const INIT_PEAK_SCALE = ((MIN_BAR_H + MAX_BAR_H * 0.2) / MAX_BAR_H).toFixed(4);

// Init animation: 3 simultaneous waves flowing right-to-left (negative delays)
const INIT_DELAYS = Array.from({ length: BAR_COUNT }, (_, i) =>
  (-((BAR_COUNT - 1 - i) / (BAR_COUNT - 1)) * 3).toFixed(3)
);

// Proximity zone padding around the pill (px)
const PROX_V = 20;
const PROX_H = 30;

// Pre-computed per-bar properties — stable across renders
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const norm = i / (BAR_COUNT - 1);
  const dist = Math.abs(norm - 0.5) * 2; // 0 = center, 1 = edges

  // Bell-curve envelope: center bars can reach full height, edge bars ~45%
  const envelope = 1 - Math.pow(dist, 1.8) * 0.55;

  // Stable pseudo-random seed per bar
  const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const rand = seed - Math.floor(seed);

  // Each bar reacts at slightly different gain (0.75–1.0)
  const multiplier = 0.75 + rand * 0.25;

  // Micro-jitter factor per bar (±5%)
  const jitter = 0.95 + rand * 0.1;

  // Idle: static height based on bell-curve (~15% max height)
  const idleScale = (0.08 + envelope * 0.07).toFixed(3);

  // Silence animation delay: index * 80ms
  const silenceDelay = (i * 0.08).toFixed(2);

  return {
    envelope, multiplier, rand, jitter,
    idleScale, silenceDelay,
  };
});

// Keyframes injected once
const KEYFRAMES = `
@keyframes vb-silence {
  0%, 100% { transform: scaleY(0.1); }
  50%      { transform: scaleY(0.2); }
}
@keyframes vb-done-collapse {
  from { transform: scaleY(var(--from-scale, 0.15)); }
  to   { transform: scaleY(0.05); }
}
@keyframes vb-processing-glitch {
  0%, 92%, 100% { transform: translate(0, 0); opacity: 1; }
  93%           { transform: translate(-1px, 1px); opacity: 0.8; }
  95%           { transform: translate(1px, -1px); opacity: 0.6; }
  97%           { transform: translate(1px, 0); opacity: 0.9; }
}
@keyframes vb-error-shake {
  0%   { transform: translateX(0); }
  20%  { transform: translateX(3px); }
  40%  { transform: translateX(-3px); }
  60%  { transform: translateX(2px); }
  80%  { transform: translateX(0); }
  100% { transform: translateX(0); }
}
@keyframes vb-init {
  0%, 100% { transform: scaleY(var(--init-idle, 0.08)); }
  50%      { transform: scaleY(var(--init-peak, 0.28)); }
}
`;

export function VoiceBar({ voiceLevel, state, onToggleRecording }: VoiceBarProps) {
  const barWidth = 3;
  const gap      = 3;

  const isInitializing = state === 'initializing';
  const isRecording    = state === 'recording';
  const isTranscribing = state === 'transcribing' || state === 'processing';
  const isDone         = state === 'done';
  const isError        = state === 'error';
  const isIdle         = !isInitializing && !isRecording && !isTranscribing && !isDone && !isError;

  // ─── Processing dots cycling animation ─────────────────────────────────────
  const [processingDots, setProcessingDots] = useState('.');

  useEffect(() => {
    if (!isTranscribing) {
      setProcessingDots('.');
      return;
    }
    const id = setInterval(() => {
      setProcessingDots(prev => prev.length >= 3 ? '.' : prev + '.');
    }, 500);
    return () => clearInterval(id);
  }, [isTranscribing]);

  const [isProximate, setIsProximate] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragMouseUpRef = useRef<(() => void) | null>(null);

  // Reset proximity when recording cycle completes — mouseLeave can be missed
  // on transparent Electron windows during state transitions.
  // Next mouse movement over the widget will re-enable proximity via handleMove.
  useEffect(() => {
    if (isDone) setIsProximate(false);
  }, [isDone]);

  // ─── Audio visualization refs (no React state — updated in RAF loop) ────
  const barElemsRef   = useRef<(HTMLDivElement | null)[]>([]);
  const smoothedRef   = useRef<Float32Array>(new Float32Array(BAR_COUNT).fill(MIN_BAR_H));
  const voiceLevelRef = useRef(0);
  const vizActiveRef  = useRef(false);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const analyserRef   = useRef<AnalyserNode | null>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const rafRef        = useRef<number>(0);

  useEffect(() => { voiceLevelRef.current = voiceLevel; }, [voiceLevel]);

  const handleEnter = useCallback(() => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setIsProximate(true);
  }, []);

  const handleLeave = useCallback(() => {
    // Debounce collapse so spurious leave events don't cause flickering
    leaveTimer.current = setTimeout(() => setIsProximate(false), 150);
  }, []);

  // Re-enable proximity on mouse movement — recovers from the isDone reset
  // when the cursor is still physically over the widget
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

  // Manual drag: anywhere on wrapper/pill EXCEPT the record/stop button.
  // Main process tracks cursor globally (screen.getCursorScreenPoint) so fast movement can't escape.
  const handleWrapperMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();

    // Offset = cursor position relative to window top-left corner
    const offsetX = e.screenX - window.screenX;
    const offsetY = e.screenY - window.screenY;
    window.dictator.widgetDragStart(offsetX, offsetY);
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

  // ─── Start / stop visualization based on recording state ────────────────
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!vizActiveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;

      const ctx = new AudioContext();
      await ctx.resume();
      if (!vizActiveRef.current) { stream.getTracks().forEach(t => t.stop()); ctx.close(); return; }
      audioCtxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyserRef.current = analyser;
      localAnalyser = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      dataArray = new Uint8Array(analyser.fftSize);
      samplesPerBar = Math.floor(analyser.fftSize / BAR_COUNT);
    } catch (err) {
      console.warn('[VoiceBar] getUserMedia failed, falling back to voiceLevel prop:', err);
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
          // Speech amplitudes are typically 0.05–0.15 — boost ×4 so bars fill the small pill
          const boosted = Math.min(1, peak * 4);
          const enveloped = boosted * HANNING_WEIGHTS[i];
          const targetH = MIN_BAR_H + enveloped * (MAX_BAR_H - MIN_BAR_H);
          const current = smoothedRef.current[i];
          const factor = targetH > current ? LERP_ATTACK : LERP_RELEASE;
          smoothedRef.current[i] = current + (targetH - current) * factor;
        }
      } else {
        // Fallback: boost voiceLevel prop with aggressive curve for visibility
        const level = Math.min(1, Math.pow(Math.min(1, Math.max(0, voiceLevelRef.current)), 0.3) * 1.5);
        for (let i = 0; i < BAR_COUNT; i++) {
          const enveloped = level * HANNING_WEIGHTS[i];
          const targetH = MIN_BAR_H + enveloped * (MAX_BAR_H - MIN_BAR_H);
          const current = smoothedRef.current[i];
          const factor = targetH > current ? LERP_ATTACK : LERP_RELEASE;
          smoothedRef.current[i] = current + (targetH - current) * factor;
        }
      }

      for (let i = 0; i < BAR_COUNT; i++) {
        const el = barElemsRef.current[i];
        if (el) {
          const scaleY = (smoothedRef.current[i] / MAX_BAR_H).toFixed(4);
          el.style.transform = `scaleY(${scaleY})`;
          el.style.transition = 'none';
          el.style.animation = 'none';
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

  const isExpanded = isProximate || isInitializing || isRecording || isTranscribing || isError;

  const collapsedH = 12;
  const expandedH  = MAX_BAR_H + gap * 4;

  const pillHeight = isExpanded ? expandedH : collapsedH;

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{KEYFRAMES}</style>

      {/*
        Proximity wrapper: slightly larger than the pill (PROX_V / PROX_H padding).
        background: rgba(0,0,0,0.01) — alpha=1/255, visually invisible but forces Windows
        to route mouse events to this element even in a transparent Electron window.
      */}
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
          cursor: isDragging ? 'grabbing' : 'grab',
        } as React.CSSProperties}
      >
        {/* Pill container */}
        <div
          style={{
            position: 'relative',
            width: 'fit-content',
            height: pillHeight,
            borderRadius: 9999,
            background: 'rgba(8, 8, 8, 0.88)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '0.5px solid rgba(255,255,255,0.85)',
            boxShadow: 'none',
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
                background: 'rgba(8, 8, 8, 1)',
                borderRadius: 9999,
                pointerEvents: 'none',
                opacity: isProximate ? 1 : 0,
                transition: 'opacity 180ms ease',
                zIndex: 10,
              } as React.CSSProperties}
            >
              <button
                onMouseDown={(e) => { e.preventDefault(); onToggleRecording?.(); }}
                style={{
                  WebkitAppRegion: 'no-drag',
                  cursor: 'pointer',
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
                  // Stop: white rounded square
                  <svg width={Math.round(MAX_BAR_H * 0.75)} height={Math.round(MAX_BAR_H * 0.75)} viewBox="0 0 24 24">
                    <rect x="5" y="5" width="14" height="14" rx="2.5" fill="rgba(255,255,255,0.92)" />
                  </svg>
                ) : (
                  // Record: red circle with outer ring
                  <svg width={Math.round(MAX_BAR_H * 0.75)} height={Math.round(MAX_BAR_H * 0.75)} viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="#EF4444" strokeWidth="1.5" />
                    <circle cx="12" cy="12" r="6" fill="#EF4444" />
                  </svg>
                )}
              </button>
            </div>
          )}

          {isError ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              // Match the width of 6 bars + 5 gaps so the pill keeps its normal shape
              minWidth: BAR_COUNT * barWidth + (BAR_COUNT - 1) * gap,
            }}>
              <svg
                width={18}
                height={18}
                viewBox="0 0 24 24"
                style={{
                  opacity: isExpanded ? 1 : 0,
                  transition: 'opacity 200ms ease-out',
                  flexShrink: 0,
                }}
              >
                <line x1="6" y1="6" x2="18" y2="18" stroke={ERROR_COLOR} strokeWidth={2.5} strokeLinecap="round" />
                <line x1="18" y1="6" x2="6" y2="18" stroke={ERROR_COLOR} strokeWidth={2.5} strokeLinecap="round" />
              </svg>
            </div>
          ) : (
            isTranscribing ? (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: '0.05em',
                color: '#DC2626',
                userSelect: 'none',
                whiteSpace: 'pre',
                animation: 'vb-processing-glitch 4s linear infinite',
                display: 'inline-flex',
                justifyContent: 'center',
                width: BAR_COUNT * barWidth + (BAR_COUNT - 1) * gap,
              }}>
                {'['}
                {[0, 1, 2].map(i => (
                  <span key={i} style={{ opacity: i < processingDots.length ? 1 : 0, transition: 'none' }}>.</span>
                ))}
                {']'}
              </span>
            ) : (
              BARS.map((bar, i) => {
                const { idleScale } = bar;

                let transform: string | undefined;
                let animation = 'none';
                let transition = 'transform 0.3s ease-out, opacity 200ms ease-out';
                let barOpacity: number;

                if (isInitializing) {
                  transform = `scaleY(${IDLE_SCALES[i]})`;
                  animation = `vb-init 1s ease-in-out ${INIT_DELAYS[i]}s infinite`;
                  transition = 'none';
                  barOpacity = 0.92;

                } else if (isIdle) {
                  transform = `scaleY(${idleScale})`;
                  barOpacity = 0.88;

                } else if (isRecording) {
                  transform = `scaleY(${(MIN_BAR_H / MAX_BAR_H).toFixed(4)})`;
                  transition = 'none';
                  barOpacity = 0.92;

                } else if (isDone) {
                  transform = 'scaleY(0.05)';
                  barOpacity = 0;

                } else {
                  transform = 'scaleY(0.3)';
                  barOpacity = 0.9;
                }

                const finalOpacity = isExpanded ? barOpacity : 0;

                return (
                  <div
                    key={i}
                    ref={el => { barElemsRef.current[i] = el; }}
                    style={{
                      width: barWidth,
                      height: MAX_BAR_H,
                      borderRadius: barWidth / 2,
                      background: BASE_COLOR,
                      transformOrigin: 'center',
                      flexShrink: 0,
                      transform,
                      animation,
                      transition,
                      opacity: finalOpacity,
                      '--from-scale': idleScale,
                      ...(isInitializing && { '--init-idle': IDLE_SCALES[i], '--init-peak': INIT_PEAK_SCALE }),
                    } as React.CSSProperties}
                  />
                );
              })
            )
          )}
        </div>
      </div>
    </div>
  );
}
