// Pass-or-fail checks. Video checks read pixels from the finished file; scene checks measure the 3D scene directly.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { CliError, EXIT, ffmpegPath, ffprobePath, requireFfmpeg } from "./core.mjs";

export const LIMITS = {
  freezeSeconds: 0.75, freezeStep: 0.04,
  seamFloor: 1.6, seamNeighbourFactor: 3,
  popRatio: 2.5, popFloor: 3,
  blankMean: 3, blankDeviation: 1.5,
  flickerFraction: 0.006, flickerRegression: 1.3,
  posterFill: 0.9, flatStrength: 1.45, revealStrength: 1.5, flatOrthoDiff: 0.32,
  heroDb: 20, holes: 0.002,
  coverage: 0.5, margin: 0.15, blocked: 0.02, swapShift: 0.015, seamDiff: 0.03,
};

const check = (id, label, pass, value, limit, detail = "") => ({ id, label, status: pass ? "pass" : "fail", value, limit, detail });
const skip = (id, label, detail) => ({ id, label, status: "skip", detail });
const warn = (id, label, detail) => ({ id, label, status: "warn", detail });
const round = (v, d = 3) => +v.toFixed(d);

export function probeVideo(file) {
  requireFfmpeg();
  if (!fs.existsSync(file)) throw new CliError(`Video not found: ${file}`);
  if (!fs.statSync(file).isFile()) throw new CliError(`Not a file: ${file}`);
  const r = spawnSync(ffprobePath(), ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_read_packets,codec_name:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.error) throw new CliError("ffprobe was not found.", EXIT.environment, "It ships with ffmpeg.");
  let parsed; try { parsed = JSON.parse(r.stdout); } catch { parsed = {}; }
  const s = parsed.streams?.[0];
  if (r.status !== 0 || !s) throw new CliError(`This file is not a readable video: ${file}`, EXIT.failed, (r.stderr || "").trim().split("\n")[0]);
  const [a, b] = s.r_frame_rate.split("/").map(Number);
  return { width: s.width, height: s.height, fps: a / (b || 1), frames: Number(s.nb_read_packets), duration: Number(parsed.format?.duration ?? 0), codec: s.codec_name };
}

