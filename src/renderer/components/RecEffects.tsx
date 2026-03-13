import { useState, useEffect, useRef } from 'react';

/* ─── ScanLines ─── */
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

/* ─── NoiseOverlay ─── */
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

/* ─── Vignette ─── */
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

/* ─── ViewfinderCorners ─── */
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
      {/* Top-left */}
      <div
        className={`absolute top-0 left-0 pointer-events-none ${cls}`}
        style={{ width: size, height: size, borderTop: borderStyle, borderLeft: borderStyle }}
      />
      {/* Top-right */}
      <div
        className={`absolute top-0 right-0 pointer-events-none ${cls}`}
        style={{ width: size, height: size, borderTop: borderStyle, borderRight: borderStyle }}
      />
      {/* Bottom-left */}
      <div
        className={`absolute bottom-0 left-0 pointer-events-none ${cls}`}
        style={{ width: size, height: size, borderBottom: borderStyle, borderLeft: borderStyle }}
      />
      {/* Bottom-right */}
      <div
        className={`absolute bottom-0 right-0 pointer-events-none ${cls}`}
        style={{ width: size, height: size, borderBottom: borderStyle, borderRight: borderStyle }}
      />
    </>
  );
}

/* ─── RecIndicator ─── */
interface RecIndicatorProps {
  isRecording: boolean;
}

export function RecIndicator({ isRecording }: RecIndicatorProps) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (isRecording) {
      startRef.current = Date.now();
      const tick = () => {
        if (startRef.current) {
          setElapsed(Date.now() - startRef.current);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      startRef.current = null;
      setElapsed(0);
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isRecording]);

  const formatTimecode = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    const f = Math.floor((ms % 1000) / (1000 / 25)).toString().padStart(2, '0');
    return `${h}:${m}:${s}:${f}`;
  };

  if (!isRecording) return null;

  return (
    <div className="flex items-center gap-3 font-mono text-lg uppercase tracking-wider">
      <span className="inline-block h-3 w-3 rounded-full bg-red-600 animate-rec-blink" />
      <span className="text-red-500 font-bold">[REC]</span>
      <span className="text-green-500">{formatTimecode(elapsed)}</span>
    </div>
  );
}

/* ─── TimecodeDisplay ─── */
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
