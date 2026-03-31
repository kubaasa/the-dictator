import { useState, useEffect, useRef } from 'react';

interface VoiceActivity {
  level: number;
  bandsRef: React.RefObject<number[] | null>;
}

export function useVoiceActivity(): VoiceActivity {
  const [level, setLevel] = useState(0);
  const bandsRef = useRef<number[] | null>(null);

  useEffect(() => {
    const unsub = window.dictator.onVoiceActivity((l, bands) => {
      setLevel(l);
      if (bands) bandsRef.current = bands;
    });
    return unsub;
  }, []);

  return { level, bandsRef };
}
