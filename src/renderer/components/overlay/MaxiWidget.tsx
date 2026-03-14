import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordingState, DictationMode } from '../../../shared/types';

interface MaxiWidgetProps {
  voiceLevel: number;
  state: RecordingState;
  opacity: number;
  size: number;
  currentMode: DictationMode;
  onToggleRecording: () => void;
  onCancelRecording: () => void;
  onCycleMode: () => void;
}

const WAVEFORM_BARS = 48;
const SILENCE_THRESHOLD = 0.04;

const BASE_COLOR = 'rgba(255,255,255,0.88)';
const TRANSCRIBE_COLOR = '#FB923C';
const ERROR_COLOR = '#F87171';

const MODE_LABELS: Record<DictationMode, string> = {
  voice: 'VOICE',
  email: 'EMAIL',
  chat: 'CHAT',
  note: 'NOTE',
  custom: 'CUSTOM',
};

const MODE_COLORS: Record<DictationMode, string> = {
  voice: '#EF4444',
  email: '#3B82F6',
  chat: '#22C55E',
  note: '#F59E0B',
  custom: '#A855F7',
};

const KEYFRAMES = `
@keyframes maxi-transcribe {
  0%, 100% { transform: scaleY(0.2); }
  50%      { transform: scaleY(0.9); }
}
@keyframes maxi-error-shake {
  0%   { transform: translateX(0); }
  20%  { transform: translateX(4px); }
  40%  { transform: translateX(-4px); }
  60%  { transform: translateX(3px); }
  80%  { transform: translateX(0); }
  100% { transform: translateX(0); }
}
@keyframes maxi-done-collapse {
  from { transform: scaleY(var(--from-scale, 0.15)); }
  to   { transform: scaleY(0.03); }
}
`;

