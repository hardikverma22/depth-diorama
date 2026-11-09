// Pure maths: no browser or three.js, so it can be unit tested directly in Node.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const fract = (v) => v - Math.floor(v);
export const wrap = (v, period) => ((v % period) + period) % period;

/** Seeded generator, so a scene builds identically on every run. */
export function seeded(seed = 7) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  return next;
}

/** Shape-preserving cubic through (xs, ys). Never overshoots, velocity is continuous, ends at rest. */
export function curve(xs, ys) {
  const n = xs.length;
  if (n < 2) throw new Error("curve needs at least 2 points");
  for (let i = 1; i < n; i++) if (!(xs[i] > xs[i - 1])) throw new Error(`curve times must increase (index ${i})`);
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] === 0 || d[i] === 0 || Math.sign(d[i - 1]) !== Math.sign(d[i])) continue;
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const t = (x - xs[lo]) / h[lo], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h[lo] * m[lo] + (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * h[lo] * m[lo + 1];
  };
}

const LINEAR_KEYS = ["x", "z", "y", "horizon", "pitch", "orbit", "swap"];
const LOG_KEYS = ["frame", "lens"];
const SHOT_DEFAULTS = { x: 0, z: 0, y: 2, horizon: 0, pitch: 0, orbit: 0, swap: 0 };

/**
 * beats: [{ t: seconds, shot: {...}, role?: "flat" | "reveal" }]. The timeline is periodic in `loop`.
 * The frame width and lens angle blend in log space, which is what makes a dolly zoom feel even.
 */
export function compileTimeline(beats, loop) {
  if (!Array.isArray(beats) || beats.length < 3) throw new Error("a timeline needs at least 3 beats");
  if (!(loop > 0)) throw new Error("loop length must be positive");
  if (Math.abs(beats[0].t) > 1e-9) throw new Error("the first beat must be at t = 0");
  if (Math.abs(beats[beats.length - 1].t - loop) > 1e-6) throw new Error("the last beat must land exactly on the loop end");
  const ts = beats.map((b) => b.t);
  const filled = beats.map((b, i) => {
    const shot = { ...SHOT_DEFAULTS, ...b.shot };
    if (!(shot.frame > 0) || !(shot.lens > 0 && shot.lens < 179)) throw new Error(`beat ${i} has an invalid frame or lens`);
    for (const k of [...LINEAR_KEYS, ...LOG_KEYS]) if (!Number.isFinite(shot[k])) throw new Error(`beat ${i}: ${k} is not a number`);
    return shot;
  });
  const first = filled[0], last = filled[filled.length - 1];
  for (const k of [...LINEAR_KEYS, ...LOG_KEYS]) {
    if (Math.abs(first[k] - last[k]) > 1e-6) throw new Error(`the loop does not close: first and last beat differ in ${k}`);
  }
  const curves = {};
  for (const k of LINEAR_KEYS) curves[k] = curve(ts, filled.map((s) => s[k]));
  for (const k of LOG_KEYS) { const c = curve(ts, filled.map((s) => Math.log(s[k]))); curves[k] = (t) => Math.exp(c(t)); }
  const at = (t) => {
    const tw = wrap(t, loop), out = {};
    for (const k in curves) out[k] = curves[k](tw);
    out.swap = clamp(out.swap, 0, 1);
    return out;
  };
  return { at, loop, beats: beats.map((b, i) => ({ ...b, shot: filled[i] })) };
}

/** Distance from the focus plane for a shot. Keeping frame fixed while the lens widens is the dolly zoom. */
export const shotDistance = (shot) => shot.frame / 2 / Math.tan((shot.lens * Math.PI) / 360);

/**
 * Finds the flat-view window: the largest ground-anchored window of this aspect ratio
 * that the scene's silhouette (seen straight along z) fills to at least `target`.
 * boxes: [{ xmin, xmax, ymin, ymax }]. Returns { frame, x, y, coverage, reached } or null for an empty scene.
 */
