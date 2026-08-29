// v2 图标：深色渐变底 + 白色进度轨道与对勾（状态流转 = 产品核心）
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";

const S = 1024;
const R = Math.round(S * 0.225);
const px = new Uint8Array(S * S * 4);

// 深靛蓝渐变（左上深→右下稍亮，均一深色系，macOS 图标常用低饱和深底）
const C0 = [30, 27, 75];    // indigo-950
const C1 = [55, 48, 130];   // indigo-800 偏亮端
const inside = (x, y) => {
  const cx = Math.min(Math.max(x, R), S - 1 - R);
  const cy = Math.min(Math.max(y, R), S - 1 - R);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= R * R;
};
// 采样：圆角内平均（4x4 超采样 alpha）
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
    // 渐变：对角 135°
    const t = (fx + fy) / (2 * S);
    px[i]     = Math.round(C0[0] + (C1[0] - C0[0]) * t);
    px[i + 1] = Math.round(C0[1] + (C1[1] - C0[1]) * t);
    px[i + 2] = Math.round(C0[2] + (C1[2] - C0[2]) * t);
    px[i + 3] = Math.round((cov / 4) * 255);
  }
}

// ---- 矢量层：白色进度环（顶部窄缺口，圆头端点）+ 大对勾 ----
// 环：中心 (512,512) 半径 300，线宽 56，缺口 34°（±17°，窄口保证"环"的可读性）
const CX = 512, CY = 512, RR = 300, LW = 56;
const GAP = (17 * Math.PI) / 180; // 缺口半角
// 弧两端圆头（round cap）：θ = 90° ± 17°
const capA = [CX + RR * Math.cos(Math.PI / 2 - GAP), CY - RR * Math.sin(Math.PI / 2 - GAP)];
const capB = [CX + RR * Math.cos(Math.PI / 2 + GAP), CY - RR * Math.sin(Math.PI / 2 + GAP)];
const inCap = (x, y) =>
  Math.hypot(x - capA[0], y - capA[1]) <= LW / 2 ||
  Math.hypot(x - capB[0], y - capB[1]) <= LW / 2;
const inRing = (x, y) => {
  if (inCap(x, y)) return true;
  const dx = x - CX, dy = y - CY;
  const d2 = dx * dx + dy * dy;
  const lo = (RR - LW / 2) ** 2, hi = (RR + LW / 2) ** 2;
  if (d2 < lo || d2 > hi) return false;
  const ang = Math.atan2(-(dy), dx); // 数学角度，顶部为 +π/2
  const top = Math.PI / 2;
  let diff = Math.abs(ang - top);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff > GAP; // 顶部 ±17° 之外为弧
};
// 对勾：两段折线（粗 58，端点圆头），完全在环内，整体上移 25 视觉居中
// 点：短臂起点(400,505) → 轇(485,590) → 长臂终(655,395)
const A = [400, 505], B = [485, 590], C = [655, 395];
const CK_W = 58;
function distSeg(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const wx = p[0] - a[0], wy = p[1] - a[1];
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  const dx = wx - t * vx, dy = wy - t * vy;
  return Math.hypot(dx, dy);
}
const inCheck = (x, y) =>
  distSeg([x, y], A, B) <= CK_W / 2 || distSeg([x, y], B, C) <= CK_W / 2;

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (px[i + 3] === 0) continue;
    let hit = 0, tot = 0;
    for (let k = 0; k < 4; k++) {
      const fx = x + (k % 2 + 0.5) / 2, fy = y + (Math.floor(k / 2) + 0.5) / 2;
      tot++;
      if (inRing(fx, fy) || inCheck(fx, fy)) hit++;
    }
    if (!hit) continue;
    const a = hit / tot;
    // 白色覆盖
    px[i]     = Math.round(px[i] + (255 - px[i]) * a);
    px[i + 1] = Math.round(px[i + 1] + (255 - px[i + 1]) * a);
    px[i + 2] = Math.round(px[i + 2] + (255 - px[i + 2]) * a);
  }
}

// ---- PNG 编码（同 v1）----
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
console.log("v2 icon written:", out, png.length, "bytes");
