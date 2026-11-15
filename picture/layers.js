// Turns one picture plus its depth map into a stack of layers.
// Each layer holds everything at its depth or farther, with nearer things painted out,
// so when the camera moves there is real picture behind every object.

/** Fills the pixels where valid is 0 from their surroundings (push-pull). Returns a new array. */
export function fill(src, C, valid, W, H) {
  const levels = [];
  let w = W, h = H, val = new Float32Array(src), wt = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) wt[i] = valid[i] ? 1 : 0;
  levels.push({ w, h, val, wt });
  while (w > 1 || h > 1) {
    const nw = Math.max(1, (w + 1) >> 1), nh = Math.max(1, (h + 1) >> 1), nv = new Float32Array(nw * nh * C), nt = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let sw = 0; const o = (y * nw + x) * C;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = x * 2 + dx, sy = y * 2 + dy; if (sx >= w || sy >= h) continue;
        const i = sy * w + sx, k = wt[i]; if (!k) continue;
        sw += k; for (let c = 0; c < C; c++) nv[o + c] += val[i * C + c] * k;
      }
      if (sw > 0) { for (let c = 0; c < C; c++) nv[o + c] /= sw; nt[y * nw + x] = Math.min(1, sw); }
    }
    levels.push({ w: nw, h: nh, val: nv, wt: nt }); w = nw; h = nh; val = nv; wt = nt;
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l], c = levels[l + 1];
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x, k = f.wt[i]; if (k >= 1) continue;
      const cx = Math.max(0, Math.min(c.w - 1, (x + 0.5) / 2 - 0.5)), cy = Math.max(0, Math.min(c.h - 1, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.min(c.w - 1, x0 + 1), y1 = Math.min(c.h - 1, y0 + 1), fx = cx - x0, fy = cy - y0;
      for (let ch = 0; ch < C; ch++) {
        const a = c.val[(y0 * c.w + x0) * C + ch], b = c.val[(y0 * c.w + x1) * C + ch], d = c.val[(y1 * c.w + x0) * C + ch], e = c.val[(y1 * c.w + x1) * C + ch];
        const up = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
        f.val[i * C + ch] = f.val[i * C + ch] * k + up * (1 - k);
      }
      f.wt[i] = 1;
    }
  }
  return levels[0].val;
}

/** Separable running min or max over a square window. */
function extreme(src, W, H, r, max, Type = Float32Array) {
  const pick = max ? Math.max : Math.min, tmp = new Type(W * H), out = new Type(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = src[y * W + x]; for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < W) v = pick(v, src[y * W + xx]); } tmp[y * W + x] = v; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = tmp[y * W + x]; for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < H) v = pick(v, tmp[yy * W + x]); } out[y * W + x] = v; }
  return out;
}
export const minmax = (src, W, H, r, max) => extreme(src, W, H, r, max);
export const dilate = (m, W, H, r) => extreme(m, W, H, r, true, Uint8Array);
export const erode = (m, W, H, r) => extreme(m, W, H, r, false, Uint8Array);

function blur3(a, W, H) {
  const t = new Float32Array(W * H), o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) t[y * W + x] = (a[y * W + Math.max(0, x - 1)] + 2 * a[y * W + x] + a[y * W + Math.min(W - 1, x + 1)]) / 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o[y * W + x] = (t[Math.max(0, y - 1) * W + x] + 2 * t[y * W + x] + t[Math.min(H - 1, y + 1) * W + x]) / 4;
  return o;
}

function boxBlur(src, C, W, H, r) {
  const tmp = new Float32Array(W * H * C), out = new Float32Array(W * H * C);
  const pass = (a, b, n, m, stride, line) => {
    for (let l = 0; l < m; l++) for (let c = 0; c < C; c++) {
      let sum = 0, cnt = 0; const at = (k) => (l * line + k * stride) * C + c;
      for (let k = 0; k <= Math.min(r, n - 1); k++) { sum += a[at(k)]; cnt++; }
      for (let k = 0; k < n; k++) { b[at(k)] = sum / cnt; const add = k + r + 1, del = k - r; if (add < n) { sum += a[at(add)]; cnt++; } if (del >= 0) { sum -= a[at(del)]; cnt--; } }
    }
  };
  pass(src, tmp, W, H, 1, W); pass(tmp, out, H, W, W, 1);
  return out;
}

