import { useState, useEffect, useRef } from 'react';

export function ScanLines() {
  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none"
      style={{
        background: 'repeating-linear-gradient(0deg, transparent 0px, transparent 1px, rgba(0,0,0,0.08) 1px, rgba(0,0,0,0.08) 2px)',
      }}
    />
  );
}

export function NoiseOverlay() {
  return (
    <div className="fixed inset-0 z-[49] pointer-events-none opacity-[0.04] mix-blend-overlay">
      <svg width="100%" height="100%">
        <filter id="rec-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#rec-noise)" />
      </svg>
    </div>
  );
}

export function Vignette() {
  return (
    <div
      className="fixed inset-0 z-[48] pointer-events-none"
      style={{
        background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)',
      }}
    />
  );
}

interface ViewfinderCornersProps {
  color?: string;
  size?: number;
  animated?: boolean;
}

export function ViewfinderCorners({ color = '#166534', size = 24, animated = false }: ViewfinderCornersProps) {
  const borderStyle = `2px solid ${color}`;
  const cls = animated ? 'animate-corner-pulse' : '';

  return (
    <>
      <div
        className={`absolute top-0 left-0 pointer-events-none ${cls}`}
        style={{ width: size, height: size, borderTop: borderStyle, borderLeft: borderStyle }}
      />
      <div
        className={`absolute top-0 right-0 pointer-events-none ${cls}`}
        style={{ width: size, height: size, borderTop: borderStyle, borderRight: borderStyle }}
      />
      <div
        className={`absolute bottom-0 left-0 pointer-events-none ${cls}`}
        style={{ width: size, height: size, borderBottom: borderStyle, borderLeft: borderStyle }}
      />
      <div
        className={`absolute bottom-0 right-0 pointer-events-none ${cls}`}
        style={{ width: size, height: size, borderBottom: borderStyle, borderRight: borderStyle }}
      />
    </>
  );
}

interface RecIndicatorProps {
  isRecording: boolean;
  recordingStartTime?: number | null;
  compact?: boolean;
}

export function RecIndicator({ isRecording, recordingStartTime, compact = false }: RecIndicatorProps) {
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (isRecording) {
      const startTime = recordingStartTime ?? Date.now();
      const tick = () => {
        setElapsed(Date.now() - startTime);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      setElapsed(0);
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isRecording, recordingStartTime]);

  const formatTimecode = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    const f = Math.floor((ms % 1000) / (1000 / 25)).toString().padStart(2, '0');
    return `${h}:${m}:${s}:${f}`;
  };

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 font-mono transition-all duration-300 ${
        isRecording ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
      }`}>
        <span className="inline-block h-2 w-2 rounded-full bg-red-600 animate-rec-blink shrink-0" />
        <span className="text-red-500 font-bold text-[10px] uppercase tracking-wider">[REC]</span>
        <span className="text-green-500 text-[10px] tracking-wider">{formatTimecode(elapsed)}</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 font-mono text-lg uppercase tracking-wider transition-all duration-300 ${
      isRecording ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
    }`}>
      <span className="inline-block h-3 w-3 rounded-full bg-red-600 animate-rec-blink" />
      <span className="text-red-500 font-bold">[REC]</span>
      <span className="text-green-500">{formatTimecode(elapsed)}</span>
    </div>
  );
}

export function TimecodeDisplay() {
  const [time, setTime] = useState('');
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      const s = now.getSeconds().toString().padStart(2, '0');
      const ms = now.getMilliseconds();
      const f = Math.floor(ms / (1000 / 25)).toString().padStart(2, '0');
      setTime(`${h}:${m}:${s}:${f}`);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <span className="font-mono text-xs text-green-600 tracking-wider">
      {time}
    </span>
  );
}
