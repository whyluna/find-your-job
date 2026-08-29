// v4 图标：macOS 蓝色瓷片 + 折纸飞机 + 单一路径
// 语义：纸飞机代表“投递”，短轨迹代表投递之后仍被持续追踪。
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const S = 1024;
const LO = 48;
const HI = 976;
const RAD = 210;
const px = new Uint8Array(S * S * 4);

function insideTile(x, y) {
  const cx = Math.min(Math.max(x, LO + RAD), HI - RAD);
  const cy = Math.min(Math.max(y, LO + RAD), HI - RAD);
  const dx = x - cx;
  const dy = y - cy;
  return x >= LO && x <= HI && y >= LO && y <= HI && dx * dx + dy * dy <= RAD * RAD;
}

function inTri(p, a, b, c) {
  const s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

function coverage(test, x, y) {
  let n = 0;
  for (let sy = 0; sy < 2; sy++) {
    for (let sx = 0; sx < 2; sx++) {
      if (test(x + (sx + 0.5) / 2, y + (sy + 0.5) / 2)) n++;
    }
  }
  return n / 4;
}

function mixChannel(base, over, alpha) {
  return Math.round(base + (over - base) * alpha);
}

function blend(i, color, alpha) {
  px[i] = mixChannel(px[i], color[0], alpha);
  px[i + 1] = mixChannel(px[i + 1], color[1], alpha);
  px[i + 2] = mixChannel(px[i + 2], color[2], alpha);
}

// Tile: a restrained system-blue material with a soft top-left highlight.
const TOP = [84, 149, 248];
const BOTTOM = [17, 76, 177];
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const cov = coverage(insideTile, x, y);
    if (!cov) continue;
    const vertical = Math.max(0, Math.min(1, (y - LO) / (HI - LO)));
    const diagonal = Math.max(0, Math.min(1, (x + y - LO * 2) / ((HI - LO) * 2)));
    const t = vertical * 0.72 + diagonal * 0.28;
    const radial = Math.max(0, 1 - Math.hypot(x - 310, y - 235) / 650) * 0.12;
    px[i] = Math.round(TOP[0] + (BOTTOM[0] - TOP[0]) * t + (255 - TOP[0]) * radial);
    px[i + 1] = Math.round(TOP[1] + (BOTTOM[1] - TOP[1]) * t + (255 - TOP[1]) * radial);
    px[i + 2] = Math.round(TOP[2] + (BOTTOM[2] - TOP[2]) * t + (255 - TOP[2]) * radial);
    px[i + 3] = Math.round(cov * 255);
  }
}

// Plane geometry. The upper wing is nearly white; the lower fold uses an icy-blue face.
const NOSE = [790, 286];
const LEFT = [247, 432];
const FOLD = [477, 574];
const LOWER = [538, 748];
const TAIL = [350, 688];
const upperWing = (x, y) => inTri([x, y], LEFT, NOSE, FOLD);
const lowerWing = (x, y) => inTri([x, y], FOLD, NOSE, LOWER);
const tailFold = (x, y) => inTri([x, y], FOLD, LOWER, TAIL);
const plane = (x, y) => upperWing(x, y) || lowerWing(x, y) || tailFold(x, y);

// A single curved trail: enough to imply motion and tracking without visual noise.
const trailSegments = [];
let previous = [226, 777];
for (let step = 1; step <= 28; step++) {
  const t = step / 28;
  const mt = 1 - t;
  const point = [
    mt * mt * 226 + 2 * mt * t * 280 + t * t * 363,
    mt * mt * 777 + 2 * mt * t * 750 + t * t * 687,
  ];
  trailSegments.push([previous, point]);
  previous = point;
}
function distanceToSegment(x, y, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const wx = x - a[0], wy = y - a[1];
  const denom = vx * vx + vy * vy;
  const t = denom ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / denom)) : 0;
  return Math.hypot(x - (a[0] + vx * t), y - (a[1] + vy * t));
}
const inTrail = (x, y) =>
  Math.hypot(x - 226, y - 777) <= 13 ||
  trailSegments.some(([a, b]) => distanceToSegment(x, y, a, b) <= 7);

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (!px[i + 3]) continue;

    const trail = coverage(inTrail, x, y);
    if (trail) blend(i, [235, 246, 255], trail * 0.58);

    // A compact, slightly softened shadow anchors the plane without looking embossed.
    const shadowWide = coverage((sx, sy) => plane(sx - 5, sy - 24), x, y);
    const shadowTight = coverage((sx, sy) => plane(sx - 2, sy - 15), x, y);
    if (shadowWide) blend(i, [4, 33, 86], shadowWide * 0.055);
    if (shadowTight) blend(i, [4, 33, 86], shadowTight * 0.10);

    const upper = coverage(upperWing, x, y);
    const lower = coverage(lowerWing, x, y);
    const fold = coverage(tailFold, x, y);
    if (upper) blend(i, [255, 255, 255], upper);
    if (lower) blend(i, [218, 237, 255], lower * 0.98);
    if (fold) blend(i, [166, 211, 252], fold * 0.96);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
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
ihdr[8] = 8;
ihdr[9] = 6;
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(scriptDir, "app-icon.png");
writeFileSync(out, png);
console.log("v4 icon written:", out, png.length, "bytes");
