import { useState, useRef, useCallback, useEffect } from 'react';
import log from 'electron-log/renderer';

// AudioWorklet processor: accumulates 4096-sample chunks (~256ms at 16kHz) in a dedicated
// audio thread, immune to main-thread jank. Posts chunks + RMS level to the main thread.
const WORKLET_PROCESSOR_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(4096);
    this._offset = 0;
    this._stopped = false;
    this._emptyFrames = 0;
    this._noInputSent = false;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        // Flush remaining samples before terminating — prevents up to 256ms audio loss
        if (this._offset > 0) {
          const partial = new Float32Array(this._buffer.subarray(0, this._offset));
          this.port.postMessage({ type: 'audio', samples: partial }, [partial.buffer]);
          this._offset = 0;
        }
        this.port.postMessage({ type: 'done' });
        this._stopped = true;
      }
    };
  }

  process(inputs) {
    if (this._stopped) return false;
    const input = inputs[0];
    if (!input || !input[0]) {
      this._emptyFrames++;
      if (!this._noInputSent && this._emptyFrames > 250) {
        this.port.postMessage({ type: 'no-input' });
        this._noInputSent = true;
      }
      return true;
    }
    this._emptyFrames = 0;

    const samples = input[0];
    let srcOffset = 0;

    while (srcOffset < samples.length) {
      const remaining = 4096 - this._offset;
      const toCopy = Math.min(remaining, samples.length - srcOffset);
      this._buffer.set(samples.subarray(srcOffset, srcOffset + toCopy), this._offset);
      this._offset += toCopy;
      srcOffset += toCopy;

      if (this._offset >= 4096) {
        const copy = new Float32Array(this._buffer);
        this.port.postMessage({ type: 'audio', samples: copy }, [copy.buffer]);

        let sum = 0;
        for (let i = 0; i < 4096; i++) {
          sum += this._buffer[i] * this._buffer[i];
        }
        this.port.postMessage({
          type: 'level',
          level: Math.min(1, Math.sqrt(sum / 4096) / 0.15),
        });

        this._offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
`;

function classifyMicError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotFoundError':
        return 'No microphone detected. Connect a microphone and try again.';
      case 'NotAllowedError':
        return 'Microphone access denied. Allow access in Windows Settings > Privacy > Microphone.';
      case 'NotReadableError':
        return 'Microphone is in use by another application. Close the other app and try again.';
      case 'AbortError':
        return 'Microphone access was blocked. Check Windows Settings > Privacy & Security > Microphone.';
      case 'OverconstrainedError':
        return 'Selected microphone is unavailable. Check device in settings and try again.';
    }
  }
  if (err instanceof Error) return err.message;
  return 'Failed to access microphone. Check your audio device and try again.';
}

interface UseAudioRecorderReturn {
  isRecording: boolean;
  error: string;
  errorType: string;
  lastDurationSeconds: number;
  recordingStartTime: number | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clearError: () => void;
}

export function useAudioRecorder(deviceId?: string | null): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');
  const [errorType, setErrorType] = useState('');
  const [lastDurationSeconds, setLastDurationSeconds] = useState(0);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const isRecordingRef = useRef(false);
  const recordingStartTimeRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);

  const persistentCtxRef = useRef<AudioContext | null>(null);
  const workletReadyRef = useRef(false);

  // Race condition guards for push-to-talk — sessionIdRef is a monotonic counter.
  // After every await in startRecording, we check if the session is still current.
  // If not, the setup was superseded (e.g. cancel during getUserMedia) and we bail out.
  const isSettingUpRef = useRef(false);
  const pendingStopRef = useRef(false);
  const sessionIdRef = useRef(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);

  // Coordination: MediaRecorder.onstop (→ buffer) and onTranscriptionResult (→ result ID)
  // arrive independently. We match them by snapshotted recording ID — NOT recordingIdRef.current,
  // which may already point to a new recording if the user started one quickly.
  const recordingIdRef = useRef<string>('');
  const pendingAudioRef = useRef<{ id: string; buffer: ArrayBuffer } | null>(null);
  const pendingResultIdRef = useRef<string | null>(null);

  const trySendAudio = useCallback((id: string, buffer?: ArrayBuffer) => {
    if (buffer) pendingAudioRef.current = { id, buffer };
    if (!buffer) pendingResultIdRef.current = id;

    const audio = pendingAudioRef.current;
    const resultId = pendingResultIdRef.current;

    if (audio && resultId && audio.id === resultId) {
      pendingAudioRef.current = null;
      pendingResultIdRef.current = null;
      window.dictator.audio.save(resultId, audio.buffer).catch((e) => log.warn('audio save failed:', e));
    }
  }, []);

  useEffect(() => {
    const unsub = window.dictator.onTranscriptionResult((result) => {
      if (result.id) {
        trySendAudio(result.id);
      }
    });
    return unsub;
  }, [trySendAudio]);

  const getOrCreateAudioContext = useCallback(async (): Promise<AudioContext> => {
    if (persistentCtxRef.current && persistentCtxRef.current.state !== 'closed' && workletReadyRef.current) {
      if (persistentCtxRef.current.state === 'suspended') {
        await persistentCtxRef.current.resume();
      }
      return persistentCtxRef.current;
    }

    // Close stale context (exists but worklet not registered, or other bad state)
    if (persistentCtxRef.current && persistentCtxRef.current.state !== 'closed') {
      try { await persistentCtxRef.current.close(); } catch { /* ignore */ }
    }

    const ctx = new AudioContext({ sampleRate: 16000 });
    persistentCtxRef.current = ctx;
    workletReadyRef.current = false;

    const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      workletReadyRef.current = true;
    } finally {
      URL.revokeObjectURL(workletUrl);
    }

    return ctx;
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || isSettingUpRef.current) return;

    const thisSession = ++sessionIdRef.current;
    isSettingUpRef.current = true;
    pendingStopRef.current = false;

    try {
      window.dictator.initRecording();

      const { ready, error: readyError, errorType: readyErrorType } = await window.dictator.checkTranscriptionReady();
      if (sessionIdRef.current !== thisSession) return;
      if (!ready) {
        isSettingUpRef.current = false;
        pendingStopRef.current = false;
        setError(readyError ?? 'Transcription not ready');
        setErrorType(readyErrorType ?? '');
        return;
      }
      setError('');
      setErrorType('');

      const micStatus = await window.dictator.checkMicSystemPermission();
      if (sessionIdRef.current !== thisSession) return;
      if (micStatus === 'denied') {
        isSettingUpRef.current = false;
        pendingStopRef.current = false;
        const msg = 'Microphone access blocked by Windows. Enable it in Settings > Privacy & Security > Microphone.';
        setError(msg);
        setErrorType('system-denied');
        window.dictator.reportMicError(msg);
        window.dictator.stopRecording();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      if (sessionIdRef.current !== thisSession) {
        stream.getTracks().forEach(t => t.stop());
        window.dictator.stopRecording();
        return;
      }

      recordingIdRef.current = Date.now().toString();
      pendingAudioRef.current = null;
      pendingResultIdRef.current = null;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
      if (!mimeType) {
        log.warn('No WebM mimeType supported by MediaRecorder — compressed audio unavailable, API uploads will use WAV fallback');
      }
      if (mimeType) {
        mediaChunksRef.current = [];
        const mr = new MediaRecorder(stream, { mimeType });
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) mediaChunksRef.current.push(e.data);
        };
        mr.start();
        mediaRecorderRef.current = mr;
      }

      isRecordingRef.current = true;
      const startTime = Date.now();
      recordingStartTimeRef.current = startTime;
      setRecordingStartTime(startTime);
      setIsRecording(true);
      window.dictator.startRecording();

      mediaStreamRef.current = stream;

      let audioContext = await getOrCreateAudioContext();
      if (sessionIdRef.current !== thisSession) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      audioContextRef.current = audioContext;

      let source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      let workletNode: AudioWorkletNode;
      try {
        workletNode = new AudioWorkletNode(audioContext, 'recorder-processor');
      } catch (workletErr) {
        // Worklet registration lost (e.g. after Teams/Meet took over audio) — recreate context
        log.warn('AudioWorkletNode creation failed, recreating audio context:', workletErr);
        workletReadyRef.current = false;
        try { await persistentCtxRef.current?.close(); } catch { /* ignore */ }
        persistentCtxRef.current = null;

        audioContext = await getOrCreateAudioContext();
        if (sessionIdRef.current !== thisSession) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        audioContextRef.current = audioContext;
        source.disconnect();
        source = audioContext.createMediaStreamSource(stream);
        sourceRef.current = source;
        workletNode = new AudioWorkletNode(audioContext, 'recorder-processor');
      }
      workletNodeRef.current = workletNode;
      chunksRef.current = [];

      workletNode.port.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'audio') {
          chunksRef.current.push(e.data.samples);
        } else if (e.data.type === 'level') {
          window.dictator.sendVoiceActivity(e.data.level);
        } else if (e.data.type === 'no-input') {
          log.warn('AudioWorklet: no audio input detected — mic may be disconnected or context suspended');
        }
      };

      // Silent gain node keeps the audio graph alive so the worklet keeps processing
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      source.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

      isSettingUpRef.current = false;

      if (pendingStopRef.current) {
        pendingStopRef.current = false;
        stopRecording();
      }
    } catch (err) {
      if (sessionIdRef.current !== thisSession) return;
      log.error('Failed to start recording:', err);
      isSettingUpRef.current = false;
      pendingStopRef.current = false;
      isRecordingRef.current = false;
      setIsRecording(false);
      setRecordingStartTime(null);

      const message = classifyMicError(err);
      setError(message);
      setErrorType('');
      window.dictator.reportMicError(message);
    }
  }, [deviceId, getOrCreateAudioContext]);

  const stopRecording = useCallback(async () => {
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

    const snapshotRecordingId = recordingIdRef.current;

    let compressedBlobPromise: Promise<ArrayBuffer> | null = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      const mr = mediaRecorderRef.current;
      compressedBlobPromise = new Promise<ArrayBuffer>((resolve) => {
        const prevOnStop = mr.onstop;
        mr.onstop = async (ev) => {
          const blob = new Blob(mediaChunksRef.current, { type: mr.mimeType });
          mediaChunksRef.current = [];
          const buffer = await blob.arrayBuffer();
          trySendAudio(snapshotRecordingId, buffer);
          resolve(buffer);
          if (prevOnStop) prevOnStop.call(mr, ev);
        };
      });
      mr.stop();
      mediaRecorderRef.current = null;
    }

    // Signal worklet to flush remaining audio, then wait for 'done' before stopping mic.
    // Tracks must stay alive until worklet finishes so in-flight frames aren't dropped.
    if (workletNodeRef.current) {
      await new Promise<void>((resolve) => {
        const port = workletNodeRef.current?.port;
        if (!port) { resolve(); return; }
        const prevHandler = port.onmessage;
        port.onmessage = (ev) => {
          if (prevHandler) prevHandler.call(port, ev);
          if (ev.data?.type === 'done') {
            port.onmessage = null;
            resolve();
          }
        };
        port.postMessage('stop');
        setTimeout(() => { port.onmessage = null; resolve(); }, 1000); // safety timeout
      });
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    const chunks = chunksRef.current;
    chunksRef.current = [];

    // Broadcast state change IMMEDIATELY after stopping tracks so the overlay
    // releases its own mic stream without waiting for the rest of cleanup.
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const hasAudio = totalLength > 0 && !!audioContext;
    window.dictator.stopRecording(!hasAudio);

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // Close persistent AudioContext so Windows fully releases the microphone device.
    // A new context + worklet will be created on the next recording start.
    if (persistentCtxRef.current && persistentCtxRef.current.state !== 'closed') {
      persistentCtxRef.current.close().catch(() => { /* ignore */ });
      persistentCtxRef.current = null;
      workletReadyRef.current = false;
    }

    if (hasAudio) {
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const sampleRate = audioContext.sampleRate;
      // Wait for compressed WebM/Opus blob (~8x smaller than WAV for API upload).
      // Timeout guard: proceed without compressed audio if onstop never fires.
      let compressedAudio: ArrayBuffer | undefined;
      if (compressedBlobPromise) {
        try {
          compressedAudio = await Promise.race([
            compressedBlobPromise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('MediaRecorder flush timeout')), 5000)),
          ]);
        } catch (e) {
          log.warn('Compressed audio unavailable, proceeding with raw buffer:', e);
        }
      }
      window.dictator.transcribeBuffer(merged.buffer, sampleRate, snapshotRecordingId, compressedAudio)
        .catch((err: unknown) => {
          log.error('transcribeBuffer failed:', err);
          // Reset recording state so UI doesn't stay stuck in transcribing/processing
          isRecordingRef.current = false;
          setIsRecording(false);
          setRecordingStartTime(null);
          setError(err instanceof Error ? err.message : 'Transcription failed — please try again');
        });
    }
  }, []);

  const cancelRecording = useCallback(() => {
    if (!isRecordingRef.current && !isSettingUpRef.current) return;

    sessionIdRef.current++;
    isRecordingRef.current = false;
    isSettingUpRef.current = false;
    pendingStopRef.current = false;
    setIsRecording(false);
    setRecordingStartTime(null);
    setError('');

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (err) { log.debug('MediaRecorder.stop() threw during cleanup:', err); }
      mediaRecorderRef.current = null;
    }
    mediaChunksRef.current = [];
    pendingAudioRef.current = null;
    pendingResultIdRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    window.dictator.stopRecording();
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage('stop');
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    audioContextRef.current = null;
    chunksRef.current = [];
    if (persistentCtxRef.current && persistentCtxRef.current.state !== 'closed') {
      persistentCtxRef.current.close().catch(() => { /* ignore */ });
      persistentCtxRef.current = null;
      workletReadyRef.current = false;
    }
  }, []);

  useEffect(() => {
    const unsub = window.dictator.onHotkeyToggle(() => {
      if (isRecordingRef.current || isSettingUpRef.current) {
        stopRecording();
      } else {
        startRecording();
      }
    });
    return unsub;
  }, [startRecording, stopRecording]);

  useEffect(() => {
    const unsub = window.dictator.onHotkeyCancel(cancelRecording);
    return unsub;
  }, [cancelRecording]);

  useEffect(() => {
    return () => {
      if (persistentCtxRef.current && persistentCtxRef.current.state !== 'closed') {
        persistentCtxRef.current.close();
        persistentCtxRef.current = null;
        workletReadyRef.current = false;
      }
    };
  }, []);

  const clearError = useCallback(() => { setError(''); setErrorType(''); }, []);

  return { isRecording, error, errorType, lastDurationSeconds, recordingStartTime, startRecording, stopRecording, clearError };
}
