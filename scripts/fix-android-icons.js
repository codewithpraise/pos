const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeSolidPng(width, height, r, g, b) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeInt32BE(width, 0);
  ihdrData.writeInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2; // RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  
  const ihdrHeader = Buffer.alloc(8);
  ihdrHeader.writeInt32BE(13, 0);
  ihdrHeader.write('IHDR', 4);
  const ihdrCrc = Buffer.alloc(4);
  ihdrCrc.writeUInt32BE(crc32(Buffer.concat([Buffer.from('IHDR'), ihdrData])), 0);
  const ihdr = Buffer.concat([ihdrHeader, ihdrData, ihdrCrc]);

  const rowSize = 1 + width * 3;
  const pixelData = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    pixelData[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const idx = rowStart + 1 + x * 3;
      pixelData[idx] = r;
      pixelData[idx + 1] = g;
      pixelData[idx + 2] = b;
    }
  }
  
  const compressed = zlib.deflateSync(pixelData);
  const idatHeader = Buffer.alloc(8);
  idatHeader.writeInt32BE(compressed.length, 0);
  idatHeader.write('IDAT', 4);
  const idatCrc = Buffer.alloc(4);
  idatCrc.writeUInt32BE(crc32(Buffer.concat([Buffer.from('IDAT'), compressed])), 0);
  const idat = Buffer.concat([idatHeader, compressed, idatCrc]);

  const iendHeader = Buffer.alloc(8);
  iendHeader.writeInt32BE(0, 0);
  iendHeader.write('IEND', 4);
  const iendCrc = Buffer.alloc(4);
  iendCrc.writeUInt32BE(crc32(Buffer.from('IEND')), 0);
  const iend = Buffer.concat([iendHeader, iendCrc]);

  return Buffer.concat([sig, ihdr, idat, iend]);
}

const sizes = {
  'mdpi': 48,
  'hdpi': 72,
  'xhdpi': 96,
  'xxhdpi': 144,
  'xxxhdpi': 192
};

const resDir = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

Object.entries(sizes).forEach(([dpi, size]) => {
  const pngBuf = makeSolidPng(size, size, 0, 214, 143); // Emerald green: #00d68f
  const targetPath = path.join(resDir, `mipmap-${dpi}`, 'ic_launcher.png');
  fs.writeFileSync(targetPath, pngBuf);
  console.log(`Wrote valid PNG ${size}x${size} to ${targetPath}`);
});
console.log('Successfully generated clean valid PNG launcher icons for Android!');