function decodeGrey(file, width, height) {
  const r = spawnSync(ffmpegPath(), ["-loglevel", "error", "-i", file, "-vf", `scale=${width}:${height}:flags=area,format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 2 ** 31 });
  if (r.status !== 0) throw new CliError("Could not decode the video.", EXIT.failed, String(r.stderr).trim().split("\n")[0]);
  const size = width * height, count = Math.floor(r.stdout.length / size), frames = [];
  for (let i = 0; i < count; i++) frames.push(new Uint8Array(r.stdout.buffer, r.stdout.byteOffset + i * size, size));
  return frames;
}

const meanStep = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const stats = (a) => { let m = 0; for (const v of a) m += v; m /= a.length; let d = 0; for (const v of a) d += (v - m) * (v - m); return { mean: m, dev: Math.sqrt(d / a.length) }; };

export function analyzeFrames(frames, width, height, fps, { partial = false, draft = false, baseline = null } = {}) {
  const out = [], L = LIMITS, n = frames.length;
  if (n < 3) return { checks: [check("frames", "Enough frames", false, n, 3, "The video has fewer than 3 frames.")], metrics: {} };
  const steps = []; for (let i = 0; i + 1 < n; i++) steps.push(meanStep(frames[i], frames[i + 1]));

  let longest = 0, run = 0, runEnd = 0;
  steps.forEach((s, i) => { if (s < L.freezeStep) { run++; if (run > longest) { longest = run; runEnd = i; } } else run = 0; });
  const frozen = longest / fps;
  out.push(check("freeze", "No frozen stretches", frozen <= L.freezeSeconds, round(frozen), L.freezeSeconds, frozen > L.freezeSeconds ? `Frozen for ${frozen.toFixed(2)}s around t=${((runEnd - longest) / fps).toFixed(2)}s` : ""));

  let blank = -1; frames.forEach((f, i) => { if (blank >= 0) return; const s = stats(f); if (s.mean < L.blankMean || s.dev < L.blankDeviation) blank = i; });
  out.push(check("blank", "No blank frames", blank < 0, blank, "none", blank >= 0 ? `Frame ${blank} (t=${(blank / fps).toFixed(2)}s) is blank` : ""));

  if (partial) out.push(skip("seam", "Loop seam is invisible", "Only part of the loop was rendered."));
  else {
    const seam = meanStep(frames[n - 1], frames[0]), near = Math.max(steps[0], steps[n - 2]), limit = Math.max(L.seamFloor, near * L.seamNeighbourFactor);
    out.push(check("seam", "Loop seam is invisible", seam <= limit, round(seam), round(limit), seam > limit ? "The last frame jumps to the first; the loop will visibly pop." : ""));
  }

  const pops = [];
  for (let i = 1; i + 1 < steps.length; i++) if (steps[i] > L.popFloor && steps[i] > L.popRatio * Math.max(steps[i - 1], steps[i + 1])) pops.push(round((i + 1) / fps, 2));
  // One wrong frame shows as two big steps that cancel out: its neighbours match each other but not it.
  for (let i = 1; i + 1 < n; i++) if (steps[i - 1] > L.popFloor && steps[i] > L.popFloor && meanStep(frames[i - 1], frames[i + 1]) * L.popRatio < Math.min(steps[i - 1], steps[i])) pops.push(round(i / fps, 2));
  out.push(check("pops", "No single-frame pops", pops.length === 0, pops.length, 0, pops.length ? `Pops at t=${pops.slice(0, 6).join(", ")}s` : ""));

  // Flicker: pixels that reverse direction sharply while the picture as a whole is nearly still.
  const counts = new Uint16Array(width * height); let still = 0;
  for (let i = 1; i + 1 < n; i++) {
    if (steps[i - 1] > 2.5 || steps[i] > 2.5) continue;
    still++;
    const a = frames[i - 1], b = frames[i], c = frames[i + 1];
    for (let p = 0; p < counts.length; p++) { const d1 = b[p] - a[p], d2 = c[p] - b[p]; if (d1 * d2 < 0 && Math.min(Math.abs(d1), Math.abs(d2)) > 16) counts[p]++; }
  }
  let flicker = null;
  if (draft) out.push(skip("flicker", "No flicker", "Draft renders are not anti-aliased enough to judge flicker. Run on a final render."));
  else if (still < 8) out.push(skip("flicker", "No flicker", `Only ${still} nearly-still frames to measure.`));
  else {
    let bad = 0; const thr = Math.max(2, still * 0.05); for (const c of counts) if (c >= thr) bad++;
    flicker = bad / counts.length;
    out.push(check("flicker", "No flicker", flicker <= L.flickerFraction, round(flicker, 5), L.flickerFraction, flicker > L.flickerFraction ? "Parts of the picture blink while the camera is still." : ""));
    if (baseline != null) out.push(check("flicker-baseline", "Flicker did not regress", flicker <= baseline * L.flickerRegression + 2e-4, round(flicker, 5), round(baseline * L.flickerRegression + 2e-4, 5), flicker > baseline * L.flickerRegression + 2e-4 ? `Baseline was ${baseline}` : ""));
  }
  return { checks: out, metrics: { flicker, stepMedian: round([...steps].sort((x, y) => x - y)[steps.length >> 1]), stillFrames: still } };
}

export function verifyVideo(file, opts = {}) {
  const info = probeVideo(file);
  const checks = [];
  if (info.frames < 3) return { file, info, checks: [check("frames", "Enough frames", false, info.frames, 3)], metrics: {} };
  const aspect = info.width / info.height, W = aspect >= 1 ? 480 : 270, H = Math.max(2, Math.round(W / aspect / 2) * 2);
  const frames = decodeGrey(file, W, H);
  const result = analyzeFrames(frames, W, H, info.fps, opts);
  checks.push(...result.checks);
  if (opts.expect) {
    const { width, height, duration } = opts.expect;
    if (width) checks.push(check("size", "Expected dimensions", info.width === width && info.height === height, `${info.width}x${info.height}`, `${width}x${height}`));
    if (duration) checks.push(check("duration", "Expected length", Math.abs(info.duration - duration) < 0.1, round(info.duration), duration));
  }
  return { file, info, checks, metrics: result.metrics };
}

export async function verifyScene(page, info) {
  const L = LIMITS, out = [];
  const m = await page.evaluate(() => ({ flat: DR.measure.flat(), beats: DR.measure.beats(), path: DR.measure.path?.() ?? [], swaps: DR.measure.swaps(), repeat: DR.measure.repeat(), seam: DR.measure.seam() }));
  out.push(check("flatness", "Flat shot reads as flat", m.flat.orthoDiff <= L.flatOrthoDiff && m.flat.strength <= L.flatStrength, round(m.flat.orthoDiff), L.flatOrthoDiff, `Depth stretch ${m.flat.strength.toFixed(2)}x`));
  out.push(check("coverage", "Flat shot fills the frame", m.flat.coverage >= L.coverage, round(m.flat.coverage), L.coverage, m.flat.coverage < L.coverage ? "Too much empty sky. Add tall objects, or bring them forward in the layout." : ""));
  const margins = { left: m.flat.left, right: m.flat.right, bottom: m.flat.bottom }, thin = Object.entries(margins).filter(([, v]) => v < L.margin).map(([k]) => k);
  out.push(check("edges", "Flat shot reaches the edges", thin.length === 0, thin.join(", ") || "all", "left, right, bottom", thin.length ? `Empty along the ${thin.join(" and ")} of the frame.` : ""));
  if (info.poster) {
    const gaps = Object.entries({ top: m.flat.top, bottom: m.flat.bottom, left: m.flat.left, right: m.flat.right }).filter(([, v]) => v < L.posterFill).map(([k]) => k);
    out.push(check("poster-fill", "Poster fills the whole frame", gaps.length === 0, gaps.join(", ") || "all", "all edges", gaps.length ? `The painting stops short at the ${gaps.join(" and ")}. Compose it for this frame shape, or use k.mural.` : ""));
  }
  const reveals = m.beats.filter((b) => b.role === "reveal"), weak = reveals.filter((b) => b.strength < L.revealStrength);
  out.push(check("reveal", "Every move opens real depth", reveals.length > 0 && weak.length === 0, reveals.length ? round(Math.min(...reveals.map((b) => b.strength)), 2) : 0, L.revealStrength, weak.length ? `Weak depth at t=${weak.map((b) => b.t.toFixed(1)).join(", ")}s` : ""));
  const flats = m.beats.filter((b) => b.role === "flat"), notFlat = flats.filter((b) => b.strength > L.flatStrength);
  out.push(check("flat-holds", "Every flat hold stays flat", notFlat.length === 0, flats.length ? round(Math.max(...flats.map((b) => b.strength)), 2) : 0, L.flatStrength, notFlat.length ? `Not flat at t=${notFlat.map((b) => b.t.toFixed(1)).join(", ")}s` : ""));
  const blocked = m.beats.filter((b) => b.blocked > L.blocked || b.inside);
  out.push(check("camera-clear", "Camera is never inside an object", blocked.length === 0 && m.path.length === 0, blocked.length ? round(Math.max(...blocked.map((b) => b.blocked))) : m.path.length ? 1 : 0, L.blocked,
    blocked.length ? `Blocked at shot "${blocked[0].name}" (t=${blocked[0].t.toFixed(1)}s). Move the object or override that shot.`
      : m.path.length ? `The camera passes through an object between beats at t=${m.path.slice(0, 4).join(", ")}s. Add a beat that lifts the path clear, or move the object.` : ""));
  if (m.swaps.count === 0) out.push(warn("swap", "Objects swap while flat", "This scene has no kit.swap objects, so it loses the surprise."));
  else {
    out.push(check("swap", "Objects swap only while flat", m.swaps.issues.length === 0, m.swaps.issues.length, 0, m.swaps.issues.length ? `Swap visible at t=${m.swaps.issues[0].t}s (lens ${m.swaps.issues[0].lens} deg)` : ""));
    out.push(check("swap-hidden", "Swap is invisible in the flat view", m.swaps.visibleShift <= L.swapShift, round(m.swaps.visibleShift, 4), L.swapShift, m.swaps.visibleShift > L.swapShift ? "A swap object changes x position, so it visibly slides. Keep row and alt at the same x." : ""));
  }
  out.push(check("repeat", "Same time renders the same image", m.repeat.same, m.repeat.same ? "identical" : round(m.repeat.diff, 5), "identical", m.repeat.same ? "" : "Something depends on Math.random, the clock or render order. Use kit.rnd and the phase passed to kit.animate."));
  out.push(check("scene-seam", "Scene returns to its start", m.seam.diff <= L.seamDiff, round(m.seam.diff, 4), L.seamDiff, m.seam.diff > L.seamDiff ? "Something animated does not return to its start. Use whole numbers of cycles per loop." : ""));
  for (const w of info.warnings ?? []) out.push(warn("kit", "Scene warning", w));
  return { checks: out, measurements: m };
}

/** Checks made on the picture film itself, inside the page. */
export async function verifyPicture(page, info) {
  const m = await page.evaluate(() => ({ hero: DR.measure.hero(), holes: DR.measure.holes(), travel: DR.measure.travel() }));
  const out = [];
  out.push(check("start", "Starts on the untouched picture", m.hero >= LIMITS.heroDb, round(m.hero, 1), LIMITS.heroDb, m.hero < LIMITS.heroDb ? "The first frame does not match the picture closely enough." : ""));
  out.push(check("gaps", "No empty gaps at any angle", m.holes <= LIMITS.holes, round(m.holes, 4), LIMITS.holes, m.holes > LIMITS.holes ? "The camera sees past the picture. Lower --motion or --depth." : ""));
  if (info.layers < 2) out.push(warn("layers", "Picture has separate layers", "Nothing stands clearly in front of anything else, so the film moves as one surface."));
  if (!info.subject) out.push(warn("subject", "A clear subject was found", "No single subject stands out, so the camera turns around the middle of the picture."));
  for (const w of info.warnings ?? []) out.push(warn("picture", "Picture warning", w));
  return { checks: out, measurements: m };
}

/** One image showing the given stills side by side. */
export function stillsSheet(files, outPng, { columns = 4, width = 480 } = {}) {
  requireFfmpeg();
  const list = `${outPng}.txt`;
  fs.writeFileSync(list, `ffconcat version 1.0\n${files.map((f) => `file '${f.replace(/'/g, "'\\''")}'\nduration 1`).join("\n")}\n`);
  const r = spawnSync(ffmpegPath(), ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=${width}:-2,tile=${Math.min(columns, files.length)}x${Math.ceil(files.length / columns)}:padding=4:color=black`, "-frames:v", "1", "-update", "1", outPng]);
  fs.rmSync(list, { force: true });
  if (r.status !== 0) throw new CliError("Could not build the contact sheet.", EXIT.environment, String(r.stderr).trim());
  return outPng;
}

export function contactSheet(video, outPng, { count = 12, columns = 4, width = 480 } = {}) {
  const info = probeVideo(video), every = Math.max(1, Math.floor(info.frames / count)), rows = Math.ceil(count / columns);
  const r = spawnSync(ffmpegPath(), ["-y", "-loglevel", "error", "-i", video, "-vf", `select='not(mod(n\\,${every}))',scale=${width}:-2,tile=${columns}x${rows}:padding=4:color=black`, "-frames:v", "1", "-fps_mode", "passthrough", outPng]);
  if (r.status !== 0) throw new CliError("Could not build the contact sheet.", EXIT.environment, String(r.stderr).trim());
  return outPng;
}

export const failedChecks = (checks) => checks.filter((c) => c.status === "fail");

export function printChecks(title, checks, write = (s) => process.stdout.write(s)) {
  const mark = { pass: "PASS", fail: "FAIL", skip: "SKIP", warn: "WARN" };
  write(`\n${title}\n`);
  for (const c of checks) write(`  ${mark[c.status]}  ${c.label}${c.value !== undefined ? `  (${c.value}, limit ${c.limit})` : ""}${c.detail ? `\n        ${c.detail}` : ""}\n`);
}
