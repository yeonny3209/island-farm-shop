#!/usr/bin/env node
/* 앱 아이콘 만들기 (의존성 없음): 바다 위 섬, 야자수, 줄무늬 차양의 작은 가게.
 * 도형을 거리 함수(SDF)로 그려서 가장자리를 부드럽게 하고, PNG 는 zlib 로 직접 인코딩한다.
 *   node tools/make-icons.js                  → icons/ (웹 앱, 홈 화면용)
 *   node tools/make-icons.js --android <res>  → 안드로이드 런처 아이콘과 시작 화면 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SEA_TOP = [0x6c, 0xc6, 0xcf];
const SEA_BOTTOM = [0x2a, 0x8a, 0x9a];
const SEA_FLAT = '#3B9FAE';
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---------- 거리 함수 (단위: 아이콘 한 변 = 1) ----------
const len = (x, y) => Math.hypot(x, y);
function sdEllipse(px, py, a, b) {
  const k0 = len(px / a, py / b);
  const k1 = len(px / (a * a), py / (b * b));
  return k0 < 1e-9 ? -Math.min(a, b) : (k0 * (k0 - 1)) / k1;
}
function rot(px, py, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [px * c + py * s, -px * s + py * c];
}
function sdRoundBox(px, py, hx, hy, r) {
  const qx = Math.abs(px) - hx + r;
  const qy = Math.abs(py) - hy + r;
  return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdPolygon(px, py, pts) {
  let d = Infinity;
  let sign = 1;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    const ex = bx - ax;
    const ey = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, len(wx - ex * t, wy - ey * t));
    const c1 = py >= ay;
    const c2 = py < by;
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
  }
  return sign * d;
}

// ---------- 그림: [거리 함수, 색, 불투명도] 목록 (아래에서 위로) ----------
function artShapes() {
  const shapes = [];
  const add = (sd, color, alpha = 1) => shapes.push({ sd, color: hex(color), alpha });
  // 해
  add((x, y) => len(x - 0.75, y - 0.25) - 0.085, '#F7C548');
  // 섬 그림자, 모래, 풀
  add((x, y) => sdEllipse(x - 0.5, y - 0.725, 0.4, 0.135), '#D2B476');
  add((x, y) => sdEllipse(x - 0.5, y - 0.7, 0.4, 0.135), '#EFDCAB');
  add((x, y) => sdEllipse(x - 0.5, y - 0.675, 0.325, 0.09), '#8CC063');
  // 야자수 줄기와 잎
  add((x, y) => sdPolygon(x, y, [[0.255, 0.69], [0.305, 0.69], [0.3, 0.52], [0.285, 0.4], [0.265, 0.4], [0.27, 0.52]]), '#9C6B3F');
  const leaf = (dx, dy, a, b, deg, color) => add((x, y) => {
    const [rx, ry] = rot(x - (0.275 + dx), y - (0.385 + dy), deg);
    return sdEllipse(rx, ry, a, b);
  }, color);
  leaf(-0.075, 0.035, 0.1, 0.03, 30, '#3F8A31');
  leaf(0.08, 0.03, 0.1, 0.03, -28, '#3F8A31');
  leaf(-0.06, -0.015, 0.095, 0.028, -18, '#4F9F3C');
  leaf(0.065, -0.02, 0.095, 0.028, 16, '#4F9F3C');
  add((x, y) => len(x - 0.275, y - 0.395) - 0.022, '#7C5232');
  // 가게: 지붕, 벽, 문, 줄무늬 차양
  add((x, y) => sdPolygon(x, y, [[0.43, 0.445], [0.575, 0.345], [0.72, 0.445]]), '#C65C22');
  add((x, y) => sdRoundBox(x - 0.575, y - 0.565, 0.125, 0.1, 0.012), '#FBF8EF');
  add((x, y) => sdRoundBox(x - 0.575, y - 0.615, 0.03, 0.05, 0.01), '#B57B4C');
  const stripeW = 0.05;
  for (let k = 0; k < 5; k++) {
    const cx = 0.45 + stripeW / 2 + k * stripeW;
    const color = k % 2 ? '#FFE3A1' : '#EF7B3B';
    add((x, y) => sdRoundBox(x - cx, y - 0.465, stripeW / 2 + 0.001, 0.025, 0), color);
    add((x, y) => len(x - cx, y - 0.49) - stripeW / 2, color);
  }
  // 새싹 두 포기
  const sprout = (sx) => {
    add((x, y) => sdRoundBox(x - sx, y - 0.672, 0.004, 0.018, 0.003), '#3F8A31');
    add((x, y) => { const [rx, ry] = rot(x - (sx - 0.014), y - 0.656, 30); return sdEllipse(rx, ry, 0.016, 0.008); }, '#5BB450');
    add((x, y) => { const [rx, ry] = rot(x - (sx + 0.014), y - 0.656, -30); return sdEllipse(rx, ry, 0.016, 0.008); }, '#5BB450');
  };
  sprout(0.4);
  sprout(0.76);
  return shapes;
}

function waveShapes() {
  const ring = (cx, cy, a, b, t) => (x, y) => Math.abs(sdEllipse(x - cx, y - cy, a, b)) - t;
  return [
    { sd: ring(0.26, 0.9, 0.09, 0.022, 0.008), color: [255, 255, 255], alpha: 0.35 },
    { sd: ring(0.72, 0.915, 0.1, 0.024, 0.008), color: [255, 255, 255], alpha: 0.3 },
  ];
}

// ---------- 그리기 ----------
// opts.bg: 'rounded' | 'circle' | 'full' | null(투명), opts.scale: 그림 크기
function render(size, opts) {
  const art = artShapes();
  const waves = opts.bg ? waveShapes() : [];
  const k = opts.scale || 1;
  const out = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const v = (py + 0.5) / size;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const over = (color, cov) => {
        if (cov <= 0) return;
        r = color[0] * cov + r * (1 - cov);
        g = color[1] * cov + g * (1 - cov);
        b = color[2] * cov + b * (1 - cov);
        a = cov + a * (1 - cov);
      };
      if (opts.bg) {
        let d = -1;
        if (opts.bg === 'rounded') d = sdRoundBox(u - 0.5, v - 0.5, 0.5, 0.5, 0.2);
        else if (opts.bg === 'circle') d = len(u - 0.5, v - 0.5) - 0.5;
        const cov = Math.max(0, Math.min(1, 0.5 - d * size));
        const t = v;
        over([SEA_TOP[0] + (SEA_BOTTOM[0] - SEA_TOP[0]) * t, SEA_TOP[1] + (SEA_BOTTOM[1] - SEA_TOP[1]) * t, SEA_TOP[2] + (SEA_BOTTOM[2] - SEA_TOP[2]) * t], cov);
        for (const s of waves) over(s.color, Math.max(0, Math.min(1, 0.5 - s.sd(u, v) * size)) * s.alpha * cov);
      }
      // 그림은 가운데를 기준으로 k 배
      const x = (u - 0.5) / k + 0.5;
      const y = (v - 0.5) / k + 0.5;
      const clip = opts.bg && opts.bg !== 'full'
        ? Math.max(0, Math.min(1, 0.5 - (opts.bg === 'circle' ? len(u - 0.5, v - 0.5) - 0.5 : sdRoundBox(u - 0.5, v - 0.5, 0.5, 0.5, 0.2)) * size))
        : 1;
      for (const s of art) over(s.color, Math.max(0, Math.min(1, 0.5 - s.sd(x, y) * k * size)) * s.alpha * clip);
      const i = (py * size + px) * 4;
      // 앞에서 섞은 색은 불투명도가 곱해진 값이라 되돌린다
      out[i] = a ? Math.round(r / a) : 0;
      out[i + 1] = a ? Math.round(g / a) : 0;
      out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round(a * 255);
    }
  }
  return out;
}

// ---------- PNG ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len4 = Buffer.alloc(4);
  len4.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len4, body, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function write(file, size, opts) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(size, render(size, opts)));
  console.log(`  ${path.relative(process.cwd(), file)} (${size}px)`);
}

// ---------- 출력 ----------
const args = process.argv.slice(2);
const androidAt = args.indexOf('--android');
if (androidAt >= 0) {
  const res = path.resolve(args[androidAt + 1]);
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  console.log('안드로이드 아이콘:');
  for (const [name, m] of Object.entries(dens)) {
    write(path.join(res, `mipmap-${name}`, 'ic_launcher.png'), 48 * m, { bg: 'rounded', scale: 0.95 });
    write(path.join(res, `mipmap-${name}`, 'ic_launcher_round.png'), 48 * m, { bg: 'circle', scale: 0.85 });
    // 적응형 아이콘 앞면: 108dp 중 가운데 66dp 안에 들어가야 잘리지 않는다
    write(path.join(res, `mipmap-${name}`, 'ic_launcher_foreground.png'), 108 * m, { bg: null, scale: 0.62 });
  }
  fs.mkdirSync(path.join(res, 'values'), { recursive: true });
  fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${SEA_FLAT}</color>\n</resources>\n`);
  // 시작 화면: 기본 이미지를 지우고 바다색 바탕 가운데에 섬 그림
  for (const dir of fs.readdirSync(res)) {
    const f = path.join(res, dir, 'splash.png');
    if (dir.startsWith('drawable') && fs.existsSync(f)) fs.rmSync(f);
  }
  write(path.join(res, 'drawable', 'splash_art.png'), 360, { bg: null, scale: 1 });
  // 안드로이드 12 이상은 시스템 시작 화면을 쓰므로 바탕색만 바다색으로 맞춘다
  const styles = path.join(res, 'values', 'styles.xml');
  if (fs.existsSync(styles)) {
    const x = fs.readFileSync(styles, 'utf8');
    const anchor = '<item name="android:background">@drawable/splash</item>';
    if (x.includes(anchor) && !x.includes('windowSplashScreenBackground')) {
      fs.writeFileSync(styles, x.replace(anchor, `${anchor}\n        <item name="windowSplashScreenBackground">@color/ic_launcher_background</item>`));
    }
  }
  fs.writeFileSync(path.join(res, 'drawable', 'splash.xml'), [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<layer-list xmlns:android="http://schemas.android.com/apk/res/android">',
    `    <item><color android:color="${SEA_FLAT}"/></item>`,
    '    <item><bitmap android:gravity="center" android:src="@drawable/splash_art"/></item>',
    '</layer-list>',
    '',
  ].join('\n'));
} else {
  const dir = path.resolve(__dirname, '..', 'icons');
  console.log('웹 앱 아이콘:');
  write(path.join(dir, 'icon-192.png'), 192, { bg: 'rounded', scale: 0.95 });
  write(path.join(dir, 'icon-512.png'), 512, { bg: 'rounded', scale: 0.95 });
  write(path.join(dir, 'icon-maskable-512.png'), 512, { bg: 'full', scale: 0.78 });
  write(path.join(dir, 'apple-touch-icon.png'), 180, { bg: 'full', scale: 0.9 });
  write(path.join(dir, 'favicon-64.png'), 64, { bg: 'rounded', scale: 1 });
}
