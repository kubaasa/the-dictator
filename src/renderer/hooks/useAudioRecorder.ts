import { useState, useRef, useCallback, useEffect } from 'react';

interface UseAudioRecorderReturn {
  isRecording: boolean;
  error: string;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clearError: () => void;
}

export function useAudioRecorder(deviceId?: string | null): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');
  const isRecordingRef = useRef(false);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);

  // Bug #2: race condition flags for push-to-talk
  const isSettingUpRef = useRef(false);
  const pendingStopRef = useRef(false);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || isSettingUpRef.current) return;
    try {
      const { ready, error: readyError } = await window.dictator.checkTranscriptionReady();
      if (!ready) {
        setError(readyError ?? 'Transcription not ready');
        return;
      }
      setError('');
      isSettingUpRef.current = true;
      pendingStopRef.current = false;

      // Bug #1: get mic BEFORE notifying main process
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Mic acquired — now tell main process
      isRecordingRef.current = true;
      setIsRecording(true);
      window.dictator.startRecording();

      mediaStreamRef.current = stream;

      // Force 16kHz: Whisper only needs 16kHz, this makes IPC payload 3x smaller
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      chunksRef.current = [];

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(inputData));

        // RMS → voice activity level for overlay lip-sync
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const level = Math.min(1, rms / 0.15);
        window.dictator.sendVoiceActivity(level);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      isSettingUpRef.current = false;

      // Bug #2: if stop was requested during setup, execute it now
      if (pendingStopRef.current) {
        pendingStopRef.current = false;
        stopRecording();
      }
    } catch (err) {
      console.error('Failed to start recording:', err);
      isSettingUpRef.current = false;
      pendingStopRef.current = false;
      isRecordingRef.current = false;
      setIsRecording(false);
      setError(err instanceof Error ? err.message : 'Failed to access microphone');
      // Safety: in case startRecording IPC was already sent
      window.dictator.stopRecording();
    }
  }, []);

  const stopRecording = useCallback(async () => {
    // Bug #2: if still setting up, defer the stop
    if (isSettingUpRef.current) {
      pendingStopRef.current = true;
      return;
    }

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

      const sampleRate = audioContext.sampleRate;
      // Don't await — release mic hardware in background, don't block transcription
      audioContext.close();
      audioContextRef.current = null;

      // Fire-and-forget: result arrives via onTranscriptionResult event
      window.dictator.transcribeBuffer(merged.buffer, sampleRate);
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
