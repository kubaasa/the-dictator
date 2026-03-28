import { useState, useEffect, useCallback, useRef } from 'react';
import log from 'electron-log/renderer';

export interface MicDevice {
  deviceId: string;
  label: string;
}

interface UseMicrophoneSelectorReturn {
  devices: MicDevice[];
  selectedDeviceId: string | null;
  selectedLabel: string;
  isOpen: boolean;
  setSelectedDeviceId: (id: string) => void;
  toggleDropdown: () => void;
  closeDropdown: () => void;
  refreshDevices: () => Promise<void>;
}

export function useMicrophoneSelector(): UseMicrophoneSelectorReturn {
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const initializedRef = useRef(false);

  const setSelectedDeviceId = useCallback((id: string) => {
    setSelectedDeviceIdState(id);
    window.dictator.getSettings().then((current) => {
      window.dictator.setSettings({ ...current, audio: { ...current.audio, deviceId: id } });
    }).catch((err) => log.error('Failed to persist device selection:', err));
  }, []);

  const refreshDevices = useCallback(async () => {
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    const mics = allDevices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
      }));
    setDevices(mics);
    setSelectedDeviceIdState((prev) => {
      if (!prev || !mics.find((m) => m.deviceId === prev)) {
        return mics[0]?.deviceId ?? null;
      }
      return prev;
    });
  }, []);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;

    window.dictator.getSettings().then((settings) => {
      if (!mountedRef.current) return;
      const savedId = settings.audio?.deviceId;
      if (savedId) {
        initializedRef.current = true;
        setSelectedDeviceIdState(savedId);
      }
    }).then(() => {
      if (!mountedRef.current) return;
      return refreshDevices();
    }).then(async () => {
      if (!mountedRef.current) return;
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const hasLabels = allDevices.some((d) => d.kind === 'audioinput' && d.label);
      if (!hasLabels && mountedRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        stream?.getTracks().forEach((t) => t.stop());
        if (mountedRef.current) refreshDevices();
      }
    }).catch((err) => log.error('Failed to initialize microphone selector:', err));

    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      mountedRef.current = false;
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, [refreshDevices]);

  const selectedLabel =
    devices.find((d) => d.deviceId === selectedDeviceId)?.label ?? 'Microphone';

  const toggleDropdown = useCallback(() => setIsOpen((prev) => !prev), []);
  const closeDropdown = useCallback(() => setIsOpen(false), []);

  return {
    devices,
    selectedDeviceId,
    selectedLabel,
    isOpen,
    setSelectedDeviceId,
    toggleDropdown,
    closeDropdown,
    refreshDevices,
  };
}
