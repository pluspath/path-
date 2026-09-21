/**
 * Seeded Path+ default-avatar generator.
 *
 * Same idea as DiceBear: a stable user id → always the same creative
 * geometric / landscape illustration. Colors and layouts match the Path+
 * stylized avatar look (navy, cream, salmon, soft blue, yellow, green).
 */

const SIZE = 256;

const PALETTE = {
  navy: [10, 31, 68] as const,
  lightBlue: [126, 184, 218] as const,
  sky: [186, 220, 235] as const,
  cream: [245, 240, 230] as const,
  salmon: [232, 160, 144] as const,
  peach: [245, 200, 180] as const,
  yellow: [245, 215, 110] as const,
  green: [168, 197, 160] as const,
  mutedGreen: [139, 168, 136] as const,
  white: [255, 255, 255] as const,
};

type RGB = readonly [number, number, number];

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — deterministic from seed. */
function makeRng(seed: string) {
  let state = hashSeed(seed) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setPixel(
  buf: Uint8ClampedArray,
  x: number,
  y: number,
  rgb: RGB,
  a = 255
) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  // Alpha blend over existing
  const inv = 1 - a / 255;
  buf[i] = Math.round(rgb[0] * (a / 255) + buf[i] * inv);
  buf[i + 1] = Math.round(rgb[1] * (a / 255) + buf[i + 1] * inv);
  buf[i + 2] = Math.round(rgb[2] * (a / 255) + buf[i + 2] * inv);
  buf[i + 3] = 255;
}

function fillCircle(
  buf: Uint8ClampedArray,
  cx: number,
  cy: number,
  r: number,
  rgb: RGB
) {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(SIZE - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(SIZE - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) setPixel(buf, x, y, rgb);
    }
  }
}

function fillRect(
  buf: Uint8ClampedArray,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: RGB,
  insideCircle: (x: number, y: number) => boolean
) {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(SIZE - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(SIZE - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      if (insideCircle(x, y)) setPixel(buf, x, y, rgb);
    }
  }
}

function fillTriangle(
  buf: Uint8ClampedArray,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  rgb: RGB,
  insideCircle: (x: number, y: number) => boolean
) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(ay, by, cy)));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!insideCircle(x, y)) continue;
      const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / area;
      const w1 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) / area;
      const w2 = ((ax - cx) * (y - cy) - (ay - cy) * (x - cx)) / area;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) setPixel(buf, x, y, rgb);
    }
  }
}

function fillDiamond(
  buf: Uint8ClampedArray,
  cx: number,
  cy: number,
  r: number,
  rgb: RGB,
  insideCircle: (x: number, y: number) => boolean
) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (!insideCircle(x, y)) continue;
      if (Math.abs(x - cx) + Math.abs(y - cy) <= r) setPixel(buf, x, y, rgb);
    }
  }
}

/** Simple leaf / plant silhouette. */
function fillLeaf(
  buf: Uint8ClampedArray,
  ox: number,
  oy: number,
  scale: number,
  rgb: RGB,
  insideCircle: (x: number, y: number) => boolean
) {
  // Stem
  fillRect(buf, ox - 3 * scale, oy, ox + 3 * scale, oy + 70 * scale, rgb, insideCircle);
  // Three leaves as elongated circles
  const leaves: Array<[number, number, number]> = [
    [ox - 28 * scale, oy + 10 * scale, 22 * scale],
    [ox + 28 * scale, oy + 18 * scale, 20 * scale],
    [ox, oy - 20 * scale, 26 * scale],
  ];
  for (const [lx, ly, lr] of leaves) {
    const r2 = lr * lr;
    for (let y = Math.floor(ly - lr); y <= Math.ceil(ly + lr); y++) {
      for (let x = Math.floor(lx - lr * 0.55); x <= Math.ceil(lx + lr * 0.55); x++) {
        if (!insideCircle(x, y)) continue;
        const dx = (x - lx) / 0.55;
        const dy = y - ly;
        if (dx * dx + dy * dy <= r2) setPixel(buf, x, y, rgb);
      }
    }
  }
}

function waveY(x: number, amp: number, period: number, base: number, phase: number): number {
  return base + Math.sin((x / period) * Math.PI * 2 + phase) * amp;
}

type TemplateId =
  | "sunHorizon"
  | "geoSplit"
  | "plantSalmon"
  | "mountainSun"
  | "waves"
  | "stripesSun"
  | "overlapCircles"
  | "diamondFrame"
  | "plantGreen"
  | "twinOrbs"
  | "crescent"
  | "arcs";

