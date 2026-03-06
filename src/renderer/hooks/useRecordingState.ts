import { useState, useEffect } from 'react';
import type { RecordingState } from '../../shared/types';

export function useRecordingState(): RecordingState {
  const [state, setState] = useState<RecordingState>('idle');

  useEffect(() => {
    window.dictator.getRecordingState().then(setState);
    const unsub = window.dictator.onRecordingStateChanged(setState);
    return unsub;
  }, []);

  return state;
}
