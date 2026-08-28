// 生成 1024x1024 应用图标（macOS squircle + indigo→cyan 渐变 + 白色公文包图形）
// 无第三方依赖：手写 PNG 编码（zlib + CRC32），4x4 超采样抗锯齿。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const S = 1024;
const R = Math.round(S * 0.225); // squircle 圆角半径
const px = new Uint8Array(S * S * 4);

const TOP = [79, 70, 229]; // indigo-600
const BOT = [6, 182, 212]; // cyan-500

function insideSquircle(x, y) {
  const cx = Math.min(Math.max(x, R), S - 1 - R);
  const cy = Math.min(Math.max(y, R), S - 1 - R);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= R * R;
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// 白色公文包：主体 + 提手（边框式）
function onBriefcase(x, y) {
  const body = inRoundRect(x, y, 268, 452, 756, 758, 44);
  if (body) {
    // 提手挖空区以外的主体 + 中缝
    return true;
  }
  // 提手：两条竖边 + 顶边（线宽 34）
  const lw = 34;
  const hx0 = 438, hx1 = 586, hy0 = 366, hy1 = 452;
  if (x >= hx0 && x <= hx1 && y >= hy0 && y <= hy1) {
    const left = x <= hx0 + lw;
    const right = x >= hx1 - lw;
    const top = y <= hy0 + lw;
    return left || right || top;
  }
  return false;
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    // 4x4 超采样
    let cov = 0;
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const fx = x + (sx + 0.5) / 4;
        const fy = y + (sy + 0.5) / 4;
        if (insideSquircle(fx, fy)) cov++;
      }
    }
    if (cov === 0) continue;
    const t = (x + y) / (2 * S);
    let r = TOP[0] + (BOT[0] - TOP[0]) * t;
    let g = TOP[1] + (BOT[1] - TOP[1]) * t;
    let b = TOP[2] + (BOT[2] - TOP[2]) * t;
    let white = 0;
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const fx = x + (sx + 0.5) / 4;
        const fy = y + (sy + 0.5) / 4;
        if (insideSquircle(fx, fy) && onBriefcase(fx, fy)) white++;
      }
    }
    if (white > 0) {
      const w = white / 16;
      r = r + (255 - r) * w;
      g = g + (255 - g) * w;
      b = b + (255 - b) * w;
    }
    px[i] = Math.round(r);
    px[i + 1] = Math.round(g);
    px[i + 2] = Math.round(b);
    px[i + 3] = Math.round((cov / 16) * 255);
  }
}

// ---- PNG 编码 ----
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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.dirname(new URL(import.meta.url).pathname);
const outPath = path.join(outDir, "app-icon.png");
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, png);
console.log("icon written:", outPath, png.length, "bytes");