/** Gives a smooth fill the grain of the picture beside it, by mirroring fine detail across the edge of each hole. */
export function regrain(filled, valid, W, H) {
  const N = W * H, nx = new Int32Array(N).fill(-1), ny = new Int32Array(N), dist = new Float32Array(N).fill(1e12);
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (valid[i]) { nx[i] = x; ny[i] = y; dist[i] = 0; }
  const relax = (i, x, y, j) => { if (nx[j] < 0) return; const dx = nx[j] - x, dy = ny[j] - y, dd = dx * dx + dy * dy; if (dd < dist[i]) { dist[i] = dd; nx[i] = nx[j]; ny[i] = ny[j]; } };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!dist[i]) continue; if (x) relax(i, x, y, i - 1); if (y) { relax(i, x, y, i - W); if (x) relax(i, x, y, i - W - 1); if (x < W - 1) relax(i, x, y, i - W + 1); } }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (!dist[i]) continue; if (x < W - 1) relax(i, x, y, i + 1); if (y < H - 1) { relax(i, x, y, i + W); if (x < W - 1) relax(i, x, y, i + W + 1); if (x) relax(i, x, y, i + W - 1); } }
  const low = boxBlur(filled, 3, W, H, Math.max(2, Math.round(Math.max(W, H) / 260))), reach = Math.max(W, H) * 0.05, out = new Float32Array(filled);
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
    if (!dist[i] || nx[i] < 0) continue;
    let m = -1;
    for (const s of [1, 0.5, 0.25]) { const mx = Math.round(nx[i] + (nx[i] - x) * s), my = Math.round(ny[i] + (ny[i] - y) * s); if (mx >= 0 && mx < W && my >= 0 && my < H && valid[my * W + mx]) { m = my * W + mx; break; } }
    if (m < 0) continue;
    const w = Math.exp(-Math.sqrt(dist[i]) / reach);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = filled[i * 3 + c] + w * (filled[m * 3 + c] - low[m * 3 + c]);
  }
  return out;
}

/** Resamples a depth map to W x H and stretches it to 0 (far) .. 1 (near), ignoring outliers. */
export function normaliseDepth(raw, dw, dh, W, H) {
  const d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.max(0, Math.min(dw - 1, (x + 0.5) * dw / W - 0.5)), sy = Math.max(0, Math.min(dh - 1, (y + 0.5) * dh / H - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(dw - 1, x0 + 1), y1 = Math.min(dh - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
    d[y * W + x] = (raw[y0 * dw + x0] * (1 - fx) + raw[y0 * dw + x1] * fx) * (1 - fy) + (raw[y1 * dw + x0] * (1 - fx) + raw[y1 * dw + x1] * fx) * fy;
  }
  const sample = []; for (let i = 0; i < d.length; i += 97) sample.push(d[i]); sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.005)], hi = sample[Math.floor(sample.length * 0.995)], span = hi - lo;
  if (!(span > 1e-6)) { d.fill(0.5); return { d, flat: true }; }
  for (let i = 0; i < d.length; i++) d[i] = Math.max(0, Math.min(1, (d[i] - lo) / span));
  return { d, flat: false };
}

/** Finds the depths where the picture has real gaps (an object in front of something far behind it). */
export function findCuts(d, lo, hi, W, H, { maxCuts = 4, edge = 0.07 } = {}) {
  const BINS = 96, votes = new Float32Array(BINS), spans = [];
  const step = Math.max(1, Math.round(Math.sqrt((W * H) / 400000)));
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    const i = y * W + x, range = hi[i] - lo[i]; if (range < edge) continue;
    const a = Math.floor((lo[i] + range * 0.3) * BINS), b = Math.min(BINS - 1, Math.floor((hi[i] - range * 0.3) * BINS)); if (b < a) continue;
    spans.push(a, b); for (let k = a; k <= b; k++) votes[k]++;
  }
  const total = spans.length / 2, cuts = []; if (total < (W * H) / (step * step) * 0.0015) return cuts;
  const alive = new Uint8Array(total).fill(1);
  while (cuts.length < maxCuts) {
    let best = 0; for (let k = 1; k < BINS; k++) if (votes[k] > votes[best]) best = k;
    if (votes[best] < total * 0.12) break;
    // settle on the middle of the plateau rather than its first bin
    let l = best, r = best; while (l > 0 && votes[l - 1] >= votes[best] * 0.97) l--; while (r < BINS - 1 && votes[r + 1] >= votes[best] * 0.97) r++;
    const pickBin = Math.round((l + r) / 2); cuts.push((pickBin + 0.5) / BINS);
    for (let s = 0; s < total; s++) if (alive[s] && spans[s * 2] <= pickBin && spans[s * 2 + 1] >= pickBin) { alive[s] = 0; for (let k = spans[s * 2]; k <= spans[s * 2 + 1]; k++) votes[k]--; }
  }
  return cuts.sort((a, b) => a - b);
}

