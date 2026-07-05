import { useState, useEffect } from 'react';
import log from 'electron-log/renderer';
import type { RecordingState, WidgetType, HotkeyMode, AppSettings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { useVoiceActivity } from '../hooks/useVoiceActivity';
import { useTranscriptionResult } from '../hooks/useTranscriptionResult';
import { VoiceBar } from './overlay/VoiceBar';
import { MaxiWidget } from './overlay/MaxiWidget';

interface OverlayWindowProps {
  state: RecordingState;
}

export function OverlayWindow({ state }: OverlayWindowProps) {
  const { level: voiceLevel, bandsRef } = useVoiceActivity();
  const { error } = useTranscriptionResult(state);
  const [activeWidget, setActiveWidget] = useState<WidgetType>('voicebar');
  const [shortcuts, setShortcuts] = useState<AppSettings['hotkey']['shortcuts']>(
    () => DEFAULT_SETTINGS.hotkey.shortcuts,
  );
  const [hotkeyMode, setHotkeyMode] = useState<HotkeyMode>('toggle');
  useEffect(() => {
    let cancelled = false;
    const apply = (settings: AppSettings) => {
      if (settings.widget) setActiveWidget(settings.widget.activeWidget);
      if (settings.hotkey) {
        setShortcuts(settings.hotkey.shortcuts);
        setHotkeyMode(settings.hotkey.mode);
      }
    };

    // getSettings can reject during a cold boot (IPC/store still initializing) — retry,
    // otherwise a maxi user is stuck with the default voicebar until settings change
    const load = (attempt: number) => {
      window.dictator.getSettings()
        .then((settings) => { if (!cancelled) apply(settings); })
        .catch((err) => {
          log.error(`Failed to load settings in OverlayWindow (attempt ${attempt}):`, err);
          if (!cancelled && attempt < 3) setTimeout(() => load(attempt + 1), 1000 * attempt);
        });
    };
    load(1);

    const unsub = window.dictator.onSettingsChange(apply);
    return () => { cancelled = true; unsub(); };
  }, []);

  if (activeWidget === 'maxi') {
    return (
      <MaxiWidget
        voiceLevel={voiceLevel}
        bandsRef={bandsRef}
        state={state}
        shortcuts={shortcuts}
        hotkeyMode={hotkeyMode}
        errorMessage={error}
      />
    );
  }

  return (
    <VoiceBar
      voiceLevel={voiceLevel}
      state={state}
      errorMessage={error}
      onToggleRecording={() => window.dictator.requestToggleRecording()}
    />
  );
}
