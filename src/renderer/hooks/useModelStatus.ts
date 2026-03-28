import { useState, useEffect, useCallback, useRef } from 'react';
import log from 'electron-log/renderer';

export function useModelStatus() {
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const cleanupRef = useRef<(() => void) | null>(null);

  const recheck = useCallback(async () => {
    try {
      const [status, models] = await Promise.all([
        window.dictator.checkModelStatus(),
        window.dictator.getDownloadedModels(),
      ]);
      setDownloaded(status.downloaded);
      setDownloadedModels(models);
    } catch (err) {
      log.error('Failed to check model status:', err);
    }
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
      // Refresh downloaded models list — partial .onnx files on disk
      // could cause false-positive green checkmarks after a failed download.
      window.dictator.getDownloadedModels().then(setDownloadedModels);
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
