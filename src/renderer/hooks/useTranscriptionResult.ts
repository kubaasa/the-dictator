import { useState, useEffect, useCallback } from 'react';
import type { RecordingState, TranscriptionResult } from '../../shared/types';

interface UseTranscriptionResultReturn {
  result: string;
  appName: string | undefined;
  error: string;
  clearResult: () => void;
}

export function useTranscriptionResult(recordingState: RecordingState): UseTranscriptionResultReturn {
  const [result, setResult] = useState('');
  const [appName, setAppName] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');

  // Clear previous result when a new recording starts
  useEffect(() => {
    if (recordingState === 'recording') {
      setResult('');
      setAppName(undefined);
      setError('');
    }
  }, [recordingState]);

  useEffect(() => {
    const unsubResult = window.dictator.onTranscriptionResult((data: TranscriptionResult) => {
      setResult(data.text);
      setAppName(data.appName);
      setError('');
    });
    const unsubError = window.dictator.onTranscriptionError((msg: string) => {
      setError(msg);
    });
    return () => {
      unsubResult();
      unsubError();
    };
  }, []);

  const clearResult = useCallback(() => {
    setResult('');
    setAppName(undefined);
    setError('');
  }, []);

  return { result, appName, error, clearResult };
}
