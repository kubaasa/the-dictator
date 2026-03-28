import { useEffect, useRef } from 'react';
import type { MicDevice } from '../hooks/useMicrophoneSelector';

interface MicrophoneSelectorProps {
  devices: MicDevice[];
  selectedDeviceId: string | null;
  selectedLabel: string;
  isOpen: boolean;
  setSelectedDeviceId: (id: string) => void;
  toggleDropdown: () => void;
  closeDropdown: () => void;
}

export function MicrophoneSelector({
  devices,
  selectedDeviceId,
  selectedLabel,
  isOpen,
  setSelectedDeviceId,
  toggleDropdown,
  closeDropdown,
}: MicrophoneSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, closeDropdown]);

  const truncate = (label: string, max = 28) =>
    label.length > max ? label.slice(0, max - 1) + '…' : label;

  return (
    <div ref={containerRef} className="relative no-drag">
      <button
        onClick={toggleDropdown}
        aria-label={`Select microphone: ${selectedLabel}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
        title={selectedLabel}
      >
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
        </svg>
        <span className="max-w-[260px] truncate">{truncate(selectedLabel, 40)}</span>
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div role="listbox" aria-label="Available microphones" className="absolute right-0 top-full z-50 mt-1 w-max min-w-[280px] max-w-[440px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-lg">
          {devices.length === 0 ? (
            <p className="px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-neutral-600">No microphones found</p>
          ) : (
            devices.map((device) => (
              <button
                key={device.deviceId}
                role="option"
                aria-selected={device.deviceId === selectedDeviceId}
                onClick={() => {
                  setSelectedDeviceId(device.deviceId);
                  closeDropdown();
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-neutral-800 ${
                  device.deviceId === selectedDeviceId ? 'text-red-400 font-medium' : 'text-neutral-400'
                }`}
              >
                {device.deviceId === selectedDeviceId ? (
                  <svg className="h-3 w-3 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : (
                  <span className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{device.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
