import { useState, useEffect, useCallback } from 'react';

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

  useEffect(() => {
    // Request permission on mount so labels are populated immediately
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        return refreshDevices();
      })
      .catch(() => refreshDevices());

    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
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
