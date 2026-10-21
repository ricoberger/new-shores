// Generates the procedural placeholder app icons in public/icons (PNG,
// no dependencies): a sail over an island on the sea. Run with
// `node scripts/gen-icons.mjs` after changing the drawing; the PNGs are
// committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SEA = [31, 69, 105, 255];
const DEEP = [20, 48, 76, 255];
const SAND = [226, 201, 142, 255];
const GRASS = [104, 160, 84, 255];
const SAIL = [250, 247, 240, 255];
const MAST = [92, 64, 40, 255];

/** The motif in unit coordinates (0..1), scaled by `k` around the centre for the maskable safe zone. */
function motif(u, v, k) {
  const x = (u - 0.5) / k + 0.5;
  const y = (v - 0.5) / k + 0.5;
  // Island: an ellipse with a sand rim.
  const ex = (x - 0.5) / 0.36;
  const ey = (y - 0.74) / 0.12;
  const e = ex * ex + ey * ey;
  if (e < 0.55) return GRASS;
  if (e < 1) return SAND;
  // Mast and sail.
  if (x > 0.485 && x < 0.515 && y > 0.2 && y < 0.68) return MAST;
  if (y > 0.22 && y < 0.6 && x > 0.53 && x < 0.53 + (y - 0.22) * 0.75) return SAIL;
  if (y > 0.3 && y < 0.6 && x < 0.47 && x > 0.47 - (y - 0.3) * 0.6) return SAIL;
  return null;
}

/** Rounded square with the sea; transparent corners (regular icons). */
function regular(size) {
  const r = size * 0.18;
  return png(size, (px, py) => {
    const dx = Math.max(r - px, px - (size - r), 0);
    const dy = Math.max(r - py, py - (size - r), 0);
    if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
    return motif(px / size, py / size, 1) ?? (py / size > 0.62 ? DEEP : SEA);
  });
}

/** Full-bleed background; the motif stays inside the 80 % safe zone. */
function maskable(size) {
  return png(size, (px, py) => motif(px / size, py / size, 0.75) ?? (py / size > 0.6 ? DEEP : SEA));
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon-192.png"), regular(192));
writeFileSync(join(OUT, "icon-512.png"), regular(512));
writeFileSync(join(OUT, "icon-maskable-512.png"), maskable(512));
writeFileSync(join(OUT, "apple-touch-icon.png"), maskable(180));
console.log(`icons written to ${OUT}`);
