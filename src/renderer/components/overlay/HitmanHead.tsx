import React from 'react';
import type { RecordingState } from '../../../shared/types';
import type { CharacterConfig } from './types';
import { SpriteAnimation } from './SpriteAnimation';

interface HitmanHeadProps {
  state: RecordingState;
  voiceLevel: number;
  character: CharacterConfig;
}

function getFrameIndex(character: CharacterConfig, state: RecordingState, voiceLevel: number): number {
  const { frames } = character;

  if (state === 'error') return frames.error;
  if (state === 'transcribing' || state === 'processing') return frames.transcribing;

  if (state === 'recording') {
    if (voiceLevel > 0.1) {
      // Low voice → speaking[0], loud voice → speaking[1]
      return voiceLevel > 0.5 ? frames.speaking[1] : frames.speaking[0];
    }
    return frames.idle;
  }

  return frames.idle;
}

export function HitmanHead({ state, voiceLevel, character }: HitmanHeadProps) {
  const frameIndex = getFrameIndex(character, state, voiceLevel);

  return (
    <div
      className="flex h-screen items-center justify-center"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <SpriteAnimation
        spriteSheet={character.spriteSheet}
        frameWidth={character.frameWidth}
        frameHeight={character.frameHeight}
        frameIndex={frameIndex}
      />
    </div>
  );
}
