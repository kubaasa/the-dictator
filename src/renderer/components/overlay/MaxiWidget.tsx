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
const MIN_BAR_H  = 2.5; // baseline height in pixels — always visible in silence

// ─── LERP smoothing factors ────────────────────────────────────────────────
// Range: 0 = frozen, 1 = instant. Tweakable here.
// ATTACK: how fast bars rise toward a loud peak (higher = more responsive)
// RELEASE: how fast bars fall back to silence (lower = slower, smoother decay)
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

// ─── Hanning window envelope ───────────────────────────────────────────────
// Creates the "spindle / diamond" shape: center bars reach full amplitude,
// edge bars are attenuated to zero regardless of how loud the user speaks.
//
// Formula: w(i) = sin²( π * i / (N - 1) )
//   i = 0      → sin(0)   = 0.0  → fully attenuated (left edge)
//   i = N/2    → sin(π/2) = 1.0  → full amplitude   (center)
//   i = N-1    → sin(π)   = 0.0  → fully attenuated (right edge)
const HANNING_WEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) =>
  Math.pow(Math.sin(Math.PI * i / (BAR_COUNT - 1)), 2)
);

// Idle height per bar — tiny spindle silhouette while waiting
const IDLE_SCALES = HANNING_WEIGHTS.map(w =>
  ((MIN_BAR_H + w * 6) / MAX_BAR_H).toFixed(4)
);

// Init animation: uniform peak height for wave effect
const INIT_PEAK_SCALE = ((MIN_BAR_H + MAX_BAR_H * 0.2) / MAX_BAR_H).toFixed(4);

// Init animation: 3 simultaneous waves flowing right-to-left
// Negative delays = all bars start immediately but at different phases spanning 3 full cycles
const INIT_DELAYS = Array.from({ length: BAR_COUNT }, (_, i) => {
  return (-((BAR_COUNT - 1 - i) / (BAR_COUNT - 1)) * 3).toFixed(3);
});

