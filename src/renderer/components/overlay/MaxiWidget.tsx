import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RecordingState, HotkeyMode, AppSettings } from '../../../shared/types';

interface MaxiWidgetProps {
  voiceLevel: number;
  state: RecordingState;
  shortcuts: AppSettings['hotkey']['shortcuts'];
  hotkeyMode: HotkeyMode;
}

const BAR_COUNT  = 40;
const BAR_WIDTH  = 3;
const BAR_GAP    = 3;
const MAX_BAR_H  = 96;
const MIN_BAR_H  = 2.5; // baseline height in pixels — always visible in silence

// ─── LERP smoothing factors ────────────────────────────────────────────────
// Range: 0 = frozen, 1 = instant. Tweakable here.
// ATTACK: how fast bars rise toward a loud peak (higher = more responsive)
// RELEASE: how fast bars fall back to silence (lower = slower, smoother decay)
const LERP_ATTACK  = 0.65;
const LERP_RELEASE = 0.12;

const RED       = '#EF4444';
const ORANGE    = '#FB923C';
const ERROR_RED = '#F87171';
const BASE_COLOR = 'rgba(255,255,255,0.88)';

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

// Staggered delays for transcribing scanner animation
const TRANSCRIBE_DELAYS = Array.from({ length: BAR_COUNT }, (_, i) =>
  (i * 0.025).toFixed(3)
);

// Idle height per bar — tiny spindle silhouette while waiting
const IDLE_SCALES = HANNING_WEIGHTS.map(w =>
  ((MIN_BAR_H + w * 6) / MAX_BAR_H).toFixed(4)
);

const KEYFRAMES = `
@keyframes rec-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.2; }
}
@keyframes maxi-error-shake {
  0%        { transform: translateX(0); }
  20%       { transform: translateX(4px); }
  40%       { transform: translateX(-4px); }
  60%       { transform: translateX(3px); }
  80%, 100% { transform: translateX(0); }
}
@keyframes maxi-transcribe {
  0%, 100% { transform: scaleY(0.3); }
  50%      { transform: scaleY(0.85); }
}
@keyframes maxi-done-collapse {
  from { transform: scaleY(var(--from-scale, 0.15)); }
  to   { transform: scaleY(0.05); }
}
`;

