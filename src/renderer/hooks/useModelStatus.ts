import { useState, useEffect, useCallback, useRef } from 'react';

export function useModelStatus() {
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  // Holds cleanup functions for active IPC listeners so cancel() can remove them
  const cleanupRef = useRef<(() => void) | null>(null);

  const recheck = useCallback(async () => {
    const [status, models] = await Promise.all([
      window.dictator.checkModelStatus(),
      window.dictator.getDownloadedModels(),
    ]);
    setDownloaded(status.downloaded);
    setDownloadedModels(models);
  }, []);

  useEffect(() => {
    recheck();
  }, [recheck]);

  const download = useCallback(() => {
    setDownloading(true);
    setProgress(0);
    setError('');

    const listeners: (() => void)[] = [];

    const cleanup = () => {
      for (const unsub of listeners) unsub();
      listeners.length = 0;
      cleanupRef.current = null;
    };

    listeners.push(window.dictator.onModelProgress((pct) => setProgress(pct)));

    listeners.push(window.dictator.onModelDone(() => {
      cleanup();
      setDownloaded(true);
      setDownloading(false);
      setProgress(100);
      window.dictator.getDownloadedModels().then(setDownloadedModels);
    }));

    listeners.push(window.dictator.onModelError((msg) => {
      cleanup();
      setError(msg);
      setDownloading(false);
    }));

    cleanupRef.current = cleanup;
    window.dictator.downloadModel();
  }, []);

  const cancel = useCallback(() => {
    window.dictator.cancelDownload();
    cleanupRef.current?.();
    setDownloading(false);
    setProgress(0);
  }, []);

  return { downloaded, downloadedModels, downloading, progress, error, download, cancel, recheck };
}

export type ModelStatus = ReturnType<typeof useModelStatus>;
