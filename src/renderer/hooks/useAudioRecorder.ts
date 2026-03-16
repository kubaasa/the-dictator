import { useState, useRef, useCallback, useEffect } from 'react';

// AudioWorklet processor — runs in a dedicated audio thread (immune to main-thread jank).
// Accumulates 4096-sample chunks (~256ms at 16kHz) before posting to the main thread,
// matching the old ScriptProcessorNode cadence but without dropped frames.
const WORKLET_PROCESSOR_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(4096);
    this._offset = 0;
    this._stopped = false;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this._stopped = true;
    };
  }

  process(inputs) {
    if (this._stopped) return false;
    const input = inputs[0];
    if (!input || !input[0]) return true;

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
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);


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
      // Show overlay immediately with loading animation (before slow getUserMedia)
      window.dictator.initRecording();

      const { ready, error: readyError } = await window.dictator.checkTranscriptionReady();
      if (!ready) {
        setError(readyError ?? 'Transcription not ready');
        window.dictator.stopRecording();
        return;
      }
      setError('');
      isSettingUpRef.current = true;
      pendingStopRef.current = false;

      // Ensure previous AudioContext is fully closed before creating a new one —
      // unclosed contexts accumulate and degrade audio quality after several recordings
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch { /* already closed */ }
        audioContextRef.current = null;
      }

      // Disable WebRTC processing — dictation needs raw, clean audio signal.
      // echoCancellation/noiseSuppression are designed for VoIP calls and cause
      // voice harmonics loss + artifacts in speech-to-text scenarios.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // Guard: cancelled during getUserMedia (e.g. PTT released before mic was ready)
      if (!isSettingUpRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

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

      // Register AudioWorklet processor (runs in dedicated audio thread — immune to
      // main-thread GC pauses, React re-renders, and IPC overhead that caused frame
      // drops with the old ScriptProcessorNode)
      const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const workletNode = new AudioWorkletNode(audioContext, 'recorder-processor');
      workletNodeRef.current = workletNode;
      chunksRef.current = [];

      workletNode.port.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'audio') {
          chunksRef.current.push(e.data.samples);
        } else if (e.data.type === 'level') {
          window.dictator.sendVoiceActivity(e.data.level);
        }
      };

      // Route through a silent gain node — worklet needs a destination connection
      // to keep the audio graph alive
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      source.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

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
  }, [deviceId]);

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

    // Signal the worklet processor to stop
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage('stop');
    }

    // Snapshot refs and null immediately to prevent race with rapid re-start
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    const chunks = chunksRef.current;
    chunksRef.current = [];

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // Send buffer for transcription BEFORE closing context — minimize latency
    if (chunks.length > 0 && audioContext) {
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const sampleRate = audioContext.sampleRate;
      // Fire-and-forget: result arrives via onTranscriptionResult event
      window.dictator.transcribeBuffer(merged.buffer, sampleRate, recordingIdRef.current);
    }

    // Always close AudioContext — even for empty recordings (prevents accumulation)
    if (audioContext) {
      try { await audioContext.close(); } catch { /* already closed */ }
    }

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
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage('stop');
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
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