export function MaxiWidget({ voiceLevel, state, shortcuts, hotkeyMode }: MaxiWidgetProps) {
  const [isDragging, setIsDragging] = useState(false);

  // ─── Audio visualization refs (no React state — updated in RAF loop) ────
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

  const isRecording    = state === 'recording';
  const isTranscribing = state === 'transcribing' || state === 'processing';
  const isDone         = state === 'done';
  const isError        = state === 'error';

  // ─── Start / stop visualization based on recording state ────────────────
  useEffect(() => {
    if (!isRecording) {
      stopVisualization();
      return;
    }
    startVisualization();
    return stopVisualization;
  }, [isRecording]);

  // ─── Issue 3: capture actual bar heights for done-collapse animation ─────
  // useLayoutEffect fires before paint, so --from-scale is set before the CSS
  // animation reads it — bars collapse from wherever they actually were, not 0.15
  useLayoutEffect(() => {
    if (!isDone) return;
    for (let i = 0; i < BAR_COUNT; i++) {
      const el = barElemsRef.current[i];
      if (el) {
        el.style.setProperty('--from-scale', (smoothedRef.current[i] / MAX_BAR_H).toFixed(4));
      }
    }
  }, [isDone]);

  async function startVisualization() {
    // Try to get a real audio stream for per-bar amplitude data.
    // If getUserMedia fails (e.g. exclusive-access device), fall back to the
    // voiceLevel prop — bars will still pulse with a Hanning-shaped envelope.
    let localAnalyser: AnalyserNode | null = null;
    let dataArray: Uint8Array | null = null;
    let samplesPerBar = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      const ctx = new AudioContext();
      await ctx.resume(); // required in some browsers after no user gesture
      audioCtxRef.current = ctx;

      const analyser = ctx.createAnalyser();
      // fftSize controls time-domain buffer size; larger = more detail per bar
      analyser.fftSize = 1024;
      analyserRef.current = analyser;
      localAnalyser = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser); // visualization-only — not recorded

      dataArray    = new Uint8Array(analyser.fftSize);
      samplesPerBar = Math.floor(analyser.fftSize / BAR_COUNT);
    } catch (err) {
      console.warn('[MaxiWidget] getUserMedia failed, falling back to voiceLevel prop:', err);
    }

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

          // Apply Hanning window — spindle / diamond shape
          const enveloped = peak * HANNING_WEIGHTS[i];
          const targetH   = MIN_BAR_H + enveloped * (MAX_BAR_H - MIN_BAR_H);

          // LERP smoothing: new = old + (target - old) * factor
          const current = smoothedRef.current[i];
          const factor  = targetH > current ? LERP_ATTACK : LERP_RELEASE;
          smoothedRef.current[i] = current + (targetH - current) * factor;
        }
      } else {
        // Fallback path: single scalar distributed across bars via Hanning envelope.
        // Visually identical shape — just uniform rather than per-bar detail.
        const level = Math.pow(Math.min(1, Math.max(0, voiceLevelRef.current)), 0.45);
        for (let i = 0; i < BAR_COUNT; i++) {
          const enveloped = level * HANNING_WEIGHTS[i];
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
    return () => { window.dictator.widgetDragEnd(); };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    window.dictator.widgetDragStart(e.screenX - window.screenX, e.screenY - window.screenY);
    setIsDragging(true);
    const onUp = () => {
      window.dictator.widgetDragEnd();
      setIsDragging(false);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mouseup', onUp);
  }, []);

  // ─── Rendering ───────────────────────────────────────────────────────────
  const indicator = isRecording
    ? { dot: true,  text: 'REC',   color: RED }
    : isTranscribing
      ? { dot: false, text: 'PROC',  color: ORANGE }
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
          borderRadius: 8,
          background: 'rgba(0,0,0,0.01)',
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        {/* Pill card */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '10px 20px 8px',
            borderRadius: 8,
            background: '#000000',
            border: '1.5px solid #000000',
            minWidth: 380,
            animation: isError ? 'maxi-error-shake 0.3s ease-in-out 2' : 'none',
          } as React.CSSProperties}
        >
          {/* Row 1: Status indicator */}
          <div style={{ height: 17, display: 'flex', alignItems: 'center' }}>
            {indicator && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {indicator.dot && (
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: RED, display: 'inline-block', flexShrink: 0,
                    animation: 'rec-blink 1s ease-in-out infinite',
                  }} />
                )}
                <span style={{
                  fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.08em', color: indicator.color,
                }}>
                  {indicator.text}
                </span>
              </div>
            )}
          </div>

          {/* Row 2: Waveform bars
              Bars expand symmetrically up & down from center (transformOrigin: center).
              During recording, RAF loop overrides transform/animation directly on the DOM.
              All other states use CSS transitions/animations declared here. */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: MAX_BAR_H,
            gap: BAR_GAP,
          }}>
            {Array.from({ length: BAR_COUNT }, (_, i) => {
              const barColor = isError ? ERROR_RED : isTranscribing ? ORANGE : BASE_COLOR;

              let transform: string;
              let animation = 'none';
              let transition = 'transform 0.3s ease-out';
              let barOpacity: number;

              if (isRecording) {
                // RAF takes over immediately — set neutral starting point
                transform  = `scaleY(${(MIN_BAR_H / MAX_BAR_H).toFixed(4)})`;
                transition = 'none';
                barOpacity = 0.92;
              } else if (isTranscribing) {
                transform  = 'scaleY(1)';
                animation  = `maxi-transcribe 1.2s linear ${TRANSCRIBE_DELAYS[i]}s infinite`;
                transition = 'none';
                barOpacity = 0.80;
              } else if (isDone) {
                transform  = 'scaleY(1)';
                animation  = 'maxi-done-collapse 400ms cubic-bezier(0.4, 0, 1, 1) forwards';
                barOpacity = 0.7;
              } else if (isError) {
                transform  = 'scaleY(0.3)';
                barOpacity = 0.9;
              } else {
                // idle — show faint spindle silhouette
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
                    borderRadius: 1,
                    background: barColor,
                    transformOrigin: 'center', // symmetric up + down expansion
                    flexShrink: 0,
                    transform,
                    animation,
                    transition,
                    opacity: barOpacity,
                  } as React.CSSProperties}
                />
              );
            })}
          </div>

          {/* Row 3: Keyboard shortcuts */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 0, paddingTop: 7, whiteSpace: 'nowrap',
          }}>
            <ShortcutEntry label="Mode"      raw={shortcuts.modeSelect} />
            <Divider />
            <ShortcutEntry label={recLabel}  raw={recShortcut} />
            <Divider />
            <ShortcutEntry label="Cancel"    raw={shortcuts.cancelRecording} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ShortcutEntry({ label, raw }: { label: string; raw: string }) {
  const keys = raw.split('+').map(formatKey);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#555555' }}>{label}</span>
      {keys.map((k, i) => <KeyBadge key={i} k={k} />)}
    </span>
  );
}

function KeyBadge({ k }: { k: string }) {
  return (
    <span style={{
      padding: '1px 4px',
      borderRadius: 3,
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.18)',
      color: 'rgba(255,255,255,0.55)',
      fontSize: 9,
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
