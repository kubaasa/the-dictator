import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordingState } from '../../../shared/types';
import { formatShortcut } from './keys';

interface VoiceBarProps {
  voiceLevel: number;
  state: RecordingState;
  errorMessage?: string;
  shortcut?: string;
  onToggleRecording?: () => void;
  /** Render inline without IPC drag or the full-window hit zone (WidgetPage preview). */
  preview?: boolean;
  /** Preview only: show the hover content without a real pointer. */
  forceHover?: boolean;
}

const BAR_COUNT = 9;
const MIN_BAR_H = 2;
const MAX_BAR_H = 24;
const DOT_COUNT = 5;

// A press that moves less than this before release is a click, not a drag
const CLICK_TOLERANCE_PX = 4;

const LERP_ATTACK  = 0.75;
const LERP_RELEASE = 0.18;

// Hit-zone padding around the 168x36 pill fills the 210x62 overlay window
const PROX_V = 13;
const PROX_H = 21;

const BARS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const dist = Math.abs(i / (BAR_COUNT - 1) - 0.5) * 2;
  const envelope = 1 - Math.pow(dist, 1.8) * 0.55;
  const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const rand = seed - Math.floor(seed);
  return { rand, multiplier: (0.75 + rand * 0.25) * envelope };
});

const DOTS = Array.from({ length: DOT_COUNT }, (_, i) => i);

const REST_SCALE = (MIN_BAR_H / MAX_BAR_H).toFixed(4);

type Visual = 'idle' | 'hover' | 'bars' | 'processing' | 'done' | 'error';

const BORDER_CLASS: Record<Visual, string> = {
  idle: 'border-widget-border',
  bars: 'border-widget-border',
  processing: 'border-widget-border',
  hover: 'border-widget-border-strong',
  done: 'border-widget-ok/45',
  error: 'border-widget-error/75',
};

const ARIA_LABEL: Record<Visual, string> = {
  idle: 'Start recording',
  hover: 'Start recording',
  bars: 'Stop recording',
  processing: 'Processing',
  done: 'Pasted',
  error: 'Error',
};

