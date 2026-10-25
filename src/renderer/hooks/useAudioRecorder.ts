import { useState, useRef, useCallback, useEffect } from 'react';
import log from 'electron-log/renderer';

// AudioWorklet processor: accumulates 4096-sample chunks (~256ms at 16kHz) in a dedicated
// audio thread, immune to main-thread jank. Posts chunks to the main thread for transcription.
// Level messages (with 8-band spectral energy via Goertzel) are posted every ~256 samples
// (~16ms at 16kHz ≈ 62.5Hz) so the overlay visualization gets real frequency data.
const WORKLET_PROCESSOR_CODE = `
// Goertzel magnitude for a single DFT bin k out of N samples — O(N) per bin
function goertzelMag(buf, N, k) {
  var w = 2 * Math.PI * k / N;
  var coeff = 2 * Math.cos(w);
  var s1 = 0, s2 = 0, s0;
  for (var i = 0; i < N; i++) {
    s0 = buf[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / N;
}

// 8 log-spaced DFT bins for voice spectral analysis at 16kHz / 256 samples (62.5Hz resolution)
// Bins: ~125Hz, ~250Hz, ~500Hz, ~1kHz, ~2kHz, ~3kHz, ~4.5kHz, ~7kHz
var BAND_BINS = [2, 4, 8, 16, 32, 48, 72, 112];
var NUM_BANDS = 8;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(4096);
    this._offset = 0;
    this._stopped = false;
    this._emptyFrames = 0;
    this._noInputSent = false;
    this._levelBuf = new Float32Array(256);
    this._levelOffset = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
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

    var copied = 0;
    while (copied < samples.length) {
      var space = 256 - this._levelOffset;
      var take = Math.min(space, samples.length - copied);
      this._levelBuf.set(samples.subarray(copied, copied + take), this._levelOffset);
      this._levelOffset += take;
      copied += take;

      if (this._levelOffset >= 256) {
        var sum = 0;
        for (var j = 0; j < 256; j++) sum += this._levelBuf[j] * this._levelBuf[j];
        var rms = Math.min(1, Math.sqrt(sum / 256) / 0.15);

        // 8-band spectral energy via Goertzel, normalized to spectral shape (0-1)
        var bands = new Float32Array(NUM_BANDS);
        var maxBand = 0;
        for (var b = 0; b < NUM_BANDS; b++) {
          bands[b] = goertzelMag(this._levelBuf, 256, BAND_BINS[b]);
          if (bands[b] > maxBand) maxBand = bands[b];
        }
        if (maxBand > 0.0001) {
          for (var b = 0; b < NUM_BANDS; b++) bands[b] = bands[b] / maxBand;
        }

        this.port.postMessage({ type: 'level', level: rms, bands: bands });
        this._levelOffset = 0;
      }
    }

    // Accumulate audio chunks for transcription (4096-sample blocks)
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
        this._offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
`;

const recLog = log.scope('Recorder');

// ~18% of recordings ended with zero worklet samples and no error in the logs. Diagnostics
// below (track/context one-liners, watchdog, empty-stop summary) exist so the next occurrence
// explains itself in main.log instead of silently going idle.
const PIPELINE_WATCHDOG_MS = 1500;

function describeTrack(track: MediaStreamTrack | undefined): string {
  if (!track) return 'track=none';
  const s = track.getSettings();
  return `track="${track.label}" state=${track.readyState} muted=${track.muted} enabled=${track.enabled}`
    + ` rate=${s.sampleRate ?? '?'} aec=${s.echoCancellation ?? '?'} ns=${s.noiseSuppression ?? '?'}`;
}

function describeCtx(ctx: AudioContext | null): string {
  if (!ctx) return 'ctx=none';
  return `ctx=${ctx.state} time=${ctx.currentTime.toFixed(3)} rate=${ctx.sampleRate} latency=${ctx.baseLatency.toFixed(4)}`;
}

const WHISPER_SAMPLE_RATE = 16000;

// The MediaRecorder capture runs on the mic track directly, independent of the AudioContext
// that feeds the worklet, so it survives a stalled context. Decoding it through an offline
// context resamples to 16 kHz, which is what the worklet would have produced.
async function decodeCompressedAudio(compressed: ArrayBuffer): Promise<Float32Array | null> {
  if (compressed.byteLength === 0) return null;
  try {
    const ctx = new OfflineAudioContext(1, 1, WHISPER_SAMPLE_RATE);
    const decoded = await ctx.decodeAudioData(compressed.slice(0));
    return decoded.length > 0 ? decoded.getChannelData(0) : null;
  } catch (err) {
    log.warn('Compressed audio could not be decoded:', err);
    return null;
  }
}

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

