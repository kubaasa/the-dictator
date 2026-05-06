/**
 * Generates placeholder BMP images for the NSIS installer.
 * Run once: node scripts/generate-installer-images.js
 *
 * Creates:
 *   assets/nsis-header.bmp  (150x57)  — MUI header (License/Directory/Options pages)
 *   assets/nsis-sidebar.bmp (164x314) — MUI sidebar (Welcome/Finish pages)
 *
 * Uses pure Node.js BMP encoder — no external image libraries needed.
 */

const fs = require('fs');
const path = require('path');

function createBMP(width, height, pixelFn) {
  const rowStride = Math.ceil(width * 3 / 4) * 4;
  const pixelDataSize = rowStride * height;
  const fileSize = 54 + pixelDataSize;
  const buf = Buffer.alloc(fileSize);

  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);

  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeUInt32LE(2835, 38);
  buf.writeUInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);

  for (let row = 0; row < height; row++) {
    const y = height - 1 - row;
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

const WHITE = [255, 255, 255];

function headerPixel() {
  return WHITE;
}

function sidebarPixel() {
  return WHITE;
}

const assetsDir = path.resolve(__dirname, '..', 'assets');

const headerBuf = createBMP(150, 57, headerPixel);
fs.writeFileSync(path.join(assetsDir, 'nsis-header.bmp'), headerBuf);
console.log('Created: assets/nsis-header.bmp (150x57)');

const sidebarBuf = createBMP(164, 314, sidebarPixel);
fs.writeFileSync(path.join(assetsDir, 'nsis-sidebar.bmp'), sidebarBuf);
console.log('Created: assets/nsis-sidebar.bmp (164x314)');

console.log('Done! Replace with final artwork if desired.');
