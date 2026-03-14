import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordingState } from '../../../shared/types';

interface VoiceBarProps {
  voiceLevel: number;
  state: RecordingState;
  opacity: number;
  size: number; // 0–1 continuous scale
  onToggleRecording?: () => void;
}

const BAR_COUNT = 6;
const SILENCE_THRESHOLD = 0.04;
const BASE_COLOR = 'rgba(255,255,255,0.88)';
const TRANSCRIBE_COLOR = '#FB923C';
const ERROR_COLOR = '#F87171';

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

  // Transcribe scanner delay: left-to-right, index * 45ms
  const transcribeDelay = (i * 0.045).toFixed(3);

  return {
    envelope, multiplier, rand, jitter,
    idleScale, silenceDelay, transcribeDelay,
  };
});

// Keyframes injected once
const KEYFRAMES = `
@keyframes vb-silence {
  0%, 100% { transform: scaleY(0.1); }
  50%      { transform: scaleY(0.2); }
}
@keyframes vb-transcribe {
  0%, 100% { transform: scaleY(0.3); }
  50%      { transform: scaleY(0.85); }
}
@keyframes vb-done-collapse {
  from { transform: scaleY(var(--from-scale, 0.15)); }
  to   { transform: scaleY(0.05); }
}
@keyframes vb-error-shake {
  0%   { transform: translateX(0); }
  20%  { transform: translateX(3px); }
  40%  { transform: translateX(-3px); }
  60%  { transform: translateX(2px); }
  80%  { transform: translateX(0); }
  100% { transform: translateX(0); }
}
`;

export function VoiceBar({ voiceLevel, state, opacity, size, onToggleRecording }: VoiceBarProps) {
  const t = Math.max(0, Math.min(1, size));

  const barWidth = Math.round(2 + t * 3);   // 2–5px
  const maxBarH  = Math.round(18 + t * 46); // 18–64px
  const gap      = Math.round(3 + t * 4);   // 3–7px

  const isRecording    = state === 'recording';
  const isTranscribing = state === 'transcribing' || state === 'processing';
  const isDone         = state === 'done';
  const isError        = state === 'error';
  const isIdle         = !isRecording && !isTranscribing && !isDone && !isError;

  const level    = Math.min(1, Math.max(0, voiceLevel));
  const isSilent = isRecording && level < SILENCE_THRESHOLD;

  const [isProximate, setIsProximate] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setIsProximate(true);
  }, []);

  const handleLeave = useCallback(() => {
    // Debounce collapse so spurious leave events don't cause flickering
    leaveTimer.current = setTimeout(() => setIsProximate(false), 150);
  }, []);

  useEffect(() => {
    return () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); };
  }, []);

  const isExpanded = isProximate || isRecording || isTranscribing || isError;

  const collapsedH = 10;
  const expandedH  = maxBarH + gap * 4;

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
        style={{
          padding: `${PROX_V}px ${PROX_H}px`,
          borderRadius: 9999,
          background: 'rgba(0,0,0,0.01)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        } as React.CSSProperties}
      >
        {/* Pill container */}
        <div
          style={{
            position: 'relative',
            width: 'fit-content',
            height: pillHeight,
            borderRadius: 9999,
            opacity,
            background: 'rgba(8, 8, 8, 0.88)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '0.5px solid rgba(255,255,255,0.85)',
            boxShadow: 'none',
            // Disable drag region when hovered — drag regions swallow mouse events in Electron,
            // causing spurious mouseleave on the proximity wrapper.
            WebkitAppRegion: isProximate ? 'no-drag' : 'drag',
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
                background: 'rgba(8, 8, 8, 0.75)',
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
                  <svg width={Math.round(maxBarH * 0.75)} height={Math.round(maxBarH * 0.75)} viewBox="0 0 24 24">
                    <rect x="5" y="5" width="14" height="14" rx="2.5" fill="rgba(255,255,255,0.92)" />
                  </svg>
                ) : (
                  // Record: red circle with outer ring
                  <svg width={Math.round(maxBarH * 0.75)} height={Math.round(maxBarH * 0.75)} viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="#EF4444" strokeWidth="1.5" />
                    <circle cx="12" cy="12" r="6" fill="#EF4444" />
                  </svg>
                )}
              </button>
            </div>
          )}

          {BARS.map((bar, i) => {
            const {
              envelope, multiplier, jitter,
              idleScale, silenceDelay, transcribeDelay,
            } = bar;

            const barColor = isError ? ERROR_COLOR : isTranscribing ? TRANSCRIBE_COLOR : BASE_COLOR;

            let transform: string | undefined;
            let animation = 'none';
            let transition = 'transform 0.3s ease-out, opacity 200ms ease-out';
            let barOpacity: number;
            let filter: string | undefined;

            if (isIdle) {
              transform = `scaleY(${idleScale})`;
              barOpacity = 0.4;
              filter = undefined;

            } else if (isRecording) {
              if (isSilent) {
                // Static low bars — no animation when silent
                transform = `scaleY(${idleScale})`;
                barOpacity = 0.45;
                filter = undefined;
                transition = 'transform 150ms ease-out, opacity 200ms ease-out';
              } else {
                const curvedLevel = Math.pow(level, 0.45);
                const barScale = Math.min(1.0, Math.max(0.05, curvedLevel * envelope * multiplier * jitter));
                transform = `scaleY(${barScale.toFixed(4)})`;
                transition = 'transform 50ms linear, opacity 200ms ease-out';
                barOpacity = 0.6 + curvedLevel * 0.4;
                filter = undefined;
              }

            } else if (isTranscribing) {
              animation = `vb-transcribe 1.2s linear ${transcribeDelay}s infinite`;
              barOpacity = 0.80;
              filter = undefined;
              transition = 'opacity 200ms ease-out';

            } else if (isDone) {
              animation = `vb-done-collapse 400ms cubic-bezier(0.4, 0, 1, 1) forwards`;
              barOpacity = 0.7;
              filter = undefined;
              transition = 'opacity 200ms ease-out';

            } else {
              transform = 'scaleY(0.3)';
              barOpacity = 0.9;
              filter = undefined;
            }

            // Fade bars in/out with pill expand/collapse
            const finalOpacity = isExpanded ? barOpacity : 0;

            return (
              <div
                key={i}
                style={{
                  width: barWidth,
                  height: maxBarH,
                  borderRadius: barWidth / 2,
                  background: barColor,
                  transformOrigin: 'center',
                  flexShrink: 0,
                  transform,
                  animation,
                  transition,
                  opacity: finalOpacity,
                  filter,
                  '--from-scale': idleScale,
                } as React.CSSProperties}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
