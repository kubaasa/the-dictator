import { useState, useRef, useCallback, useEffect } from 'react';

interface UseAudioRecorderReturn {
  isRecording: boolean;
  error: string;
  lastDurationSeconds: number;
  recordingStartTime: number | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clearError: () => void;
}

export function useAudioRecorder(deviceId?: string | null): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');
  const [lastDurationSeconds, setLastDurationSeconds] = useState(0);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const isRecordingRef = useRef(false);
  const recordingStartTimeRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const vadFrameCounterRef = useRef(0);

  // Bug #2: race condition flags for push-to-talk
  const isSettingUpRef = useRef(false);
  const pendingStopRef = useRef(false);

  // MediaRecorder for WebM audio (saved to history)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);

  // Coordination between MediaRecorder.onstop and onTranscriptionResult
  const recordingIdRef = useRef<string>('');
  const pendingAudioBufferRef = useRef<ArrayBuffer | null>(null);
  const transcriptionResultIdRef = useRef<string | null>(null);

  // Called from both sides — sends audio when both id and buffer are ready
  const trySendAudio = useCallback((id: string, buffer?: ArrayBuffer) => {
    if (buffer) pendingAudioBufferRef.current = buffer;
    if (id) transcriptionResultIdRef.current = id;

    if (
      transcriptionResultIdRef.current &&
      transcriptionResultIdRef.current === recordingIdRef.current &&
      pendingAudioBufferRef.current
    ) {
      const buf = pendingAudioBufferRef.current;
      const rid = transcriptionResultIdRef.current;
      pendingAudioBufferRef.current = null;
      transcriptionResultIdRef.current = null;
      window.dictator.audio.save(rid, buf).catch((e) => console.warn('[Dictator] audio save failed:', e));
    }
  }, []);

  // Listen for transcription result to coordinate audio save
  useEffect(() => {
    const unsub = window.dictator.onTranscriptionResult((result) => {
      if (result.id) {
        trySendAudio(result.id);
      }
    });
    return unsub;
  }, [trySendAudio]);

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

      // Generate unique id for this recording before transcription starts
      recordingIdRef.current = Date.now().toString();
      pendingAudioBufferRef.current = null;
      transcriptionResultIdRef.current = null;

      // Start MediaRecorder to collect WebM audio for history
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
      if (mimeType) {
        mediaChunksRef.current = [];
        const mr = new MediaRecorder(stream, { mimeType });
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) mediaChunksRef.current.push(e.data);
        };
        mr.onstop = async () => {
          const blob = new Blob(mediaChunksRef.current, { type: mimeType });
          mediaChunksRef.current = [];
          const buffer = await blob.arrayBuffer();
          trySendAudio(recordingIdRef.current, buffer);
        };
        mr.start();
        mediaRecorderRef.current = mr;
      }

      // Mic acquired — now tell main process
      isRecordingRef.current = true;
      const startTime = Date.now();
      recordingStartTimeRef.current = startTime;
      setRecordingStartTime(startTime);
      setIsRecording(true);
      window.dictator.startRecording();

      mediaStreamRef.current = stream;

      // Force 16kHz: Whisper only needs 16kHz, this makes IPC payload 3x smaller
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      chunksRef.current = [];

      vadFrameCounterRef.current = 0;
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(inputData));

        // Throttle VAD IPC: send every 2nd frame (~512ms at 16kHz/4096 buffer)
        if (++vadFrameCounterRef.current % 2 === 0) {
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          const level = Math.min(1, rms / 0.15);
          window.dictator.sendVoiceActivity(level);
        }
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
    if (recordingStartTimeRef.current !== null) {
      setLastDurationSeconds((Date.now() - recordingStartTimeRef.current) / 1000);
      recordingStartTimeRef.current = null;
    }
    setRecordingStartTime(null);
    window.dictator.stopRecording();

    // Stop MediaRecorder before stopping stream tracks so it captures all audio
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop(); // onstop fires async with the collected blob
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
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
      window.dictator.transcribeBuffer(merged.buffer, sampleRate, recordingIdRef.current);
    }

    chunksRef.current = [];
  }, []);

  const cancelRecording = useCallback(() => {
    if (!isRecordingRef.current && !isSettingUpRef.current) return;

    isRecordingRef.current = false;
    isSettingUpRef.current = false;
    pendingStopRef.current = false;
    setIsRecording(false);
    setRecordingStartTime(null);
    setError('');

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      mediaRecorderRef.current = null;
    }
    mediaChunksRef.current = [];
    pendingAudioBufferRef.current = null;
    transcriptionResultIdRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    chunksRef.current = [];
    window.dictator.stopRecording();
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

  // Listen for cancel hotkey
  useEffect(() => {
    const unsub = window.dictator.onHotkeyCancel(() => {
      cancelRecording();
    });
    return unsub;
  }, [cancelRecording]);

  const clearError = useCallback(() => setError(''), []);

  return { isRecording, error, lastDurationSeconds, recordingStartTime, startRecording, stopRecording, clearError };
}