const TEMPLATES: TemplateId[] = [
  "sunHorizon",
  "geoSplit",
  "plantSalmon",
  "mountainSun",
  "waves",
  "stripesSun",
  "overlapCircles",
  "diamondFrame",
  "plantGreen",
  "twinOrbs",
  "crescent",
  "arcs",
];

function pickTemplate(rng: () => number): TemplateId {
  return TEMPLATES[Math.floor(rng() * TEMPLATES.length)];
}

function renderTemplate(
  buf: Uint8ClampedArray,
  template: TemplateId,
  rng: () => number,
  inside: (x: number, y: number) => boolean
) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  switch (template) {
    case "sunHorizon": {
      const sky = rng() > 0.5 ? PALETTE.navy : PALETTE.lightBlue;
      const sea = sky === PALETTE.navy ? PALETTE.lightBlue : PALETTE.sky;
      fillRect(buf, 0, 0, SIZE, SIZE, sky, inside);
      const horizon = 140 + rng() * 40;
      const amp = 10 + rng() * 10;
      const period = 70 + rng() * 40;
      const phase = rng() * Math.PI * 2;
      const sunX = 150 + rng() * 50;
      const sunY = 60 + rng() * 40;
      const sunR = 20 + rng() * 12;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          if (!inside(x, y)) continue;
          const wy = waveY(x, amp, period, horizon, phase);
          if (y > wy) setPixel(buf, x, y, sea);
        }
      }
      fillCircle(buf, sunX, sunY, sunR, PALETTE.yellow);
      break;
    }
    case "geoSplit": {
      fillRect(buf, 0, 0, SIZE, SIZE, PALETTE.cream, inside);
      fillRect(buf, 0, 0, SIZE / 2, SIZE / 2, PALETTE.green, inside);
      fillRect(buf, SIZE / 2, SIZE / 2, SIZE, SIZE, PALETTE.navy, inside);
      if (rng() > 0.4) fillRect(buf, SIZE / 2, 0, SIZE, SIZE / 2, PALETTE.peach, inside);
      break;
    }
    case "plantSalmon": {
      fillRect(buf, 0, 0, SIZE, SIZE, PALETTE.salmon, inside);
      fillLeaf(buf, cx, cy - 10, 0.9 + rng() * 0.2, PALETTE.navy, inside);
      break;
    }
    case "mountainSun": {
      fillRect(buf, 0, 0, SIZE, SIZE, PALETTE.sky, inside);
      fillCircle(buf, 175 + rng() * 30, 70 + rng() * 20, 20 + rng() * 8, PALETTE.yellow);
      fillTriangle(buf, 20, 230, 130, 80, 210, 230, PALETTE.navy, inside);
      fillTriangle(buf, 120, 230, 200, 110, 280, 230, PALETTE.lightBlue, inside);
      break;
    }
    case "waves": {
      const bands: RGB[] = [PALETTE.cream, PALETTE.salmon, PALETTE.green, PALETTE.peach];
      fillRect(buf, 0, 0, SIZE, SIZE, bands[0], inside);
      for (let b = 1; b < 4; b++) {
        const base = 40 + b * 50 + rng() * 10;
        const amp = 8 + rng() * 8;
        const period = 60 + b * 15 + rng() * 20;
        const phase = rng() * Math.PI * 2;
        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) {
            if (!inside(x, y)) continue;
            if (y > waveY(x, amp, period, base, phase)) setPixel(buf, x, y, bands[b % bands.length]);
          }
        }
      }
      break;
    }
    case "stripesSun": {
      fillRect(buf, 0, 0, SIZE, SIZE, PALETTE.sky, inside);
      const stripeW = 28 + rng() * 10;
      for (let i = 0; i < 5; i++) {
        const x0 = 20 + i * stripeW;
        fillRect(buf, x0, 0, x0 + stripeW * 0.55, SIZE, PALETTE.navy, inside);
      }
      fillCircle(buf, 170 + rng() * 30, cy, 45 + rng() * 15, PALETTE.yellow);
      break;
    }
    case "overlapCircles": {
      fillRect(buf, 0, 0, SIZE, SIZE, PALETTE.cream, inside);
      fillCircle(buf, 90, 110, 70, PALETTE.navy);
      fillCircle(buf, 160, 150, 65, PALETTE.salmon);
      if (rng() > 0.5) fillCircle(buf, 140, 90, 40, PALETTE.yellow);
      break;
    }
    case "diamondFrame": {
      fillRect(buf, 0, 0, SIZE, SIZE, PALETTE.navy, inside);
      fillRect(buf, 55, 55, 201, 201, PALETTE.lightBlue, inside);
      fillDiamond(buf, cx, cy, 55 + rng() * 15, PALETTE.yellow, inside);
      break;
    }
    case "plantGreen": {
      fillRect(buf, 0, 0, SIZE, SIZE, PALETTE.mutedGreen, inside);
      fillLeaf(buf, cx, cy - 5, 0.95, PALETTE.navy, inside);
      break;
    }
    case "twinOrbs": {
      fillRect(buf, 0, 0, SIZE, SIZE, PALETTE.cream, inside);
      fillCircle(buf, 100, 130, 70, PALETTE.navy);
      fillCircle(buf, 165, 130, 55, PALETTE.yellow);
      break;
    }
    case "crescent": {
      fillRect(buf, 0, 0, SIZE, SIZE, PALETTE.navy, inside);
      fillCircle(buf, cx, cy, 70, PALETTE.yellow);
      fillCircle(buf, cx + 25, cy - 10, 55, PALETTE.navy);
      break;
    }
    case "arcs": {
      fillRect(buf, 0, 0, SIZE, SIZE, PALETTE.peach, inside);
      fillCircle(buf, cx, SIZE + 20, 160, PALETTE.navy);
      fillCircle(buf, cx, SIZE + 20, 110, PALETTE.salmon);
      fillCircle(buf, cx, SIZE + 20, 60, PALETTE.cream);
      break;
    }
  }
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const len = data.length;
  const out = new Uint8Array(8 + len + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, len);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcBuf = new Uint8Array(4 + len);
  crcBuf.set(typeBytes, 0);
  crcBuf.set(data, 4);
  view.setUint32(8 + len, crc32(crcBuf));
  return out;
}

