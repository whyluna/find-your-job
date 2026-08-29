// v3 图标：蓝紫渐变底 + 折纸纸飞机（投递）+ 尾迹点（流程追踪）
// 语义：纸飞机 = 投出简历；尾迹 = 追踪流程。朝右上 45° = 进展向上。
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";

const S = 1024;
const RAD = 230; // squircle 圆角（≈22.5%，Apple macOS 图标网格）
const px = new Uint8Array(S * S * 4);

const inside = (x, y) => {
  const cx = Math.min(Math.max(x, RAD), S - 1 - RAD);
  const cy = Math.min(Math.max(y, RAD), S - 1 - RAD);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= RAD * RAD;
};

// ---- 第 1 层：对角渐变底（左上亮 indigo-400 → 右下深 indigo-800，跨度可感知）----
const C0 = [129, 140, 248]; // indigo-400
const C1 = [55, 48, 163];   // indigo-800
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    let cov = 0, sx = 0, sy = 0;
    for (let k = 0; k < 4; k++) {
      const fx = x + (k % 2 + 0.5) / 2, fy = y + (Math.floor(k / 2) + 0.5) / 2;
      if (inside(fx, fy)) { cov++; sx += fx; sy += fy; }
    }
    if (!cov) continue;
    const fx = sx / cov, fy = sy / cov;
    const t = (fx + fy) / (2 * S);
    px[i]     = Math.round(C0[0] + (C1[0] - C0[0]) * t);
    px[i + 1] = Math.round(C0[1] + (C1[1] - C0[1]) * t);
    px[i + 2] = Math.round(C0[2] + (C1[2] - C0[2]) * t);
    px[i + 3] = Math.round((cov / 4) * 255);
  }
}

// ---- 几何定义 ----
// 纸飞机（朝右上 45°），折纸两片：上翼亮面 / 下翼暗面，共边为机身折痕
const N  = [754, 328];  // 机头
const T  = [379, 703];  // 机尾
const W1 = [276, 473];  // 上翼展开点
const W2 = [548, 745];  // 下翼展开点
// 尾迹：机尾后方三个渐小渐淡的圆点，微弯（沿中轴向左下延伸）
const TRAIL = [
  { c: [296, 798], r: 14, a: 0.75 },
  { c: [248, 845], r: 10, a: 0.50 },
  { c: [208, 888], r: 7,  a: 0.30 },
];

function inTri(p, a, b, c) {
  const s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}
const OFF = 26; // 投影向下偏移
const inShadow = (x, y) => inTri([x, y - OFF], N, T, W1) || inTri([x, y - OFF], N, T, W2);
const inPlane = (x, y) => inTri([x, y], N, T, W1) || inTri([x, y], N, T, W2);

// ---- 第 2~4 层：顶部高光 / 投影 / 白色飞机 / 尾迹（4x4 超采样）----
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (px[i + 3] === 0) continue;
    let hl = 0, sh = 0, pl = 0;
    for (let k = 0; k < 4; k++) {
      const fx = x + (k % 2 + 0.5) / 2, fy = y + (Math.floor(k / 2) + 0.5) / 2;
      if (fy < 320) hl++;                       // 顶部高光区
      if (inShadow(fx, fy)) sh++;
      if (inPlane(fx, fy)) pl++;
    }
    // 顶部高光：白 0.14 → 0 线性衰减（0~320px）
    const hA = (hl / 4) * 0.14 * Math.max(0, 1 - y / 320);
    // 投影：黑 0.22
    const sA = (sh / 4) * 0.22;
    // 机身：上翼纯白，下翼白 0.62 —— 先按共边分上下采样太细，简化：整机 0.85，
    // 再对下半翼三角单独提亮/压暗
    let r = px[i], g = px[i + 1], b = px[i + 2];
    // 先叠高光
    r += (255 - r) * hA; g += (255 - g) * hA; b += (255 - b) * hA;
    // 再叠投影
    r *= 1 - sA; g *= 1 - sA; b *= 1 - sA;
    // 飞机本体：区分上下翼
    if (pl > 0) {
      let upper = 0, lower = 0;
      for (let k = 0; k < 4; k++) {
        const fx = x + (k % 2 + 0.5) / 2, fy = y + (Math.floor(k / 2) + 0.5) / 2;
        if (inTri([fx, fy], N, T, W1)) upper++;
        if (inTri([fx, fy], N, T, W2)) lower++;
      }
      const a = pl / 4;
      const wA = upper > lower ? a * 1.0 : a * 0.50; // 上翼亮 / 下翼暗（小尺寸下保持可辨分面）
      r += (255 - r) * wA; g += (255 - g) * wA; b += (255 - b) * wA;
    }
    px[i] = Math.round(Math.max(0, Math.min(255, r)));
    px[i + 1] = Math.round(Math.max(0, Math.min(255, g)));
    px[i + 2] = Math.round(Math.max(0, Math.min(255, b)));
    // 尾迹 alpha 按点单独混（每点半径不同透明度）
    for (const { c, r: pr, a: pa } of TRAIL) {
      const d2 = (x - c[0]) ** 2 + (y - c[1]) ** 2;
      if (d2 <= pr * pr) {
        px[i] = Math.round(px[i] + (255 - px[i]) * pa);
        px[i + 1] = Math.round(px[i + 1] + (255 - px[i + 1]) * pa);
        px[i + 2] = Math.round(px[i + 2] + (255 - px[i + 2]) * pa);
      }
    }
  }
}

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1); }
const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
const out = path.join(path.dirname(new URL(import.meta.url).pathname), "app-icon.png");
writeFileSync(out, png);
console.log("v3 icon written:", out, png.length, "bytes");
