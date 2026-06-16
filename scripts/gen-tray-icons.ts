import { deflateSync } from "node:zlib";

// Regenerates the base64 shield icons embedded in src/daemon/tray.ts.
// Run with `bun run scripts/gen-tray-icons.ts` and paste the output into the
// ICON_* constants. Kept in the repo so the magic base64 strings are reproducible.
//
// All three are NON-template colored shields (green/red/gray). Template images
// were tried for an adaptive-white look, but the systray Go helper only applies
// the template flag at init — it can't toggle it per icon update, so the red
// fail-closed shield rendered as white. Color is the reliable signal, and red
// alarm matters more than adaptive white for a killswitch indicator.

const ICON_SIZE = 36;
const SUPERSAMPLE = 4;

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

// Shield silhouette: flat top with rounded corners, straight sides to the
// shoulder, then a convex (curved) taper to a centered point — a real badge
// shape, not the straight-edged blot the linear taper produced.
const SHIELD_TOP = 0.085;
const SHIELD_BOTTOM = 0.95;
const SHIELD_SHOULDER = 0.46;
const SHIELD_HALF_WIDTH = 0.39;
const SHIELD_CORNER = 0.07;
const OUTLINE_STROKE = 0.075;

function shieldHalfWidth(normalizedY: number, inset: number): number {
  const top = SHIELD_TOP + inset;
  const bottom = SHIELD_BOTTOM - inset;
  const halfWidthMax = SHIELD_HALF_WIDTH - inset;
  if (normalizedY < top || normalizedY > bottom) return -1;
  if (normalizedY <= SHIELD_SHOULDER) return halfWidthMax;
  const taper = (normalizedY - SHIELD_SHOULDER) / (bottom - SHIELD_SHOULDER);
  return halfWidthMax * Math.sqrt(Math.max(0, 1 - taper * taper));
}

function insideShield(normalizedX: number, normalizedY: number, inset: number): boolean {
  const halfWidth = shieldHalfWidth(normalizedY, inset);
  if (halfWidth < 0) return false;
  const dx = Math.abs(normalizedX - 0.5);
  if (dx > halfWidth) return false;

  // Round the two top-outer corners with a quarter circle.
  const top = SHIELD_TOP + inset;
  const cornerX = SHIELD_HALF_WIDTH - inset - SHIELD_CORNER;
  const cornerY = top + SHIELD_CORNER;
  if (normalizedY < cornerY && dx > cornerX) {
    return Math.hypot(dx - cornerX, normalizedY - cornerY) <= SHIELD_CORNER;
  }
  return true;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

type Glyph = "check" | "alert" | "none";
const GLYPH_STROKE = 0.05;

function insideGlyph(normalizedX: number, normalizedY: number, glyph: Glyph): boolean {
  if (glyph === "check") {
    return (
      distanceToSegment(normalizedX, normalizedY, 0.33, 0.52, 0.44, 0.63) <= GLYPH_STROKE ||
      distanceToSegment(normalizedX, normalizedY, 0.44, 0.63, 0.69, 0.37) <= GLYPH_STROKE
    );
  }
  if (glyph === "alert") {
    return (
      distanceToSegment(normalizedX, normalizedY, 0.5, 0.33, 0.5, 0.55) <= GLYPH_STROKE ||
      Math.hypot(normalizedX - 0.5, normalizedY - 0.66) <= GLYPH_STROKE * 1.05
    );
  }
  return false;
}

function shield(size: number, red: number, green: number, blue: number, mode: "filled" | "outline", glyph: Glyph): string {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let subY = 0; subY < SUPERSAMPLE; subY++) {
        for (let subX = 0; subX < SUPERSAMPLE; subX++) {
          const normalizedX = (x + (subX + 0.5) / SUPERSAMPLE) / size;
          const normalizedY = (y + (subY + 0.5) / SUPERSAMPLE) / size;
          const inBody =
            mode === "outline"
              ? insideShield(normalizedX, normalizedY, 0) && !insideShield(normalizedX, normalizedY, OUTLINE_STROKE)
              : insideShield(normalizedX, normalizedY, 0);
          if (inBody && !insideGlyph(normalizedX, normalizedY, glyph)) hits++;
        }
      }
      const index = (y * size + x) * 4;
      rgba[index] = red;
      rgba[index + 1] = green;
      rgba[index + 2] = blue;
      rgba[index + 3] = Math.round((255 * hits) / (SUPERSAMPLE * SUPERSAMPLE));
    }
  }
  return encodePng(rgba, size);
}

console.log("ICON_PROTECTED  =", shield(ICON_SIZE, 40, 175, 95, "filled", "check"));
console.log("ICON_FAIL_CLOSED=", shield(ICON_SIZE, 225, 55, 55, "filled", "alert"));
console.log("ICON_UNKNOWN    =", shield(ICON_SIZE, 150, 150, 150, "outline", "none"));