/** Encode RGBA buffer as PNG (uses Bun.deflateSync). */
function encodePng(rgba: Uint8ClampedArray): Uint8Array {
  const stride = SIZE * 4;
  const raw = new Uint8Array((SIZE + 1) * stride / 4 * 4 + SIZE); // filter byte per row
  // Actually: each row = 1 filter byte + SIZE*4 samples
  const rowSize = 1 + SIZE * 4;
  const filtered = new Uint8Array(rowSize * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const dest = y * rowSize;
    filtered[dest] = 0; // none filter
    filtered.set(rgba.subarray(y * stride, y * stride + stride), dest + 1);
  }

  const compressed =
    typeof Bun !== "undefined" && typeof Bun.deflateSync === "function"
      ? Bun.deflateSync(filtered)
      : filtered; // extremely unlikely fallback (invalid png) — Bun is required

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, SIZE);
  ihdrView.setUint32(4, SIZE);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed instanceof Uint8Array ? compressed : new Uint8Array(compressed)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const memoryCache = new Map<string, Uint8Array>();
const CACHE_MAX = 500;

/**
 * Generate a 256×256 PNG for the given seed. Result is cached in-memory.
 */
export function generateDefaultAvatarPng(seed: string): Uint8Array {
  const key = String(seed || "user");
  const hit = memoryCache.get(key);
  if (hit) return hit;

  const rng = makeRng(key);
  const template = pickTemplate(rng);

  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  // Transparent / white outside; we fill circle interior
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 255;
    rgba[i + 1] = 255;
    rgba[i + 2] = 255;
    rgba[i + 3] = 0;
  }

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = SIZE / 2 - 1;
  const r2 = r * r;
  const inside = (x: number, y: number) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    return dx * dx + dy * dy <= r2;
  };

  // Soft cream backdrop inside the circle first
  fillCircle(rgba, cx, cy, r, PALETTE.cream);
  renderTemplate(rgba, template, rng, inside);

  // Ensure outside circle is transparent for clean circular crop in UI
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inside(x, y)) {
        const i = (y * SIZE + x) * 4;
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0;
      } else {
        rgba[(y * SIZE + x) * 4 + 3] = 255;
      }
    }
  }

  const png = encodePng(rgba);
  if (memoryCache.size >= CACHE_MAX) {
    const first = memoryCache.keys().next().value;
    if (first) memoryCache.delete(first);
  }
  memoryCache.set(key, png);
  return png;
}
