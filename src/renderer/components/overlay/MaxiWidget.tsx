import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordingState, HotkeyMode, AppSettings } from '../../../shared/types';
import { formatShortcut } from './keys';

const NUM_BANDS = 8;

interface MaxiWidgetProps {
  voiceLevel: number;
  bandsRef: React.RefObject<number[] | null>;
  state: RecordingState;
  shortcuts: AppSettings['hotkey']['shortcuts'];
  hotkeyMode: HotkeyMode;
  errorMessage?: string;
  resultText?: string;
}

const BAR_COUNT = 50;
const MIN_BAR_H = 2.5;
const MAX_BAR_H = 36;
const DOT_COUNT = 7;

// LERP smoothing: 0 = frozen, 1 = instant
const LERP_ATTACK  = 0.75;
const LERP_RELEASE = 0.18;

// Hanning window: w(i) = sin²(π * i / (N-1)), spindle/diamond shape
const HANNING_WEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) =>
  Math.pow(Math.sin(Math.PI * i / (BAR_COUNT - 1)), 2)
);

// Per-bar pseudo-random variation for organic movement
const BAR_PROPS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const rand = seed - Math.floor(seed);
  return { multiplier: 0.80 + rand * 0.20, jitter: 0.95 + rand * 0.1 };
});

const DOTS = Array.from({ length: DOT_COUNT }, (_, i) => i);
const REST_SCALE = (MIN_BAR_H / MAX_BAR_H).toFixed(4);

type AnimPhase = 'idle' | 'entering' | 'active' | 'exiting';
type Visual = 'bars' | 'processing' | 'done' | 'error';

const BORDER_CLASS: Record<Visual, string> = {
  bars: 'border-widget-border',
  processing: 'border-widget-border',
  done: 'border-widget-ok/45',
  error: 'border-widget-error/75',
};

