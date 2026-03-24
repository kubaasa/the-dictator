import { useState, useEffect } from 'react';
import log from 'electron-log/renderer';
import type { RecordingState } from '../../shared/types';

export function useRecordingState(): RecordingState {
  const [state, setState] = useState<RecordingState>('idle');

  useEffect(() => {
    window.dictator.getRecordingState().then(setState).catch((err) => log.error('Failed to get recording state:', err));
    const unsub = window.dictator.onRecordingStateChanged(setState);
    return unsub;
  }, []);

  return state;
}
