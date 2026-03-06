import { useState, useRef, useCallback, useEffect } from 'react';

interface UseAudioRecorderReturn {
  isRecording: boolean;
  error: string;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clearError: () => void;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');
  const isRecordingRef = useRef(false);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;
    try {
      const { ready, error: readyError } = await window.dictator.checkTranscriptionReady();
      if (!ready) {
        setError(readyError ?? 'Transcription not ready');
        return;
      }
      setError('');
      isRecordingRef.current = true;
      setIsRecording(true);
      window.dictator.startRecording();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      mediaStreamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      chunksRef.current = [];

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(inputData));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      console.error('Failed to start recording:', err);
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);
    window.dictator.stopRecording();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    const audioContext = audioContextRef.current;
    const chunks = chunksRef.current;

    if (audioContext && chunks.length > 0) {
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const wavPath = await window.dictator.saveWav(merged.buffer, audioContext.sampleRate);

      await audioContext.close();
      audioContextRef.current = null;

      // Fire-and-forget: result arrives via onTranscriptionResult event
      window.dictator.transcribe(wavPath);
    }

    chunksRef.current = [];
  }, []);

  // Listen for global hotkey toggle from main process
  useEffect(() => {
    const unsub = window.dictator.onHotkeyToggle(() => {
      if (isRecordingRef.current) {
        stopRecording();
      } else {
        startRecording();
      }
    });
    return unsub;
  }, [startRecording, stopRecording]);

  const clearError = useCallback(() => setError(''), []);

  return { isRecording, error, startRecording, stopRecording, clearError };
}
