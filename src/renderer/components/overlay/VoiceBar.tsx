import React from 'react';
import type { RecordingState } from '../../../shared/types';

interface VoiceBarProps {
  voiceLevel: number;
  state: RecordingState;
  opacity: number;
  size: number; // 0–1 continuous scale
}

const BAR_COUNT = 28;
const SILENCE_THRESHOLD = 0.04;

// Pre-computed per-bar properties — stable across renders
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const norm = i / (BAR_COUNT - 1);
  const dist = Math.abs(norm - 0.5) * 2; // 0 = center, 1 = edges

  // Bell-curve envelope: center bars can reach full height, edge bars ~45%
  const envelope = 1 - Math.pow(dist, 1.8) * 0.55;

  // Stable pseudo-random seed per bar
  const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const rand = seed - Math.floor(seed);

  // Each bar reacts at slightly different gain (0.5–1.0)
  const multiplier = 0.5 + rand * 0.5;

  // Idle animation timing
  const idleAnimDuration = (2.2 + rand * 0.6).toFixed(2);
  const idleAnimDelay = (-(rand * 2.5)).toFixed(2);

  // Silence pulsing: slightly varied timing per bar
  const silenceDuration = (2.2 + (rand - 0.5) * 0.6).toFixed(2);
  const silenceDelay = (-(rand * 2.5)).toFixed(2);

  // Transcribe wave delay: distance from center → progressive delay
  const centerDist = Math.abs(i - (BAR_COUNT - 1) / 2);
  const transcribeDelay = (centerDist * 0.04).toFixed(2);

  // Micro-jitter factor per bar (±5%)
  const jitter = 0.95 + rand * 0.1;

  return {
    envelope, multiplier, rand, jitter,
    idleAnimDuration, idleAnimDelay,
    silenceDuration, silenceDelay,
    transcribeDelay,
  };
});

