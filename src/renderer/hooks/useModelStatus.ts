import { useState, useEffect, useCallback, useRef } from 'react';

export function useModelStatus() {
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  // Holds cleanup functions for active IPC listeners so cancel() can remove them
  const cleanupRef = useRef<(() => void) | null>(null);

  const recheck = useCallback(async () => {
    setDownloaded(null);
    const { downloaded } = await window.dictator.checkModelStatus();
    setDownloaded(downloaded);
  }, []);

  useEffect(() => {
    recheck();
  }, [recheck]);

  const download = useCallback(() => {
    setDownloading(true);
    setProgress(0);
    setError('');

    const removeProgress = window.dictator.onModelProgress((pct) => setProgress(pct));

    const cleanup = () => {
      removeProgress();
      removeDone();
      removeError();
      cleanupRef.current = null;
    };

    const removeDone = window.dictator.onModelDone(() => {
      cleanup();
      setDownloaded(true);
      setDownloading(false);
      setProgress(100);
    });

    const removeError = window.dictator.onModelError((msg) => {
      cleanup();
      setError(msg);
      setDownloading(false);
    });

    cleanupRef.current = cleanup;
    window.dictator.downloadModel();
  }, []);

  const cancel = useCallback(() => {
    window.dictator.cancelDownload();
    cleanupRef.current?.();
    setDownloading(false);
    setProgress(0);
  }, []);

  return { downloaded, downloading, progress, error, download, cancel, recheck };
}

export type ModelStatus = ReturnType<typeof useModelStatus>;
