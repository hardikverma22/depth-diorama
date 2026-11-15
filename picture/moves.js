// Camera moves. Every move starts and ends on the untouched picture and loops without a seam.
// A key is [phase 0..1, swing left/right in degrees, tilt up/down in degrees, distance (1 = start, smaller = closer), zoom].

export const MOVES = {
  reveal: { about: "Swings round one side, pushes in, crosses to the other side, settles back.", keys: [[0, 0, 0, 1, 1], [0.07, 0, 0, 1, 1], [0.3, 15, 3, 0.62, 1.03], [0.5, 6, 6, 0.52, 1.08], [0.72, -13, 2, 0.64, 1.03], [0.93, 0, 0, 1, 1]] },
  push: { about: "Glides straight into the picture so near things rush past, then eases back.", keys: [[0, 0, 0, 1, 1], [0.07, 0, 0, 1, 1], [0.45, 4, 2, 0.4, 1.16], [0.6, -3, 3, 0.4, 1.18], [0.93, 0, 0, 1, 1]] },
  orbit: { about: "A slow circle around the subject. The calmest move.", keys: [[0, 0, 0, 1, 1], [0.05, 0, 0, 1, 1], [0.22, 11, 4, 0.74, 1.03], [0.4, 8, -4, 0.66, 1.05], [0.6, -8, -4, 0.66, 1.05], [0.78, -11, 4, 0.74, 1.03], [0.95, 0, 0, 1, 1]] },
  rise: { about: "Lifts up and looks down over the subject, like a crane shot.", keys: [[0, 0, 0, 1, 1], [0.07, 0, 0, 1, 1], [0.35, -5, 13, 0.62, 1.05], [0.6, 6, 10, 0.55, 1.08], [0.93, 0, 0, 1, 1]] },
  slide: { about: "Tracks sideways past the subject and back, like a camera on a rail.", keys: [[0, 0, 0, 1, 1], [0.07, 0, 0, 1, 1], [0.33, 16, 0, 0.72, 1.04], [0.66, -16, 0, 0.72, 1.04], [0.93, 0, 0, 1, 1]] },
};
export const MOVE_NAMES = Object.keys(MOVES);

/** Smooth closed curve through the keys that never overshoots a held value. */
function channel(keys, index) {
  const n = keys.length, t = keys.map((k) => k[0]), v = keys.map((k) => k[index]);
  const gap = (i) => (i === n - 1 ? 1 - t[i] + t[0] : t[i + 1] - t[i]);
  const slope = (i) => (v[(i + 1) % n] - v[i]) / gap(i);
  const m = v.map((_, i) => { const a = slope((i - 1 + n) % n), b = slope(i); return a * b <= 0 ? 0 : (2 * a * b) / (a + b); });
  return (p) => {
    p = ((p % 1) + 1) % 1; if (p < t[0]) p += 1;
    let i = n - 1; for (let k = 0; k < n - 1; k++) if (p >= t[k] && p < t[k + 1]) { i = k; break; }
    const h = gap(i), s = (p - t[i]) / h, j = (i + 1) % n, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * v[j] + (s3 - s2) * h * m[j];
  };
}

/** Returns pose(phase) for a named move or a custom key list. amount scales how far the camera travels. */
export function compileMove(move, amount = 1) {
  const keys = Array.isArray(move) ? move : MOVES[move]?.keys;
  if (!keys) throw new Error(`Unknown move "${move}". Choose one of: ${MOVE_NAMES.join(", ")}.`);
  if (keys.length < 2 || keys[0][0] !== 0) throw new Error("A move needs at least two keys and must start at phase 0.");
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].length !== 5 || keys[i].some((x) => !Number.isFinite(x))) throw new Error(`Key ${i + 1} must be five numbers: phase, swing, tilt, distance, zoom.`);
    if (i && keys[i][0] <= keys[i - 1][0]) throw new Error("Key phases must increase.");
    if (keys[i][0] >= 1) throw new Error("Key phases must be below 1.");
    if (keys[i][3] < 0.25 || keys[i][3] > 2 || keys[i][4] < 0.5 || keys[i][4] > 3) throw new Error(`Key ${i + 1}: distance must be 0.25 to 2 and zoom 0.5 to 3.`);
    if (Math.abs(keys[i][1]) > 40 || Math.abs(keys[i][2]) > 30) throw new Error(`Key ${i + 1}: swing is limited to 40 degrees and tilt to 30.`);
  }
  if (keys[0][1] || keys[0][2] || keys[0][3] !== 1 || keys[0][4] !== 1) throw new Error("A move must start on the untouched picture: 0, 0, 0, 1, 1.");
  const yaw = channel(keys, 1), pitch = channel(keys, 2), dist = channel(keys, 3), zoom = channel(keys, 4);
  return (p) => {
    const y = yaw(p) * amount, t = pitch(p) * amount, d = Math.max(0.3, 1 + (dist(p) - 1) * amount), z = 1 + (zoom(p) - 1) * amount;
    const open = Math.min(1, Math.max(Math.abs(y) / 7, Math.abs(t) / 4, Math.abs(1 - d) / 0.2));
    return { yaw: y, pitch: t, dist: d, zoom: z, open: open * open * (3 - 2 * open) };
  };
}
