import { deflateSync } from "node:zlib";

// Regenerates the base64 16×16 RGBA circle icons embedded in src/daemon/tray.ts.
// Run with `bun run scripts/gen-tray-icons.ts` and paste the output into the
// ICON_* constants. Kept in the repo so the magic base64 strings are reproducible.

const ICON_SIZE = 16;

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

function encodePng(rgba: Uint8Array, size: number): string {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header[8] = 8;
  header[9] = 6;
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }
  const parts = [signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  return Buffer.from(buffer).toString("base64");
}

function circle(size: number, red: number, green: number, blue: number): string {
  const rgba = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size / 2 - 1.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center);
      const index = (y * size + x) * 4;
      const alpha = distance <= radius ? 255 : distance <= radius + 1 ? Math.round(255 * (radius + 1 - distance)) : 0;
      rgba[index] = red;
      rgba[index + 1] = green;
      rgba[index + 2] = blue;
      rgba[index + 3] = alpha;
    }
  }
  return encodePng(rgba, size);
}

console.log("ICON_PROTECTED  =", circle(ICON_SIZE, 40, 200, 80));
console.log("ICON_FAIL_CLOSED=", circle(ICON_SIZE, 220, 50, 50));
console.log("ICON_UNKNOWN    =", circle(ICON_SIZE, 150, 150, 150));
