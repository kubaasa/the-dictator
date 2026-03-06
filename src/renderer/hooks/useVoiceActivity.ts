import { useState, useEffect } from 'react';

export function useVoiceActivity(): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const unsub = window.dictator.onVoiceActivity(setLevel);
    return unsub;
  }, []);

  return level;
}
