import { useState, useEffect, useCallback, useRef } from 'react';

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
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const refreshDevices = useCallback(async () => {
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    const mics = allDevices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
      }));
    setDevices(mics);
    setSelectedDeviceId((prev) => {
      if (!prev || !mics.find((m) => m.deviceId === prev)) {
        return mics[0]?.deviceId ?? null;
      }
      return prev;
    });
  }, []);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;

    // In Electron, mic permission is already granted — enumerateDevices returns labels
    // without opening a stream, so no audible mic on/off at startup
    refreshDevices().then(async () => {
      if (!mountedRef.current) return;
      // If labels are still empty (no prior permission), request lazily
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const hasLabels = allDevices.some((d) => d.kind === 'audioinput' && d.label);
      if (!hasLabels && mountedRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        stream?.getTracks().forEach((t) => t.stop());
        if (mountedRef.current) refreshDevices();
      }
    });

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
