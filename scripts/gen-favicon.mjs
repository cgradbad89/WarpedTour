// Generates the app favicon from a single guitar-geometry definition:
//   • src/app/icon.svg     — crisp vector, the PRIMARY favicon (Next 16 file
//                            convention auto-emits <link rel="icon" type="svg">).
//   • src/app/favicon.ico  — multi-size PNG-in-ICO fallback for older browsers
//                            (16/32/48 px), auto-emitted as <link sizes="any">.
//
// Self-contained: no ImageMagick / PIL / sharp. PNG encoding uses Node's zlib;
// the ICO container and CRCs are written by hand. Run from the repo root:
//   node scripts/gen-favicon.mjs   (add --preview for an ASCII silhouette check)
//
// The guitar is an upright figure-8 silhouette (two bouts + neck + headstock)
// in the festival pink (#db2777), which reads on both light and dark tab bars.
// Monochrome by design so it stays legible at 16px.

import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Single source of truth: guitar shapes in a 32x32 design box (y points down).
const VB = 32;
const FILL = "#db2777";
const SHAPES = [
  { type: "rect", x: 13.4, y: 1.5, w: 5.2, h: 4.2, rx: 1.3 }, // headstock (widest top)
  { type: "rect", x: 14.5, y: 4.4, w: 3.0, h: 13.8, rx: 0.8 }, // neck
  { type: "circle", cx: 16, cy: 17.6, r: 4.6 }, // upper bout
  { type: "circle", cx: 16, cy: 25.2, r: 6.9 }, // lower bout (largest)
];

function inside(s, x, y) {
  if (s.type === "circle") {
    const dx = x - s.cx;
    const dy = y - s.cy;
    return dx * dx + dy * dy <= s.r * s.r;
  }
  return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
}
const covered = (x, y) => SHAPES.some((s) => inside(s, x, y));

// --- Rasterize to RGBA at NxN with 4x4 supersampling (anti-aliased edges).
function raster(N) {
  const SS = 4;
  const r = parseInt(FILL.slice(1, 3), 16);
  const g = parseInt(FILL.slice(3, 5), 16);
  const b = parseInt(FILL.slice(5, 7), 16);
  const buf = Buffer.alloc(N * N * 4);
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = ((px + (sx + 0.5) / SS) / N) * VB;
          const dy = ((py + (sy + 0.5) / SS) / N) * VB;
          if (covered(dx, dy)) hit++;
        }
      }
      const o = (py * N + px) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = Math.round((255 * hit) / (SS * SS));
    }
  }
  return buf;
}

// --- Minimal PNG encoder (8-bit RGBA, no filtering).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(N, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = N * 4 + 1;
  const raw = Buffer.alloc(stride * N);
  for (let y = 0; y < N; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * N * 4, y * N * 4 + N * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Assemble a PNG-in-ICO from several sizes.
function encodeIco(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((e, i) => {
    const d = dir.subarray(i * 16, i * 16 + 16);
    d[0] = e.size >= 256 ? 0 : e.size; // width  (0 == 256)
    d[1] = e.size >= 256 ? 0 : e.size; // height
    d.writeUInt16LE(1, 4); // color planes
    d.writeUInt16LE(32, 6); // bits per pixel
    d.writeUInt32LE(e.png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.png.length;
  });
  return Buffer.concat([head, dir, ...entries.map((e) => e.png)]);
}

// --- SVG: same shapes as vector primitives, unioned by a shared solid fill.
function svg() {
  const body = SHAPES.map((s) =>
    s.type === "circle"
      ? `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>`
      : `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx}"/>`,
  ).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" ` +
    `role="img" aria-label="Guitar"><g fill="${FILL}">${body}</g></svg>\n`
  );
}

if (process.argv.includes("--preview")) {
  const N = 32;
  let out = "";
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) out += covered(x + 0.5, y + 0.5) ? "█" : "·";
    out += "\n";
  }
  process.stderr.write(out);
}

writeFileSync(join(ROOT, "src/app/icon.svg"), svg());
writeFileSync(
  join(ROOT, "src/app/favicon.ico"),
  encodeIco([16, 32, 48].map((size) => ({ size, png: encodePng(size, raster(size)) }))),
);
console.log("wrote src/app/icon.svg + src/app/favicon.ico");
