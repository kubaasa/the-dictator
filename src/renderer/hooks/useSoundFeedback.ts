import { useEffect, useRef } from 'react';
import log from 'electron-log/renderer';
import type { RecordingState } from '../../shared/types';

function playTone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  gain: number,
): void {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.value = freq;

  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.005);
  gainNode.gain.setValueAtTime(gain, startTime + duration - 0.015);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playStartSound(ctx: AudioContext): void {
  const now = ctx.currentTime;
  playTone(ctx, 660, now, 0.06, 0.15);
  playTone(ctx, 880, now + 0.06, 0.06, 0.15);
}

function playStopSound(ctx: AudioContext): void {
  const now = ctx.currentTime;
  playTone(ctx, 880, now, 0.06, 0.15);
  playTone(ctx, 660, now + 0.06, 0.06, 0.15);
}

function playErrorSound(ctx: AudioContext): void {
  const now = ctx.currentTime;
  playTone(ctx, 220, now, 0.15, 0.15);
}

export function useSoundFeedback(recordingState: RecordingState, isOverlay: boolean): void {
  const prevStateRef = useRef<RecordingState>(recordingState);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(true);

  useEffect(() => {
    if (isOverlay) return;

    window.dictator.getSettings().then((s) => {
      soundEnabledRef.current = s.audio?.soundEnabled ?? true;
    });

    const unsub = window.dictator.onSettingsChange((s) => {
      soundEnabledRef.current = s.audio?.soundEnabled ?? true;
    });
    return unsub;
  }, [isOverlay]);

  useEffect(() => {
    if (isOverlay) return;

    const prev = prevStateRef.current;
    prevStateRef.current = recordingState;

    if (!soundEnabledRef.current) return;
    if (prev === recordingState) return;

    let playFn: ((ctx: AudioContext) => void) | null = null;

    if (prev === 'initializing' && recordingState === 'recording') {
      playFn = playStartSound;
    } else if (prev === 'recording' && recordingState === 'transcribing') {
      playFn = playStopSound;
    } else if (recordingState === 'error') {
      playFn = playErrorSound;
    }

    if (!playFn) return;

    // AudioContext can land in 'closed' after system sleep/wake or display changes,
    // and 'suspended' resume() can reject silently. Recreate the context whenever
    // it's not in a playable state so the cue is never silently dropped.
    const playWithRecovery = (fn: (ctx: AudioContext) => void) => {
      let ctx = audioCtxRef.current;
      if (!ctx || ctx.state === 'closed') {
        ctx = new AudioContext();
        audioCtxRef.current = ctx;
      }
      const activeCtx = ctx;
      const safePlay = (target: AudioContext) => {
        try { fn(target); } catch (err) { log.warn('sound playback failed:', err); }
      };
      if (activeCtx.state === 'suspended') {
        activeCtx.resume().then(() => safePlay(activeCtx)).catch((err) => {
          log.warn('AudioContext resume failed, recreating:', err);
          try { activeCtx.close(); } catch { /* ignore */ }
          const fresh = new AudioContext();
          audioCtxRef.current = fresh;
          fresh.resume()
            .then(() => safePlay(fresh))
            .catch((e) => log.warn('AudioContext recreate resume failed:', e));
        });
      } else {
        safePlay(activeCtx);
      }
    };

    playWithRecovery(playFn);
  }, [recordingState, isOverlay]);

  useEffect(() => {
    return () => {
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, []);
}