export function MaxiWidget({
  voiceLevel,
  state,
  opacity,
  size,
  currentMode,
  onToggleRecording,
  onCancelRecording,
  onCycleMode,
}: MaxiWidgetProps) {
  const t = Math.max(0, Math.min(1, size));
  const bufferRef = useRef<number[]>(new Array(WAVEFORM_BARS).fill(0));
  const [, forceUpdate] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const isRecording = state === 'recording';
  const isTranscribing = state === 'transcribing' || state === 'processing';
  const isDone = state === 'done';
  const isError = state === 'error';

  const level = Math.min(1, Math.max(0, voiceLevel));

  // Push new voice level into rolling buffer
  // Reset buffer when recording starts (must be declared before the push effect)
  useEffect(() => {
    if (isRecording) {
      bufferRef.current = new Array(WAVEFORM_BARS).fill(0);
    }
  }, [isRecording]);

  // Push new voice level into rolling buffer
  useEffect(() => {
    if (!isRecording) return;
    const buf = bufferRef.current;
    buf.push(level);
    if (buf.length > WAVEFORM_BARS) buf.shift();
    forceUpdate((n) => n + 1);
  }, [level, isRecording]);

  // Drag logic (same pattern as VoiceBar)
  useEffect(() => {
    return () => {
      window.dictator.widgetDragEnd();
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const offsetX = e.screenX - window.screenX;
    const offsetY = e.screenY - window.screenY;
    window.dictator.widgetDragStart(offsetX, offsetY);
    setIsDragging(true);

    const onUp = () => {
      window.dictator.widgetDragEnd();
      setIsDragging(false);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mouseup', onUp);
  }, []);

  // Dimensions
  const barW = Math.round(2 + t * 1);     // 2-3px
  const barGap = Math.round(1 + t * 1);   // 1-2px
  const maxBarH = Math.round(24 + t * 36); // 24-60px
  const btnSize = Math.round(20 + t * 10); // 20-30px
  const padding = Math.round(8 + t * 6);   // 8-14px

  const modeColor = MODE_COLORS[currentMode] ?? MODE_COLORS.voice;
  const isSilent = isRecording && level < SILENCE_THRESHOLD;

  // Status text for transcribing/processing
  const statusText = state === 'transcribing' ? 'Transcribing...' : state === 'processing' ? 'Processing...' : '';

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{KEYFRAMES}</style>

      {/* Transparent hit zone for mouse events on transparent Electron window */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          padding: 6,
          borderRadius: 22,
          background: 'rgba(0,0,0,0.01)',
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      >
        {/* Card container */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: padding,
            padding: `${padding}px ${padding + 4}px`,
            borderRadius: 16,
            opacity,
            background: 'rgba(8, 8, 8, 0.88)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            animation: isError ? 'maxi-error-shake 0.3s ease-in-out 2' : 'none',
          } as React.CSSProperties}
        >
          {/* Mode button */}
          <button
            onClick={onCycleMode}
            style={{
              background: `${modeColor}18`,
              border: `1px solid ${modeColor}50`,
              borderRadius: 8,
              padding: '4px 8px',
              cursor: 'pointer',
              color: modeColor,
              fontSize: Math.round(9 + t * 2),
              fontFamily: 'monospace',
              fontWeight: 700,
              letterSpacing: '0.05em',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'background 150ms, border-color 150ms, color 150ms',
            }}
          >
            {MODE_LABELS[currentMode] ?? 'VOICE'}
          </button>

          {/* Waveform area */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: barGap,
              height: maxBarH,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {/* Status text overlay for transcribing/processing */}
            {(isTranscribing || isError) && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 5,
                  pointerEvents: 'none',
                }}
              >
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: Math.round(9 + t * 2),
                    fontWeight: 600,
                    color: isError ? ERROR_COLOR : TRANSCRIBE_COLOR,
                    textShadow: '0 1px 4px rgba(0,0,0,0.7)',
                    letterSpacing: '0.05em',
                  }}
                >
                  {isError ? 'Error' : statusText}
                </span>
              </div>
            )}

            {bufferRef.current.map((val, i) => {
              const barColor = isError
                ? ERROR_COLOR
                : isTranscribing
                  ? TRANSCRIBE_COLOR
                  : BASE_COLOR;

              let transform: string | undefined;
              let animation = 'none';
              let transition = 'transform 80ms linear, opacity 150ms ease-out';
              let barOpacity: number;

              if (isRecording) {
                if (isSilent) {
                  const idleH = 0.05 + Math.sin(i * 0.3) * 0.03;
                  transform = `scaleY(${idleH.toFixed(4)})`;
                  barOpacity = 0.3;
                } else {
                  const curvedVal = Math.pow(Math.max(0, val), 0.45);
                  const barScale = Math.min(1.0, Math.max(0.03, curvedVal));
                  transform = `scaleY(${barScale.toFixed(4)})`;
                  barOpacity = 0.4 + curvedVal * 0.6;
                }
              } else if (isTranscribing) {
                const delay = (i * (1.2 / WAVEFORM_BARS)).toFixed(3);
                animation = `maxi-transcribe 1.2s linear ${delay}s infinite`;
                barOpacity = 0.35;
              } else if (isDone) {
                animation = 'maxi-done-collapse 400ms cubic-bezier(0.4, 0, 1, 1) forwards';
                barOpacity = 0.5;
              } else if (isError) {
                transform = 'scaleY(0.2)';
                barOpacity = 0.5;
              } else {
                transform = 'scaleY(0.05)';
                barOpacity = 0.3;
              }

              return (
                <div
                  key={i}
                  style={{
                    width: barW,
                    height: maxBarH,
                    borderRadius: barW / 2,
                    background: barColor,
                    transformOrigin: 'center',
                    flexShrink: 0,
                    transform,
                    animation,
                    transition,
                    opacity: barOpacity,
                    '--from-scale': '0.15',
                  } as React.CSSProperties}
                />
              );
            })}
          </div>

          {/* Control buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(4 + t * 4), flexShrink: 0 }}>
            {/* Stop button */}
            {isRecording && (
              <button
                onClick={onToggleRecording}
                title="Stop recording"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 8,
                  width: btnSize,
                  height: btnSize,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  transition: 'background 150ms',
                }}
              >
                <svg width={Math.round(btnSize * 0.5)} height={Math.round(btnSize * 0.5)} viewBox="0 0 24 24">
                  <rect x="4" y="4" width="16" height="16" rx="2.5" fill="rgba(255,255,255,0.88)" />
                </svg>
              </button>
            )}

            {/* Cancel button — only during recording */}
            {isRecording && (
              <button
                onClick={onCancelRecording}
                title="Cancel recording"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  borderRadius: 8,
                  width: btnSize,
                  height: btnSize,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  transition: 'background 150ms',
                }}
              >
                <svg width={Math.round(btnSize * 0.45)} height={Math.round(btnSize * 0.45)} viewBox="0 0 24 24">
                  <path d="M6 6L18 18M6 18L18 6" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
