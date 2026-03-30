/**
 * Generates BMP images for the WiX installer.
 * Run once: node scripts/generate-installer-images.js
 *
 * Creates:
 *   assets/installer-background.bmp  (493x312) — Welcome/Finish dialog background
 *   assets/installer-banner.bmp      (493x58)  — Top banner on other dialogs
 */

const fs = require('fs');
const path = require('path');

// Colors (RGB)
const COLORS = {
  white:      [255, 255, 255],
  nearWhite:  [250, 250, 252],
  lightGray:  [235, 238, 242],
  medGray:    [200, 206, 214],
  accent:     [52, 73, 94],    // dark blue-gray
  accentLight:[86, 117, 150],  // lighter accent
  textDark:   [44, 62, 80],    // near-black
};

function createBMP(width, height, pixelFn) {
  const rowStride = Math.ceil(width * 3 / 4) * 4;
  const pixelDataSize = rowStride * height;
  const fileSize = 54 + pixelDataSize;
  const buf = Buffer.alloc(fileSize);

  // -- BMP File Header (14 bytes) --
  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);

  // -- DIB Header (40 bytes) --
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);   // positive = bottom-up
  buf.writeUInt16LE(1, 26);       // planes
  buf.writeUInt16LE(24, 28);      // bpp
  buf.writeUInt32LE(0, 30);       // no compression
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeUInt32LE(2835, 38);    // ~72 DPI
  buf.writeUInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  // -- Pixel data (bottom-up, BGR) --
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row;   // flip: row 0 in BMP = bottom of image
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      const off = 54 + row * rowStride + x * 3;
      buf[off]     = b;
      buf[off + 1] = g;
      buf[off + 2] = r;
    }
  }

  return buf;
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// ── Background image (493 x 312) ──
// Left panel (0-163): vertical gradient from accent to accentLight
// Divider (164-165): thin medium gray line
// Right panel (166-492): clean near-white
function backgroundPixel(x, y) {
  const panelWidth = 164;

  if (x < panelWidth) {
    // Left panel: subtle vertical gradient
    const t = y / 311;
    return lerpColor(COLORS.accent, COLORS.accentLight, t);
  }

  if (x < panelWidth + 2) {
    // Thin divider line
    return COLORS.medGray;
  }

  // Right panel: clean near-white with very subtle gradient
  const t = y / 311;
  return lerpColor(COLORS.nearWhite, COLORS.white, t * 0.5);
}

// ── Banner image (493 x 58) ──
// White background with accent strip at the bottom (3px)
function bannerPixel(x, y) {
  if (y >= 55) {
    // Bottom 3px: accent color strip
    const t = (y - 55) / 2;
    return lerpColor(COLORS.accentLight, COLORS.accent, t);
  }

  // Clean white
  return COLORS.white;
}

// ── Generate ──
const assetsDir = path.resolve(__dirname, '..', 'assets');

const bgBuf = createBMP(493, 312, backgroundPixel);
fs.writeFileSync(path.join(assetsDir, 'installer-background.bmp'), bgBuf);
console.log('Created: assets/installer-background.bmp (493x312)');

const bannerBuf = createBMP(493, 58, bannerPixel);
fs.writeFileSync(path.join(assetsDir, 'installer-banner.bmp'), bannerBuf);
console.log('Created: assets/installer-banner.bmp (493x58)');

console.log('Done!');
