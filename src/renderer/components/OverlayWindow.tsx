import { useState, useEffect } from 'react';
import type { RecordingState, WidgetType, DictationMode } from '../../shared/types';
import { useVoiceActivity } from '../hooks/useVoiceActivity';
import { VoiceBar } from './overlay/VoiceBar';
import { MaxiWidget } from './overlay/MaxiWidget';

interface OverlayWindowProps {
  state: RecordingState;
}

export function OverlayWindow({ state }: OverlayWindowProps) {
  const voiceLevel = useVoiceActivity();
  const [size, setSize] = useState(0.5);
  const [opacity, setOpacity] = useState(1.0);
  const [activeWidget, setActiveWidget] = useState<WidgetType>('voicebar');
  const [currentMode, setCurrentMode] = useState<DictationMode>('voice');

  useEffect(() => {
    window.dictator.getSettings().then((settings) => {
      if (settings.widget) {
        setSize(settings.widget.size);
        setOpacity(settings.widget.opacity);
        setActiveWidget(settings.widget.activeWidget);
      }
      if (settings.dictation) {
        setCurrentMode(settings.dictation.currentMode);
      }
    });

    const unsub = window.dictator.onSettingsChange((settings) => {
      if (settings.widget) {
        setSize(settings.widget.size);
        setOpacity(settings.widget.opacity);
        setActiveWidget(settings.widget.activeWidget);
      }
      if (settings.dictation) {
        setCurrentMode(settings.dictation.currentMode);
      }
    });
    return unsub;
  }, []);

  if (activeWidget === 'maxi') {
    return (
      <MaxiWidget
        voiceLevel={voiceLevel}
        state={state}
        opacity={opacity}
        size={size}
        currentMode={currentMode}
        onToggleRecording={() => window.dictator.requestToggleRecording()}
        onCancelRecording={() => window.dictator.requestCancelRecording()}
        onCycleMode={() => window.dictator.requestModeCycle()}
      />
    );
  }

  return (
    <VoiceBar
      voiceLevel={voiceLevel}
      state={state}
      opacity={opacity}
      size={size}
      onToggleRecording={() => window.dictator.requestToggleRecording()}
    />
  );
}
