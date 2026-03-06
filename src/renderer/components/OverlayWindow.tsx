import type { RecordingState } from '../../shared/types';
import { useVoiceActivity } from '../hooks/useVoiceActivity';
import { HitmanHead } from './overlay/HitmanHead';
import { hitmanConfig } from './overlay/characters/hitman';

interface OverlayWindowProps {
  state: RecordingState;
}

export function OverlayWindow({ state }: OverlayWindowProps) {
  const voiceLevel = useVoiceActivity();

  return (
    <HitmanHead
      state={state}
      voiceLevel={voiceLevel}
      character={hitmanConfig}
    />
  );
}