export function useAudioRecorder(
  resolveDeviceId: () => Promise<string | null>,
  callMode?: boolean,
): UseAudioRecorderReturn {
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

  const levelCountRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearWatchdog() {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }

  // Race condition guards for push-to-talk — sessionIdRef is a monotonic counter.
  // After every await in startRecording, we check if the session is still current.
  // If not, the setup was superseded (e.g. cancel during getUserMedia) and we bail out.
  const isSettingUpRef = useRef(false);
  // stopRecording awaits the worklet flush (up to 1 s when the pipeline is stalled) before it
  // releases the stream/context refs. A startRecording in that window would populate the same
  // refs and then have them torn down by the tail of the stop, so starts are refused until done.
  const isStoppingRef = useRef(false);
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

  // Shared cleanup — resets all recording state and releases hardware resources.
  // Used by both cancelRecording and the no-input handler to avoid duplicated logic.
  function teardownRecording() {
    sessionIdRef.current++;
    clearWatchdog();
    isRecordingRef.current = false;
    isSettingUpRef.current = false;
    pendingStopRef.current = false;
    setIsRecording(false);
    setRecordingStartTime(null);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
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
  }

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

    // sinkId 'none': render on a timer, detached from any output device. The default sink
    // follows the system output endpoint, which changes mid-start on Bluetooth headsets
    // (A2DP→HFP switch triggered by opening the mic) — a context created in that window never
    // started rendering, so the worklet produced zero samples and the recording went idle.
    // TS 4.5 lib.dom predates AudioContextOptions.sinkId, hence the cast.
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: 16000, sinkId: { type: 'none' } } as AudioContextOptions);
    } catch (sinkErr) {
      recLog.warn('AudioContext with sinkId none failed, falling back to default sink:', sinkErr);
      ctx = new AudioContext({ sampleRate: 16000 });
    }
    persistentCtxRef.current = ctx;
    workletReadyRef.current = false;

    ctx.addEventListener('statechange', () => recLog.info('context statechange:', describeCtx(ctx)));
    ctx.addEventListener('error', (ev) => recLog.error('context error event:', ev, describeCtx(ctx)));
    recLog.info('context created:', describeCtx(ctx));

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
    if (isStoppingRef.current) {
      recLog.warn('start ignored: previous recording is still flushing');
      return;
    }

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
      if (micStatus === 'denied' || micStatus === 'restricted') {
        isSettingUpRef.current = false;
        pendingStopRef.current = false;
        const msg = 'Microphone access blocked by Windows. Enable it in Settings > Privacy & Security > Microphone.';
        setError(msg);
        setErrorType('system-denied');
        window.dictator.reportMicError(msg);
        window.dictator.stopRecording();
        return;
      }

      // Resolved from a fresh enumeration so a headset switched seconds ago is honoured even
      // if no 'devicechange' event reached the selector yet.
      const deviceId = await resolveDeviceId();
      if (sessionIdRef.current !== thisSession) return;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            channelCount: 1,
            echoCancellation: !!callMode,
            noiseSuppression: !!callMode,
            autoGainControl: !!callMode,
          },
        });
      } catch (micErr) {
        // Saved device unavailable (e.g. after reboot) — retry with default mic before giving up
        if (micErr instanceof DOMException && micErr.name === 'OverconstrainedError' && deviceId) {
          log.warn('Saved mic unavailable, falling back to default device');
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                channelCount: 1,
                echoCancellation: !!callMode,
                noiseSuppression: !!callMode,
                autoGainControl: !!callMode,
              },
            });
            if (sessionIdRef.current !== thisSession) {
              stream.getTracks().forEach(t => t.stop());
              return;
            }
          } catch (fallbackErr) {
            if (sessionIdRef.current !== thisSession) return;
            log.error('getUserMedia fallback also failed:', fallbackErr);
            isSettingUpRef.current = false;
            pendingStopRef.current = false;
            const message = classifyMicError(fallbackErr);
            setError(message);
            setErrorType('');
            window.dictator.reportMicError(message);
            return;
          }
        } else if (micErr instanceof DOMException && micErr.name === 'NotReadableError') {
          // Mic may be momentarily busy (e.g. Teams/Zoom releasing it) — retry once after brief delay
          log.warn('Mic busy (NotReadableError), retrying in 400ms...');
          await new Promise(r => setTimeout(r, 400));
          if (sessionIdRef.current !== thisSession) return;
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
                channelCount: 1,
                echoCancellation: !!callMode,
                noiseSuppression: !!callMode,
                autoGainControl: !!callMode,
              },
            });
            if (sessionIdRef.current !== thisSession) {
              stream.getTracks().forEach(t => t.stop());
              return;
            }
          } catch (retryErr) {
            if (sessionIdRef.current !== thisSession) return;
            log.error('getUserMedia retry also failed:', retryErr);
            isSettingUpRef.current = false;
            pendingStopRef.current = false;
            const message = classifyMicError(retryErr);
            setError(message);
            setErrorType('');
            window.dictator.reportMicError(message);
            return;
          }
        } else {
          if (sessionIdRef.current !== thisSession) return;
          log.error('getUserMedia failed:', micErr);
          isSettingUpRef.current = false;
          pendingStopRef.current = false;
          const message = classifyMicError(micErr);
          setError(message);
          setErrorType('');
          window.dictator.reportMicError(message);
          return;
        }
      }

      if (sessionIdRef.current !== thisSession) {
        stream.getTracks().forEach(t => t.stop());
        window.dictator.stopRecording();
        return;
      }

      const micTrack = stream.getAudioTracks()[0];
      recLog.info('mic stream acquired:', describeTrack(micTrack));
      if (micTrack) {
        micTrack.addEventListener('mute', () => recLog.warn('mic track muted:', describeTrack(micTrack)));
        micTrack.addEventListener('unmute', () => recLog.info('mic track unmuted:', describeTrack(micTrack)));
        micTrack.addEventListener('ended', () => recLog.warn('mic track ended:', describeTrack(micTrack)));
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
          levelCountRef.current++;
          window.dictator.sendVoiceActivity(e.data.level, e.data.bands ? Array.from(e.data.bands) : undefined);
        } else if (e.data.type === 'no-input') {
          log.warn('AudioWorklet: no audio input detected — mic may have been taken by another app');
          if (isRecordingRef.current) {
            teardownRecording();
            const message = 'Microphone stopped responding — it may have been taken by another application.';
            setError(message);
            setErrorType('');
            window.dictator.reportMicError(message);
          }
        }
      };

      // Silent gain node keeps the audio graph alive so the worklet keeps processing
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      source.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);

      levelCountRef.current = 0;
      const wiredCtx = audioContext;
      const wiredTime = wiredCtx.currentTime;
      recLog.info('pipeline wired:', describeCtx(wiredCtx));
      // Dead-pipeline detector: a healthy 16kHz context advances currentTime and posts
      // ~90 level messages in 1.5s. Log only — evidence first, recovery once the cause is proven.
      clearWatchdog();
      watchdogRef.current = setTimeout(() => {
        watchdogRef.current = null;
        if (sessionIdRef.current !== thisSession || !isRecordingRef.current) return;
        const advanced = wiredCtx.currentTime - wiredTime;
        if (advanced < 0.5 || levelCountRef.current === 0) {
          recLog.warn(`pipeline stalled after ${PIPELINE_WATCHDOG_MS}ms: advanced=${advanced.toFixed(3)}s`
            + ` levels=${levelCountRef.current} chunks=${chunksRef.current.length}`,
            describeCtx(wiredCtx), describeTrack(mediaStreamRef.current?.getAudioTracks()[0]));
        }
      }, PIPELINE_WATCHDOG_MS);

      isSettingUpRef.current = false;

      if (pendingStopRef.current) {
        pendingStopRef.current = false;
        stopRecording();
      }
    } catch (err) {
      if (sessionIdRef.current !== thisSession) return;
      log.error('Failed to start recording (audio pipeline):', err);
      isSettingUpRef.current = false;
      pendingStopRef.current = false;
      isRecordingRef.current = false;
      setIsRecording(false);
      setRecordingStartTime(null);

      // Clean up mic stream if it was already obtained
      mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;

      const message = (err instanceof DOMException && err.name === 'AbortError')
        ? 'Audio engine failed to initialize. Restart the app and try again.'
        : classifyMicError(err);
      setError(message);
      setErrorType('');
      window.dictator.reportMicError(message);
    }
  }, [resolveDeviceId, callMode, getOrCreateAudioContext]);

  const stopRecording = useCallback(async () => {
    if (isSettingUpRef.current) {
      pendingStopRef.current = true;
      return;
    }

    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    isStoppingRef.current = true;
    clearWatchdog();
    setIsRecording(false);
    const elapsedMs = recordingStartTimeRef.current !== null ? Date.now() - recordingStartTimeRef.current : 0;
    if (recordingStartTimeRef.current !== null) {
      setLastDurationSeconds(elapsedMs / 1000);
      recordingStartTimeRef.current = null;
    }
    // Snapshot before the tracks are stopped below — afterwards readyState is always 'ended'
    const stoppedTrackInfo = describeTrack(mediaStreamRef.current?.getAudioTracks()[0]);
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

    let audioContext: AudioContext | null = null;
    let chunks: Float32Array[] = [];
    let totalLength = 0;
    let hasAudio = false;
    let recovered: { samples: Float32Array; compressed: ArrayBuffer } | null = null;
    try {
      // Signal worklet to flush remaining audio, then wait for 'done' before stopping mic.
      // Tracks must stay alive until worklet finishes so in-flight frames aren't dropped.
      if (workletNodeRef.current) {
        await new Promise<void>((resolve) => {
          const port = workletNodeRef.current?.port;
          if (!port) { resolve(); return; }
          const prevHandler = port.onmessage;
          let safetyTimer: ReturnType<typeof setTimeout> | null = null;
          const finish = () => {
            if (safetyTimer) clearTimeout(safetyTimer);
            port.onmessage = null;
            resolve();
          };
          port.onmessage = (ev) => {
            if (prevHandler) prevHandler.call(port, ev);
            if (ev.data?.type === 'done') finish();
          };
          port.postMessage('stop');
          safetyTimer = setTimeout(finish, 1000);
        });
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }

      audioContext = audioContextRef.current;
      audioContextRef.current = null;
      chunks = chunksRef.current;
      chunksRef.current = [];

      // Broadcast state change IMMEDIATELY after stopping tracks so the overlay
      // releases its own mic stream without waiting for the rest of cleanup.
      totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      hasAudio = totalLength > 0 && !!audioContext;

      // Worklet produced nothing (stalled context) — fall back to the MediaRecorder capture
      // before telling main the recording was empty.
      if (!hasAudio && compressedBlobPromise) {
        try {
          const compressed = await Promise.race([
            compressedBlobPromise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('MediaRecorder flush timeout')), 5000)),
          ]);
          const samples = await decodeCompressedAudio(compressed);
          if (samples) {
            recLog.warn(`worklet produced no samples, using MediaRecorder capture: elapsed=${elapsedMs}ms`
              + ` decoded=${(samples.length / WHISPER_SAMPLE_RATE).toFixed(1)}s`, describeCtx(audioContext), stoppedTrackInfo);
            recovered = { samples, compressed };
            hasAudio = true;
          }
        } catch (e) {
          log.warn('MediaRecorder fallback unavailable:', e);
        }
      }

      if (!hasAudio) {
        recLog.warn(`empty recording: elapsed=${elapsedMs}ms chunks=${chunks.length} levels=${levelCountRef.current}`,
          describeCtx(audioContext), stoppedTrackInfo);
      }
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
    } finally {
      isStoppingRef.current = false;
    }

    if (!hasAudio) return;

    let pcm: ArrayBuffer;
    let sampleRate: number;
    let compressedAudio: ArrayBuffer | undefined;
    if (recovered) {
      pcm = recovered.samples.buffer as ArrayBuffer;
      sampleRate = WHISPER_SAMPLE_RATE;
      compressedAudio = recovered.compressed;
    } else {
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      pcm = merged.buffer;
      sampleRate = audioContext?.sampleRate ?? WHISPER_SAMPLE_RATE;

      // Wait for compressed WebM/Opus blob (~8x smaller than WAV for API upload).
      // Timeout guard: proceed without compressed audio if onstop never fires.
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
    }

    window.dictator.transcribeBuffer(pcm, sampleRate, snapshotRecordingId, compressedAudio)
      .catch((err: unknown) => {
        log.error('transcribeBuffer failed:', err);
        // Reset recording state so UI doesn't stay stuck in transcribing/processing
        isRecordingRef.current = false;
        setIsRecording(false);
        setRecordingStartTime(null);
        setError(err instanceof Error ? err.message : 'Transcription failed — please try again');
      });
  }, []);

  const cancelRecording = useCallback(() => {
    if (!isRecordingRef.current && !isSettingUpRef.current) return;
    teardownRecording();
    setError('');
  }, []);

  useEffect(() => {
    const unsub = window.dictator.onHotkeyToggle(() => {
      if (isRecordingRef.current || isSettingUpRef.current) {
        stopRecording();
      } else {
        startRecording();
      }
    });
    // Tell main the hotkey listener now exists — a toggle pressed before this moment
    // (auto-start at logon) is queued in main and replayed on this signal.
    window.dictator.signalReady();
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