// Pre-computed per-bar properties for organic variation during recording
const BAR_PROPS = Array.from({ length: BAR_COUNT }, (_, i) => {
  // Stable pseudo-random seed per bar
  const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const rand = seed - Math.floor(seed);

  // Each bar reacts at slightly different gain (0.80–1.0)
  const multiplier = 0.80 + rand * 0.20;

  // Micro-jitter factor per bar (±5%)
  const jitter = 0.95 + rand * 0.1;

  return { multiplier, jitter };
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
  from { opacity: 0; transform: scale(0.9); }
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

  // ─── Audio visualization refs (no React state — updated in RAF loop) ────
  const vizActiveRef   = useRef(false); // guards async getUserMedia against cleanup races
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const analyserRef    = useRef<AnalyserNode | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const rafRef         = useRef<number>(0);
  // Latest voiceLevel from prop — updated via effect so the RAF closure can read it
  const voiceLevelRef  = useRef(0);
  // Smoothed bar heights in pixels — persists across animation frames
  const smoothedRef    = useRef<Float32Array>(new Float32Array(BAR_COUNT).fill(MIN_BAR_H));
  // Direct DOM refs for each bar — bypasses React render cycle in hot RAF loop
  const barElemsRef    = useRef<(HTMLDivElement | null)[]>([]);

  // Keep voiceLevelRef in sync with the prop (no re-render needed)
  useEffect(() => { voiceLevelRef.current = voiceLevel; }, [voiceLevel]);

  const isInitializing = state === 'initializing';
  const isRecording    = state === 'recording';
  const isTranscribing = state === 'transcribing' || state === 'processing';
  const isDone         = state === 'done';
  const isError        = state === 'error';

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

  // ─── Enter / exit animation state machine ────────────────────────────────
  const isActive = isInitializing || isRecording || isTranscribing || isDone || isError;

  // Track whether the widget was showing error/processing content — sticky until next activation.
  // Prevents bars from flashing during the exit animation after processing or error.
  const wasErrorRef = useRef(false);
  const wasProcessingRef = useRef(false);

  // Clear stickiness synchronously during render (before computing showError/showProcessing)
  // to prevent a one-frame flash of stale processing/error content on new activation
  if (isActive && !prevIsActiveRef.current) {
    wasErrorRef.current = false;
    wasProcessingRef.current = false;
  }

  if (isError) wasErrorRef.current = true;
  if (isTranscribing || isDone) wasProcessingRef.current = true;

  const showError = isError || (wasErrorRef.current && (animPhase === 'exiting' || !isActive));
  const showProcessing = isTranscribing || isDone || (wasProcessingRef.current && (animPhase === 'exiting' || !isActive));
  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (isActive && !wasActive) {
      setAnimPhase('entering');
      const t = setTimeout(() => setAnimPhase('active'), 320);
      return () => clearTimeout(t);
    } else if (!isActive && wasActive) {
      setAnimPhase('exiting');
    }
  }, [isActive]);

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
    // Try to get a real audio stream for per-bar amplitude data.
    // If getUserMedia fails (e.g. exclusive-access device), fall back to the
    // voiceLevel prop — bars will still pulse with a Hanning-shaped envelope.
    let localAnalyser: AnalyserNode | null = null;
    let dataArray: Uint8Array | null = null;
    let samplesPerBar = 0;

    try {
      const audioConstraints: MediaTrackConstraints = audioDeviceId
        ? { deviceId: { exact: audioDeviceId } }
        : {};
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...audioConstraints }, video: false });

      // Guard: cleanup ran while we were awaiting — release stream immediately
      if (!vizActiveRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;

      const ctx = new AudioContext();
      await ctx.resume();

      // Guard: check again after second await
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

    // Final guard before starting RAF loop
    if (!vizActiveRef.current) return;

    const tick = () => {
      if (localAnalyser && dataArray) {
        // Real audio path: per-bar peak amplitude from time-domain buffer
        localAnalyser.getByteTimeDomainData(dataArray);

        for (let i = 0; i < BAR_COUNT; i++) {
          let peak = 0;
          const offset = i * samplesPerBar;
          for (let s = 0; s < samplesPerBar; s++) {
            const amplitude = Math.abs(dataArray[offset + s] - 128) / 128; // 0–1
            if (amplitude > peak) peak = amplitude;
          }

          // Speech amplitudes are typically 0.05–0.15 — boost ×4 so bars fill the widget
          const boosted = Math.min(1, peak * 4);
          // Per-bar variation: multiplier + jitter for organic movement
          const varied = boosted * BAR_PROPS[i].multiplier * BAR_PROPS[i].jitter;
          // Apply Hanning window — spindle / diamond shape
          const enveloped = varied * HANNING_WEIGHTS[i];
          const targetH   = MIN_BAR_H + enveloped * (MAX_BAR_H - MIN_BAR_H);

          // LERP smoothing: new = old + (target - old) * factor
          const current = smoothedRef.current[i];
          const factor  = targetH > current ? LERP_ATTACK : LERP_RELEASE;
          smoothedRef.current[i] = current + (targetH - current) * factor;
        }
      } else {
        // Fallback path: single scalar distributed across bars via Hanning envelope.
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

      // Write directly to DOM — avoids React re-render at 60fps
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

  // ─── Drag logic ──────────────────────────────────────────────────────────
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

  // ─── Rendering ───────────────────────────────────────────────────────────
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
            animPhase === 'entering' ? 'maxi-enter 300ms ease-out both' :
            animPhase === 'exiting'  ? 'maxi-exit 250ms ease-in both'   :
            'none',
        }}
      >
        {/* Pill card */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '10px 20px 8px',
            borderRadius: 20,
            background: 'rgba(10, 10, 10, 0.75)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.06)',
            minWidth: 500,
            animation: 'none',
          } as React.CSSProperties}
        >
          <>
              {/* Row 1: Status indicator */}
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

              {/* Row 2: Waveform bars / Processing text */}
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
                      {processingDots}
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

              {/* Row 3: Keyboard shortcuts */}
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
            </>
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