export function VoiceBar({
  voiceLevel, state, errorMessage, shortcut, onToggleRecording, preview = false, forceHover = false,
}: VoiceBarProps) {
  const isInitializing = state === 'initializing';
  const isRecording    = state === 'recording';
  const isTranscribing = state === 'transcribing' || state === 'processing';
  const isDone         = state === 'done';
  const isError        = state === 'error';
  const isIdle         = state === 'idle';

  const [isProximate, setIsProximate] = useState(false);

  const leaveTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragMouseUpRef = useRef<((e: MouseEvent) => void) | null>(null);
  const pressRef       = useRef<{ x: number; y: number } | null>(null);

  const toggleableRef = useRef(false);
  toggleableRef.current = isIdle || isRecording;
  const toggleRef = useRef(onToggleRecording);
  toggleRef.current = onToggleRecording;

  const hover = preview ? forceHover : isProximate;

  const visual: Visual = isError ? 'error'
    : isDone ? 'done'
    : isTranscribing ? 'processing'
    : (isInitializing || isRecording) ? 'bars'
    : hover ? 'hover'
    : 'idle';

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
      if (!preview) window.dictator.widgetDragEnd();
    };
  }, [preview]);

  // One gesture for the whole pill: drag moves the window, a release without movement toggles recording
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (preview) return;

    pressRef.current = { x: e.screenX, y: e.screenY };
    window.dictator.widgetDragStart(e.screenX - window.screenX, e.screenY - window.screenY);

    const onUp = (ev: MouseEvent) => {
      window.dictator.widgetDragEnd();
      document.removeEventListener('mouseup', onUp);
      dragMouseUpRef.current = null;

      const press = pressRef.current;
      pressRef.current = null;
      const moved = !press
        || Math.abs(ev.screenX - press.x) > CLICK_TOLERANCE_PX
        || Math.abs(ev.screenY - press.y) > CLICK_TOLERANCE_PX;
      if (!moved && toggleableRef.current) toggleRef.current?.();
    };

    dragMouseUpRef.current = onUp;
    document.addEventListener('mouseup', onUp);
  }, [preview]);

  const barElemsRef   = useRef<(HTMLDivElement | null)[]>([]);
  const smoothedRef   = useRef<Float32Array>(new Float32Array(BAR_COUNT).fill(MIN_BAR_H));
  const voiceLevelRef = useRef(0);
  const rafRef        = useRef<number>(0);

  useEffect(() => { voiceLevelRef.current = voiceLevel; }, [voiceLevel]);

  // Voice-level driven visualization: uses IPC voiceLevel from the recording worklet
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
        // Three overlapping sine waves per bar: each bar oscillates independently,
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
          el.style.transform = `scaleY(${(smoothedRef.current[i] / MAX_BAR_H).toFixed(4)}) translateZ(0)`;
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

  // Idle collapses to a 64x8 sliver; expanding is quick, collapsing after the pointer leaves is slower
  const collapsed = visual === 'idle';
  const pillClass = [
    'flex items-center justify-center overflow-hidden rounded-full border bg-widget-surface shadow-widget',
    'transition-[width,height,opacity,border-color] ease-out',
    collapsed ? 'h-2 w-16 opacity-60' : 'h-9 w-[168px] opacity-100',
    BORDER_CLASS[visual],
  ].join(' ');

  const content = (
    <div
      role="button"
      aria-label={visual === 'error' && errorMessage ? errorMessage : ARIA_LABEL[visual]}
      title={visual === 'error' ? errorMessage : undefined}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onMouseMove={handleMove}
      onMouseDown={handleMouseDown}
      className={preview ? 'inline-flex' : 'flex items-center justify-center rounded-full'}
      // rgba background forces mouse events on an Electron transparent window
      style={preview ? undefined : { padding: `${PROX_V}px ${PROX_H}px`, background: 'rgba(0,0,0,0.01)', cursor: 'default' }}
    >
      <div
        className={pillClass}
        style={{
          WebkitAppRegion: 'no-drag',
          transitionDuration: collapsed ? '400ms' : '250ms',
          animation: isError ? 'widget-shake 300ms ease-in-out' : undefined,
        } as React.CSSProperties}
      >
        {!collapsed && (
        <div key={visual} className="flex items-center justify-center animate-[widget-fade-in_180ms_ease-out]">
          {visual === 'hover' && (
            <div className="flex items-center gap-2.5">
              <MicIcon />
              {shortcut && (
                <span className="font-mono text-[11px] text-widget-fg-muted">{formatShortcut(shortcut)}</span>
              )}
            </div>
          )}

          {visual === 'bars' && (
            <div className="flex h-6 items-center gap-[3px]">
              {BARS.map((_, i) => (
                <div
                  key={i}
                  ref={el => { barElemsRef.current[i] = el; }}
                  className="w-[3px] rounded-full bg-widget-fg will-change-transform"
                  style={{
                    height: MAX_BAR_H,
                    transformOrigin: 'center',
                    transform: `scaleY(${REST_SCALE})`,
                    animation: isInitializing ? `widget-cascade 350ms ease-out ${(i * 0.04).toFixed(2)}s both` : undefined,
                  }}
                />
              ))}
            </div>
          )}

          {visual === 'processing' && <PulsingDots />}

          {visual === 'done' && (
            <div className="flex items-center gap-2">
              <CheckIcon />
              <span className="text-xs font-medium text-widget-fg">Pasted</span>
            </div>
          )}

          {visual === 'error' && <span className="text-xs font-medium text-widget-fg">Error</span>}
        </div>
        )}
      </div>
    </div>
  );

  if (preview) return content;

  return (
    <div className="flex h-screen w-screen select-none items-center justify-center font-sans">
      {content}
    </div>
  );
}

function PulsingDots() {
  return (
    <div className="flex items-center gap-2.5">
      {DOTS.map(i => (
        <span
          key={i}
          className="h-1 w-1 rounded-full bg-widget-fg"
          style={{ animation: `widget-pulse 1.2s ease-in-out ${(i * 0.15).toFixed(2)}s infinite` }}
        />
      ))}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="stroke-widget-fg" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="stroke-widget-ok" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}