/**
 * Builds the layer stack. rgb is Float32 (0..255) W*H*3, d is 0..1 with 1 nearest.
 * Returns [{ rgba: Uint8ClampedArray, depth: Float32Array, cut }], farthest first.
 */
export function buildLayers(rgb, d, W, H, opts = {}) {
  const r = Math.max(2, Math.round(Math.max(W, H) / 500));
  const lo = extreme(d, W, H, r, false), hi = extreme(d, W, H, r, true);
  const edgeLimit = opts.edge ?? 0.07, E = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) E[i] = hi[i] - lo[i] > edgeLimit ? 1 : 0;
  const cuts = opts.cuts ?? findCuts(d, lo, hi, W, H, { maxCuts: opts.maxCuts ?? 4, edge: edgeLimit });
  const bounds = [-1, ...cuts], layers = [];
  for (let k = 0; k < bounds.length; k++) {
    const cut = bounds[k], next = bounds[k + 1];
    const mine = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) mine[i] = d[i] >= cut ? 1 : 0;
    let removed = null;
    if (next !== undefined) {
      const near = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) near[i] = d[i] >= next ? 1 : 0;
      const wide = dilate(near, W, H, 2 * r + 2); removed = dilate(near, W, H, r); for (let i = 0; i < W * H; i++) if (wide[i] && E[i]) removed[i] = 1;
    }
    let colour = rgb;
    if (removed) { const ok = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) ok[i] = removed[i] ? 0 : 1; colour = regrain(fill(rgb, 3, ok, W, H), ok, W, H); }
    const sure = new Uint8Array(W * H); let any = 0;
    for (let i = 0; i < W * H; i++) { sure[i] = mine[i] && !(removed && removed[i]) && !E[i] ? 1 : 0; any += sure[i]; }
    if (any < W * H * 0.002) { any = 0; for (let i = 0; i < W * H; i++) { sure[i] = mine[i] && !(removed && removed[i]) ? 1 : 0; any += sure[i]; } }
    const depth = any ? fill(d, 1, sure, W, H) : new Float32Array(d);
    const rgba = new Uint8ClampedArray(W * H * 4);
    let alpha = null;
    if (k > 0) { const thin = erode(mine, W, H, 1), a = new Float32Array(W * H); for (let i = 0; i < W * H; i++) a[i] = (E[i] ? thin[i] : mine[i]) ? 1 : 0; alpha = blur3(a, W, H); }
    for (let i = 0; i < W * H; i++) { rgba[i * 4] = colour[i * 3]; rgba[i * 4 + 1] = colour[i * 3 + 1]; rgba[i * 4 + 2] = colour[i * 3 + 2]; rgba[i * 4 + 3] = alpha ? alpha[i] * 255 : 255; }
    layers.push({ rgba, depth, cut: Math.max(0, cut) });
  }
  return { layers, cuts };
}

/** The depth the camera should keep still: the typical depth of the nearer half of the middle of the picture. */
export function subjectDepth(d, W, H) {
  const v = [];
  for (let y = Math.floor(H * 0.25); y < H * 0.75; y += 3) for (let x = Math.floor(W * 0.25); x < W * 0.75; x += 3) v.push(d[y * W + x]);
  v.sort((a, b) => a - b); return v[Math.floor(v.length * 0.7)] ?? 0.5;
}
