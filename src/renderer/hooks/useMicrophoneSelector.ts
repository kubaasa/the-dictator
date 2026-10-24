import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import log from 'electron-log/renderer';
import { AUTO_MIC_DEVICE_ID } from '../../shared/constants';
import { listMics, resolveActiveMic, type MicDevice } from '../utils/mic-devices';

export type { MicDevice };

const micLog = log.scope('MicSelector');

interface UseMicrophoneSelectorReturn {
  devices: MicDevice[];
  /** Saved preference: AUTO_MIC_DEVICE_ID or a device id, which may be unplugged right now. */
  selectedDeviceId: string | null;
  /** Label saved with a manual preference, so the dropdown can show it while unplugged. */
  selectedDeviceLabel: string | null;
  /** Label of the device the next recording will use. */
  activeLabel: string;
  /** True when the active device came from auto resolution (auto mode or unplugged preference). */
  isAutoPick: boolean;
  /** True when a manually chosen device is not present right now. */
  isUnavailable: boolean;
  isOpen: boolean;
  setSelectedDeviceId: (id: string) => void;
  /** Re-enumerates devices and returns the id for getUserMedia; called right before recording. */
  resolveDeviceId: () => Promise<string | null>;
  toggleDropdown: () => void;
  closeDropdown: () => void;
  refreshDevices: () => Promise<void>;
}

export function useMicrophoneSelector(): UseMicrophoneSelectorReturn {
  const [allDevices, setAllDevices] = useState<MediaDeviceInfo[]>([]);
  const [preference, setPreference] = useState<string | null>(null);
  const [preferenceLabel, setPreferenceLabel] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const mountedRef = useRef(true);

  const devices = useMemo(() => listMics(allDevices), [allDevices]);

  const activeDeviceId = useMemo(
    () => (preference === null ? null : resolveActiveMic(preference, allDevices)),
    [preference, allDevices],
  );

  const isAutoPick = preference !== null && activeDeviceId !== preference;
  const isUnavailable = isAutoPick && preference !== AUTO_MIC_DEVICE_ID;
  const activeLabel = devices.find((d) => d.deviceId === activeDeviceId)?.label ?? 'Microphone';

  const setSelectedDeviceId = useCallback((id: string) => {
    const label = id === AUTO_MIC_DEVICE_ID ? undefined : devices.find((d) => d.deviceId === id)?.label;
    setPreference(id);
    setPreferenceLabel(label ?? null);
    // settings:set merges per top-level key, so only the changed audio fields are sent.
    window.dictator.setSettings({ audio: { deviceId: id, deviceLabel: label } })
      .catch((err) => micLog.error('Failed to persist device selection:', err));
  }, [devices]);

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    if (mountedRef.current) setAllDevices(all);
  }, []);

  const resolveDeviceId = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    if (mountedRef.current) setAllDevices(all);
    return preference === null ? null : resolveActiveMic(preference, all);
  }, [preference]);

  useEffect(() => {
    mountedRef.current = true;

    window.dictator.getSettings().then((settings) => {
      if (!mountedRef.current) return;
      setPreference(settings.audio?.deviceId || AUTO_MIC_DEVICE_ID);
      setPreferenceLabel(settings.audio?.deviceLabel ?? null);
    }).then(() => {
      if (!mountedRef.current) return;
      return refreshDevices();
    }).then(async () => {
      if (!mountedRef.current) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      const hasLabels = all.some((d) => d.kind === 'audioinput' && d.label);
      if (!hasLabels && mountedRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        stream?.getTracks().forEach((t) => t.stop());
        if (mountedRef.current) refreshDevices();
      }
    }).catch((err) => micLog.error('Failed to initialize microphone selector:', err));

    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      mountedRef.current = false;
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, [refreshDevices]);

  // One line per real change, so main.log shows what the auto mode picked and why.
  const lastSnapshotRef = useRef('');
  useEffect(() => {
    if (preference === null || allDevices.length === 0) return;
    const defaultOutput = allDevices.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default');
    const snapshot = `pref=${preference} active=${activeDeviceId} out="${defaultOutput?.label ?? '?'}"`
      + ` mics=[${devices.map((d) => `"${d.label}"`).join(', ')}]`;
    if (snapshot === lastSnapshotRef.current) return;
    lastSnapshotRef.current = snapshot;
    micLog.info(`${isAutoPick ? 'auto' : 'manual'} -> "${activeLabel}" | ${snapshot}`);
  }, [preference, activeDeviceId, allDevices, devices, isAutoPick, activeLabel]);

  const toggleDropdown = useCallback(() => setIsOpen((prev) => !prev), []);
  const closeDropdown = useCallback(() => setIsOpen(false), []);

  return {
    devices,
    selectedDeviceId: preference,
    selectedDeviceLabel: preferenceLabel,
    activeLabel,
    isAutoPick,
    isUnavailable,
    isOpen,
    setSelectedDeviceId,
    resolveDeviceId,
    toggleDropdown,
    closeDropdown,
    refreshDevices,
  };
}