export function VoiceBar({ voiceLevel, state, opacity, size }: VoiceBarProps) {
  const t = Math.max(0, Math.min(1, size));

  const barWidth = Math.round(3 + t * 6);   // 3–9px
  const maxBarH  = Math.round(22 + t * 52); // 22–74px
  const gap      = Math.round(2 + t * 5);   // 2–7px

  const isRecording    = state === 'recording';
  const isTranscribing = state === 'transcribing' || state === 'processing';
  const isDone         = state === 'done';
  const isError        = state === 'error';
  const isIdle         = !isRecording && !isTranscribing && !isDone && !isError;

  const level       = Math.min(1, Math.max(0, voiceLevel));
  const isSilent    = isRecording && level < SILENCE_THRESHOLD;
  const curvedLevel = Math.pow(level, 0.6);

  // Pill glow: proportional to voiceLevel during recording
  const glowIntensity = isRecording ? 2 + level * 16 : 0;
  const glowAlpha     = isRecording ? (0.08 + curvedLevel * 0.18).toFixed(3) : '0';

  // Pill border: brightens with voiceLevel
  const borderAlpha = isRecording
    ? (0.15 + level * 0.25).toFixed(3)
    : isTranscribing ? '0.18'
    : isDone ? '0.15'
    : '0.12';

  // Bar glow per state
  const barGlow = isRecording && !isSilent
    ? `0 0 ${Math.round(glowIntensity)}px rgba(255,255,255,${(0.15 + curvedLevel * 0.35).toFixed(2)})`
    : isTranscribing ? '0 0 8px rgba(96,165,250,0.6)'
    : isDone ? '0 0 6px rgba(52,211,153,0.4)'
    : 'none';

  // Bar gradient per state
  const barBackground = isTranscribing
    ? 'linear-gradient(to bottom, #60A5FA, #22D3EE)'
    : isDone  ? '#34D399'
    : isError ? '#ef4444'
    : 'linear-gradient(to bottom, rgba(255,255,255,1), rgba(200,210,220,0.7))';

  // Transcribing glow on pill
  const pillShadow = isRecording && glowIntensity > 0
    ? `0 0 ${Math.round(glowIntensity)}px rgba(255,255,255,${glowAlpha}), inset 0 0 ${Math.round(glowIntensity * 0.4)}px rgba(255,255,255,${(Number(glowAlpha) * 0.5).toFixed(3)})`
    : isTranscribing ? '0 0 12px rgba(96,165,250,0.3)'
    : isDone ? '0 0 8px rgba(52,211,153,0.2)'
    : 'none';

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`
        @keyframes vb-idle {
          0%, 100% { transform: scaleY(var(--idle-scale)); opacity: 0.35; }
          50%       { transform: scaleY(calc(var(--idle-scale) * 2.2)); opacity: 0.55; }
        }
        @keyframes vb-silence {
          0%, 100% { transform: scaleY(0.08); opacity: 0.4; }
          50%       { transform: scaleY(0.15); opacity: 0.6; }
        }
        @keyframes vb-transcribe {
          0%, 100% { transform: scaleY(0.2); opacity: 0.6; }
          50%       { transform: scaleY(0.9); opacity: 1.0; }
        }
        @keyframes vb-done {
          0%, 100% { transform: scaleY(0.12); opacity: 0.4; }
          50%       { transform: scaleY(0.45); opacity: 0.8; }
        }
        @keyframes vb-error-shake {
          0%, 100% { transform: translateX(0); }
          25%      { transform: translateX(-2px); }
          75%      { transform: translateX(2px); }
        }
      `}</style>

      {/* Pill container */}
      <div
        style={{
          width: 'calc(100vw - 8px)',
          height: 'calc(100vh - 8px)',
          borderRadius: 9999,
          opacity,
          background: 'rgba(10, 10, 14, 0.78)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: `1px solid rgba(255,255,255,${borderAlpha})`,
          boxShadow: pillShadow,
          WebkitAppRegion: 'drag',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap,
          overflow: 'hidden',
          padding: `0 ${gap * 2}px`,
          boxSizing: 'border-box',
          transition: 'box-shadow 0.08s ease-out, border-color 0.15s ease-out',
          animation: isError ? 'vb-error-shake 0.1s ease-in-out 3' : 'none',
        } as React.CSSProperties}
      >
        {BARS.map((bar, i) => {
          const {
            envelope, multiplier, rand, jitter,
            idleAnimDuration, idleAnimDelay,
            silenceDuration, silenceDelay,
            transcribeDelay,
          } = bar;

          let transform: string | undefined;
          let animation = 'none';
          let transition = 'transform 0.3s ease-out, background-color 0.3s ease';

          if (isRecording) {
            transition = 'transform 0.08s ease-out';

            if (isSilent) {
              // Silence: slow subtle pulse with per-bar offset
              animation = `vb-silence ${silenceDuration}s ease-in-out ${silenceDelay}s infinite`;
              transform = undefined;
            } else {
              // Speech: real-time response with micro-jitter
              const barScale = Math.max(0.04, curvedLevel * envelope * multiplier * jitter);
              transform = `scaleY(${barScale.toFixed(4)})`;
            }

          } else if (isTranscribing) {
            // Synchronized wave from center
            animation = `vb-transcribe 1.0s ease-in-out ${transcribeDelay}s infinite`;

          } else if (isDone) {
            animation = `vb-done ${idleAnimDuration}s ease-in-out ${idleAnimDelay}s infinite`;

          } else if (isError) {
            transform = 'scaleY(0.3)';

          } else {
            // Idle: very short bars with slow breathing
            const idleScale = (0.06 + envelope * 0.06).toFixed(3);
            animation = `vb-idle ${idleAnimDuration}s ease-in-out ${idleAnimDelay}s infinite`;
            return (
              <div
                key={i}
                style={{
                  width: barWidth,
                  height: maxBarH,
                  borderRadius: barWidth / 2,
                  background: barBackground,
                  transformOrigin: 'center',
                  flexShrink: 0,
                  animation,
                  transition,
                  filter: barGlow !== 'none' ? `drop-shadow(${barGlow})` : undefined,
                  '--idle-scale': idleScale,
                } as React.CSSProperties}
              />
            );
          }

          return (
            <div
              key={i}
              style={{
                width: barWidth,
                height: maxBarH,
                borderRadius: barWidth / 2,
                background: barBackground,
                transformOrigin: 'center',
                flexShrink: 0,
                transform,
                animation,
                transition,
                filter: barGlow !== 'none' ? `drop-shadow(${barGlow})` : undefined,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
