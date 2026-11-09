// Stills and video. Output is written to a temporary name and only renamed once complete.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ASPECTS, CliError, EXIT, ffmpegPath, openScene, requireFfmpeg } from "./core.mjs";

export function sizeFor(aspect, scale = 1) {
  const [w, h] = ASPECTS[aspect];
  const even = (v) => Math.round(v * scale / 2) * 2;
  return { width: even(w), height: even(h) };
}

export function writableDir(file) {
  const dir = path.dirname(file);
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); }
  catch (e) { throw new CliError(`Cannot write to ${dir}: ${e.code ?? e.message}.`, EXIT.environment); }
}

export async function renderStills(sceneFile, { times, outDir, aspect = "16:9", look, choreo, duration, quality = "draft" }) {
  fs.mkdirSync(outDir, { recursive: true });
  const size = sizeFor(aspect);
  const sess = await openScene(sceneFile, { ...size, quality, look, choreo, duration });
  try {
    const list = times ?? (await sess.page.evaluate(() => DR.timeline.beats.filter((b) => b.role).map((b) => b.t)));
    const unique = [...new Set(list.map((t) => +(t % sess.info.loop).toFixed(3)))];
    const files = [];
    for (const t of unique) {
      await sess.page.evaluate(([v]) => DR.frame(v, 30), [t]);
      const file = path.join(outDir, `still_${t.toFixed(2)}.png`);
      await sess.page.screenshot({ path: file, type: "png" });
      files.push(file);
    }
    return { files, info: sess.info };
  } finally { await sess.close(); }
}

const encoderArgs = (format, quality, fps, out) => {
  const common = ["-r", String(fps), "-pix_fmt", "yuv420p"];
  if (format === "webm") return [...common, "-c:v", "libvpx-vp9", "-crf", quality === "draft" ? "34" : "22", "-b:v", "0", "-row-mt", "1", "-f", "webm", out];
  return [...common, "-c:v", "libx264", "-preset", quality === "draft" ? "veryfast" : "slow", "-crf", quality === "draft" ? "21" : "15", "-movflags", "+faststart", "-f", "mp4", out];
};

/** Renders frames [from, to) of the loop. Frames are evenly spaced so the last one flows into the first. */
export async function renderVideo(sceneFile, { out, aspect = "16:9", format = "mp4", fps, quality = "final", look, choreo, duration, from = 0, to, onProgress = () => {} }) {
  requireFfmpeg();
  writableDir(out);
  const scale = quality === "draft" ? 0.5 : 1, size = sizeFor(aspect, scale);
  const rate = fps ?? (quality === "draft" ? 30 : 60);
  const sess = await openScene(sceneFile, { ...size, quality, look, choreo, duration });
  const loop = sess.info.loop, end = to ?? loop;
  if (from < 0 || end > loop + 1e-6 || from >= end) { await sess.close(); throw new CliError(`--from and --to must satisfy 0 <= from < to <= ${loop} (the loop length).`); }
  const tmp = `${out}.part-${process.pid}`;
  const total = Math.round((end - from) * rate);
  const ff = spawn(ffmpegPath(), ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", quality === "draft" ? "mjpeg" : "png", "-framerate", String(rate), "-i", "-", ...encoderArgs(format, quality, rate, tmp)], { stdio: ["pipe", "ignore", "pipe"] });
  let ffError = "", ffGone = false;
  ff.stderr.on("data", (d) => { ffError += d; });
  ff.stdin.on("error", () => { ffGone = true; });
  const finished = new Promise((resolve) => { ff.on("close", (code) => { ffGone = true; resolve(code); }); ff.on("error", () => { ffGone = true; resolve(-1); }); });
  const started = Date.now();
  let samples = 0;
  const cleanup = () => fs.rmSync(tmp, { force: true });
  const interrupted = () => { ff.kill("SIGKILL"); cleanup(); process.exit(130); };   // the browser is shut down by its own exit hook
  process.once("SIGINT", interrupted); process.once("SIGTERM", interrupted);
  try {
    for (let i = 0; i < total; i++) {
      const t = from + i / rate;
      samples += await sess.page.evaluate(([v, r]) => DR.frame(v, r), [t, rate]);
      const buf = await sess.page.screenshot(quality === "draft" ? { type: "jpeg", quality: 93 } : { type: "png" });
      if (ffGone) throw new CliError(`The video encoder stopped: ${ffError.trim() || "unknown error"}`, EXIT.environment);
      if (!ff.stdin.write(buf)) await new Promise((r) => {
        const done = () => { ff.stdin.off("drain", done); ff.off("close", done); r(); };
        ff.stdin.once("drain", done); ff.once("close", done);
      });
      onProgress(i + 1, total);
    }
    ff.stdin.end();
    const code = await finished;
    if (code !== 0) throw new CliError(`The video encoder failed: ${ffError.trim() || `exit ${code}`}`, EXIT.environment);
    fs.renameSync(tmp, out);
    return { out, frames: total, samples, seconds: (Date.now() - started) / 1000, info: sess.info, partial: from > 0 || end < loop, fps: rate };
  } catch (e) {
    ff.kill("SIGKILL"); await finished; cleanup(); throw e;
  } finally { process.off("SIGINT", interrupted); process.off("SIGTERM", interrupted); await sess.close(); }
}