export function fitFlatFrame(boxes, aspect, { cells = 128, target = 0.74, minFraction = 0.2, ground = 0 } = {}) {
  const usable = boxes.filter((b) => b.xmax > b.xmin && b.ymax > b.ymin && b.ymax > ground);
  if (!usable.length || !(aspect > 0)) return null;
  const xmin = Math.min(...usable.map((b) => b.xmin)), xmax = Math.max(...usable.map((b) => b.xmax));
  const ymax = Math.max(...usable.map((b) => b.ymax));
  const sw = xmax - xmin, sh = ymax - ground, cell = Math.max(sw, sh) / cells;
  const nx = Math.ceil(sw / cell), ny = Math.ceil(sh / cell);
  const grid = new Uint8Array(nx * ny);
  for (const b of usable) {
    const i0 = clamp(Math.floor((b.xmin - xmin) / cell), 0, nx - 1), i1 = clamp(Math.ceil((b.xmax - xmin) / cell), 0, nx);
    const j0 = clamp(Math.floor((Math.max(b.ymin, ground) - ground) / cell), 0, ny - 1), j1 = clamp(Math.ceil((b.ymax - ground) / cell), 0, ny);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) grid[j * nx + i] = 1;
  }
  const sat = new Int32Array((nx + 1) * (ny + 1));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    sat[(j + 1) * (nx + 1) + i + 1] = grid[j * nx + i] + sat[j * (nx + 1) + i + 1] + sat[(j + 1) * (nx + 1) + i] - sat[j * (nx + 1) + i];
  }
  const sum = (i0, j0, i1, j1) => sat[j1 * (nx + 1) + i1] - sat[j0 * (nx + 1) + i1] - sat[j1 * (nx + 1) + i0] + sat[j0 * (nx + 1) + i0];
  const coverageAt = (w, h, xLeft) => {
    const i0 = clamp(Math.round((xLeft - xmin) / cell), 0, nx), i1 = clamp(Math.round((xLeft + w - xmin) / cell), 0, nx);
    const j1 = clamp(Math.round(h / cell), 0, ny);
    return i1 > i0 && j1 > 0 ? sum(i0, 0, i1, j1) / ((w * h) / (cell * cell)) : 0;
  };
  const maxW = sw, minW = maxW * minFraction, mid = (xmin + xmax) / 2;              // never wider than the scene, so the edges are always filled
  let best = null;
  for (let w = maxW; w >= minW; w *= 0.975) {
    const h = w / aspect;
    const span = Math.max(0, sw - w);
    let local = null;
    for (let k = 0; k <= 24; k++) {
      const offset = span * (k / 24) * (k % 2 ? 0.5 : -0.5);       // try the middle first, then alternate outwards
      const left = mid + offset - w / 2;
      const cov = coverageAt(w, h, left);
      if (!local || cov > local.coverage + 1e-4) local = { coverage: cov, left };
    }
    const result = { frame: w, x: local.left + w / 2, y: ground + h / 2, coverage: Math.min(1, local.coverage) };
    if (result.coverage >= target) return { ...result, reached: true };
    if (!best || result.coverage > best.coverage) best = result;
  }
  return { ...best, reached: false };
}

/** Places count objects across a width so they tile side by side when flat but spread in depth when opened. */
export function tileLayout(count, { across, depth, shape = "vee" }) {
  if (!(count >= 1)) throw new Error("tile needs at least one item");
  const [x0, x1] = across, [z0, z1] = depth, out = [];
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0.5 : i / (count - 1);
    let v;
    if (shape === "vee") v = Math.abs(u - 0.5) * 2;
    else if (shape === "peak") v = 1 - Math.abs(u - 0.5) * 2;
    else if (shape === "slope") v = u;
    else if (shape === "zigzag") v = i % 2;
    else throw new Error(`unknown tile shape "${shape}"`);
    out.push({ i, u, x: lerp(x0, x1, u), z: lerp(z0, z1, v) });
  }
  return out;
}
