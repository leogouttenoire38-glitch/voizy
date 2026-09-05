// Génère les icônes PNG de l'app Voizy (aucune dépendance : zlib natif).
//   node scripts/gen-assets.mjs
// Dessine un « V » blanc sur fond indigo (#4F46E5).
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "mobile", "assets", "images");
mkdirSync(outDir, { recursive: true });

const BRAND = [0x4f, 0x46, 0xe5]; // #4F46E5
const WHITE = [255, 255, 255];

// distance point-segment (pixels)
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function drawV(size, opts = {}) {
  const { background = null, monochrome = false } = opts;
  const stride = size * 4;
  const raw = Buffer.alloc(size * stride);
  const half = size / 2;
  const thickness = size * 0.09;
  const topPad = size * 0.2;
  const armLen = size * 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r, g, b, a;
      // deux segments du V : (topLeft→bottomCenter) et (bottomCenter→topRight)
      const d1 = segDist(x, y, half - armLen, topPad, half, size - topPad);
      const d2 = segDist(x, y, half, size - topPad, half + armLen, topPad);
      const inside = Math.min(d1, d2) <= thickness;

      if (background) {
        r = background[0]; g = background[1]; b = background[2];
        a = 255;
        if (inside) {
          r = WHITE[0]; g = WHITE[1]; b = WHITE[2];
        }
      } else {
        // foreground transparent : le V seul
        if (inside) {
          r = monochrome ? WHITE[0] : WHITE[0];
          g = monochrome ? WHITE[1] : WHITE[1];
          b = monochrome ? WHITE[2] : WHITE[2];
          a = 255;
        } else {
          r = g = b = a = 0;
        }
      }
      const off = y * stride + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }
  return png(size, raw);
}

function png(size, raw) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const stride = size * 4;
  const scanlines = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    scanlines[y * (stride + 1)] = 0; // filtre none
    raw.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(scanlines, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

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

writeFileSync(join(outDir, "icon.png"), drawV(1024, { background: BRAND }));
writeFileSync(join(outDir, "android-icon-foreground.png"), drawV(1024));
writeFileSync(join(outDir, "android-icon-monochrome.png"), drawV(1024, { monochrome: true }));
writeFileSync(join(outDir, "splash-icon.png"), drawV(512));
writeFileSync(join(outDir, "favicon.png"), drawV(64, { background: BRAND }));

console.log("Icônes Voizy générées dans", outDir);