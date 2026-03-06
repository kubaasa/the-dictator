import type { CharacterConfig } from '../types';
import spriteSheet from '../../../assets/sprites/hitman-head.png';

export const hitmanConfig: CharacterConfig = {
  id: 'hitman',
  name: 'The Hitman',
  spriteSheet,
  frameWidth: 128,
  frameHeight: 128,
  frames: {
    idle: 0,
    speaking: [1, 2],
    transcribing: 3,
    error: 4,
  },
};