function formatTimer(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MaxiWidget({
  voiceLevel, bandsRef, state, shortcuts, hotkeyMode, errorMessage, resultText,
}: MaxiWidgetProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [animPhase, setAnimPhase] = useState<AnimPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const prevIsActiveRef = useRef(false);
  const dragMouseUpRef = useRef<(() => void) | null>(null);
  const recStartRef = useRef<number | null>(null);

  // Audio visualization refs, updated in RAF loop, not React state
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

  // 'done' counts as active so the paste confirmation stays on screen until main returns to idle
  const isActive = isInitializing || isRecording || isTranscribing || isDone || isError;

  // Sticky content: during the exit fade the state is already 'idle', keep showing what was last on screen
  const lastVisualRef = useRef<Visual>('bars');
  if (isError) lastVisualRef.current = 'error';
  else if (isDone) lastVisualRef.current = 'done';
  else if (isTranscribing) lastVisualRef.current = 'processing';
  else if (isInitializing || isRecording) lastVisualRef.current = 'bars';
  const visual = lastVisualRef.current;

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

  // Recording timer: starts with 'recording', freezes afterwards, resets on the next session
  useEffect(() => {
    if (isInitializing) {
      recStartRef.current = null;
      setElapsedMs(0);
    }
    if (!isRecording) return;
    if (recStartRef.current === null) recStartRef.current = performance.now();
    const id = setInterval(() => {
      setElapsedMs(performance.now() - (recStartRef.current ?? performance.now()));
    }, 250);
    return () => clearInterval(id);
  }, [isInitializing, isRecording]);

  // Voice-level driven visualization: uses IPC voiceLevel from the recording worklet
  // instead of opening a second mic stream (which blocks on many Windows audio drivers).
  useEffect(() => {
    if (!isRecording) {
      cancelAnimationFrame(rafRef.current);
      smoothedRef.current.fill(MIN_BAR_H);
      return;
    }

    const tick = () => {
      const bands = bandsRef.current;
      const level = Math.min(1, Math.pow(Math.min(1, Math.max(0, voiceLevelRef.current)), 0.25) * 1.8);
      for (let i = 0; i < BAR_COUNT; i++) {
        const { multiplier, jitter } = BAR_PROPS[i];

        // Interpolate 8 spectral bands (normalized shape 0-1) across the bars,
        // then scale by overall voice level for amplitude
        let bandShape: number;
        if (bands && bands.length === NUM_BANDS) {
          const pos = (i / (BAR_COUNT - 1)) * (NUM_BANDS - 1);
          const lo = Math.floor(pos);
          const hi = Math.min(lo + 1, NUM_BANDS - 1);
          const frac = pos - lo;
          bandShape = bands[lo] * (1 - frac) + bands[hi] * frac;
          // Ensure minimum bar variation even for quiet bands
          bandShape = 0.3 + 0.7 * bandShape;
        } else {
          bandShape = 1;
        }

        const barLevel = level * bandShape * multiplier * jitter;
        const enveloped = barLevel * HANNING_WEIGHTS[i];
        const targetH   = MIN_BAR_H + enveloped * (MAX_BAR_H - MIN_BAR_H);

        const current = smoothedRef.current[i];
        const factor  = targetH > current ? LERP_ATTACK : LERP_RELEASE;
        smoothedRef.current[i] = current + (targetH - current) * factor;
      }

      for (let i = 0; i < BAR_COUNT; i++) {
        const el = barElemsRef.current[i];
        if (el) {
          el.style.transform = `scaleY(${(smoothedRef.current[i] / MAX_BAR_H).toFixed(4)})`;
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

  const recShortcut = hotkeyMode === 'push-to-talk' ? shortcuts.pushToTalk : shortcuts.toggleRecording;
  const recLabel = hotkeyMode === 'push-to-talk' ? 'Hold to Rec' : 'Stop';

  const shortcutRow = visual === 'bars' ? (
    <>
      <ShortcutEntry label={recLabel} raw={recShortcut} />
      {hotkeyMode === 'toggle' && (
        <>
          <Divider />
          <ShortcutEntry label="Cancel" raw={shortcuts.cancelRecording} />
        </>
      )}
    </>
  ) : visual === 'processing' ? (
    <ShortcutEntry label="Cancel" raw={shortcuts.cancelRecording} />
  ) : visual === 'error' ? (
    <ShortcutEntry label="Dismiss" raw={shortcuts.cancelRecording} />
  ) : null;

  const capsuleClass = [
    'flex h-16 w-[480px] items-center gap-[18px] rounded-full border bg-widget-surface shadow-widget pl-6 pr-[22px]',
    'transition-[border-color] duration-200',
    BORDER_CLASS[visual],
  ].join(' ');

  return (
    <div className="flex h-screen w-screen select-none items-center justify-center font-sans">
      {/* Transparent hit zone, required for mouse events on Electron transparent window */}
      <div
        onMouseDown={handleMouseDown}
        className="flex flex-col items-center gap-2.5 rounded-[40px] p-2"
        style={{
          background: 'rgba(0,0,0,0.01)',
          cursor: isDragging ? 'grabbing' : 'grab',
          transformOrigin: 'center',
          opacity: animPhase === 'idle' ? 0 : undefined,
          animation:
            animPhase === 'entering' ? 'widget-enter 200ms ease-out both' :
            animPhase === 'exiting'  ? 'widget-exit 250ms ease-in both'   :
            'none',
        }}
      >
        <div
          className={capsuleClass}
          style={{
            WebkitAppRegion: 'no-drag',
            animation: isError ? 'widget-shake 300ms ease-in-out' : undefined,
          } as React.CSSProperties}
        >
          {visual === 'bars' && (
            <>
              <div className="flex shrink-0 items-center gap-3">
                <span className="h-[9px] w-[9px] shrink-0 rounded-full bg-widget-rec motion-safe:animate-widget-rec" />
                <span className="w-10 font-mono text-[13px] text-widget-fg">{formatTimer(elapsedMs)}</span>
              </div>
              <div className="flex h-9 min-w-0 flex-1 items-center justify-center gap-[3px]">
                {BAR_PROPS.map((_, i) => (
                  <div
                    key={i}
                    ref={el => { barElemsRef.current[i] = el; }}
                    className="w-[3px] shrink-0 rounded-full bg-widget-fg will-change-transform"
                    style={{
                      height: MAX_BAR_H,
                      transformOrigin: 'center',
                      transform: `scaleY(${REST_SCALE})`,
                      animation: isInitializing ? `widget-cascade 350ms ease-out ${(i * 0.01).toFixed(2)}s both` : undefined,
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {visual === 'processing' && (
            <>
              <div className="flex shrink-0 items-center gap-3">
                <span className="h-[9px] w-[9px] shrink-0 rounded-full bg-widget-fg-dim" />
                <span className="w-10 font-mono text-[13px] text-widget-fg-dim">{formatTimer(elapsedMs)}</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-center gap-2.5">
                {DOTS.map(i => (
                  <span
                    key={i}
                    className="h-1 w-1 rounded-full bg-widget-fg"
                    style={{ animation: `widget-pulse 1.2s ease-in-out ${(i * 0.12).toFixed(2)}s infinite` }}
                  />
                ))}
              </div>
            </>
          )}

          {visual === 'done' && (
            <>
              <CheckIcon />
              <span className="min-w-0 flex-1 truncate text-[13px] text-widget-fg-muted">{resultText}</span>
            </>
          )}

          {visual === 'error' && (
            <>
              <span className="h-[9px] w-[9px] shrink-0 rounded-full bg-widget-error" />
              <ErrorText message={errorMessage} />
            </>
          )}
        </div>

        {/* Always rendered so the capsule keeps its position when a state has no shortcuts */}
        <div className={`flex h-[26px] items-center gap-3.5 rounded-full border border-widget-border/70 bg-widget-surface px-3.5 ${shortcutRow ? '' : 'invisible'}`}>
          {shortcutRow}
        </div>
      </div>
    </div>
  );
}

function ErrorText({ message }: { message?: string }) {
  // First sentence becomes the title, the rest the detail line
  const msg = message || 'Error';
  const dotIdx = msg.indexOf('. ');
  const title = dotIdx >= 0 ? msg.slice(0, dotIdx + 1) : msg;
  const detail = dotIdx >= 0 ? msg.slice(dotIdx + 1).trim() : '';
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5" title={msg}>
      <span className="truncate text-[13px] font-medium text-widget-fg">{title}</span>
      {detail && <span className="truncate text-xs text-widget-fg-muted">{detail}</span>}
    </div>
  );
}

function ShortcutEntry({ label, raw }: { label: string; raw?: string }) {
  // Stores persisted by older versions may lack a shortcut key, a crash here
  // would take down the whole overlay tree into the ErrorBoundary
  if (!raw) return null;
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-widget-fg-muted">
      {label}
      <kbd className="rounded border border-widget-border px-[5px] py-px font-mono text-[10px] font-normal text-widget-fg-muted">
        {formatShortcut(raw)}
      </kbd>
    </span>
  );
}

function Divider() {
  return <span className="h-3 w-px bg-widget-border" />;
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 stroke-widget-ok" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}
