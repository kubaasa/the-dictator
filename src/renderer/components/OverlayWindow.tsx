import { useState, useEffect } from 'react';
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
  const voiceLevel = useVoiceActivity();
  const { error } = useTranscriptionResult(state);
  const [activeWidget, setActiveWidget] = useState<WidgetType>('voicebar');
  const [shortcuts, setShortcuts] = useState<AppSettings['hotkey']['shortcuts']>(
    () => DEFAULT_SETTINGS.hotkey.shortcuts,
  );
  const [hotkeyMode, setHotkeyMode] = useState<HotkeyMode>('toggle');

  useEffect(() => {
    window.dictator.getSettings().then((settings) => {
      if (settings.widget) setActiveWidget(settings.widget.activeWidget);
      if (settings.hotkey) {
        setShortcuts(settings.hotkey.shortcuts);
        setHotkeyMode(settings.hotkey.mode);
      }
    });

    const unsub = window.dictator.onSettingsChange((settings) => {
      if (settings.widget) setActiveWidget(settings.widget.activeWidget);
      if (settings.hotkey) {
        setShortcuts(settings.hotkey.shortcuts);
        setHotkeyMode(settings.hotkey.mode);
      }
    });
    return unsub;
  }, []);

  if (activeWidget === 'maxi') {
    return (
      <MaxiWidget
        voiceLevel={voiceLevel}
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
      onToggleRecording={() => window.dictator.requestToggleRecording()}
    />
  );
}
