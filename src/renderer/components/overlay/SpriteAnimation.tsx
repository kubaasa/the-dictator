interface SpriteAnimationProps {
  spriteSheet: string;
  frameWidth: number;
  frameHeight: number;
  frameIndex: number;
}

export function SpriteAnimation({ spriteSheet, frameWidth, frameHeight, frameIndex }: SpriteAnimationProps) {
  return (
    <div
      style={{
        width: frameWidth,
        height: frameHeight,
        backgroundImage: `url(${spriteSheet})`,
        backgroundPosition: `-${frameIndex * frameWidth}px 0px`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'auto 100%',
        imageRendering: 'pixelated',
      }}
    />
  );
}
