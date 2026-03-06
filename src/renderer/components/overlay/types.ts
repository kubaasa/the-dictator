export interface CharacterConfig {
  id: string;
  name: string;
  spriteSheet: string;
  frameWidth: number;
  frameHeight: number;
  frames: {
    idle: number;
    speaking: number[];
    transcribing: number;
    error: number;
  };
}
