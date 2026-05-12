import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "icons");

const sizes = [16, 32, 48, 128];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function roundedMask(x, y, size) {
  const radius = size * 0.22;
  const inset = size * 0.06;
  const max = size - inset - 1;
  const cx = x < inset + radius ? inset + radius : x > max - radius ? max - radius : x;
  const cy = y < inset + radius ? inset + radius : y > max - radius ? max - radius : y;
  const distance = Math.hypot(x - cx, y - cy);
  return distance <= radius ? 255 : 0;
}

function pixel(x, y, size) {
  const alpha = roundedMask(x, y, size);
  const diagonal = x / size + y / size;
  const bolt = Math.abs(x - y * 0.62 - size * 0.2) < size * 0.08 && y > size * 0.18 && y < size * 0.82;
  const ring = Math.hypot(x - size * 0.5, y - size * 0.5) < size * 0.3
    && Math.hypot(x - size * 0.5, y - size * 0.5) > size * 0.22;

  if (bolt || ring) return [250, 250, 244, alpha];
  return [
    Math.round(20 + diagonal * 20),
    Math.round(90 + diagonal * 55),
    Math.round(115 + diagonal * 65),
    alpha
  ];
}

function png(size) {
  const scanlines = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x += 1) {
      const [red, green, blue, alpha] = pixel(x, y, size);
      const offset = 1 + x * 4;
      row[offset] = red;
      row[offset + 1] = green;
      row[offset + 2] = blue;
      row[offset + 3] = alpha;
    }
    scanlines.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(scanlines))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of sizes) {
  writeFileSync(join(outDir, `icon${size}.png`), png(size));
}
