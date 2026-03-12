import { useState, useEffect } from 'react';
import type { RecordingState } from '../../shared/types';
import { useVoiceActivity } from '../hooks/useVoiceActivity';
import { VoiceBar } from './overlay/VoiceBar';

interface OverlayWindowProps {
  state: RecordingState;
}

interface WidgetSettings {
  size: number;
  opacity: number;
}

export function OverlayWindow({ state }: OverlayWindowProps) {
  const voiceLevel = useVoiceActivity();
  const [widgetSettings, setWidgetSettings] = useState<WidgetSettings>({
    size: 'medium',
    opacity: 1.0,
  });

  useEffect(() => {
    window.dictator.getSettings().then((settings) => {
      if (settings.widget) {
        setWidgetSettings(settings.widget);
      }
    });

    const unsub = window.dictator.onSettingsChange((settings) => {
      if (settings.widget) {
        setWidgetSettings(settings.widget);
      }
    });
    return unsub;
  }, []);

  const { size, opacity } = widgetSettings;

  return <VoiceBar voiceLevel={voiceLevel} state={state} opacity={opacity} size={size} />;
}
