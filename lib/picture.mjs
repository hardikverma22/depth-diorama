// Picture mode: prepares a picture (size, depth map) and opens it in the film page.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { ASPECTS, CliError, EXIT, ROOT, ffmpegPath, ffprobePath, openPage, requireFfmpeg, serve } from "./core.mjs";

export const MODEL = "onnx-community/depth-anything-v2-small";
export const cacheRoot = () => process.env.DEPTH_DIORAMA_CACHE || path.join(os.homedir(), ".cache", "depth-diorama");
const LONG_SIDE = 2048, VERSION = 5;

/** Runs the depth model in a separate process and returns the size of the depth map it wrote. */
function estimateDepth(image, out, log) {
  const modelsDir = path.join(cacheRoot(), "models"), cached = fs.existsSync(path.join(modelsDir, MODEL));
  if (!cached) log("Downloading the depth model (about 100 MB, once only)...");
  const r = spawnSync(process.execPath, [path.join(ROOT, "lib", "depth-worker.mjs"), image, out, modelsDir, MODEL], { encoding: "utf8", maxBuffer: 1 << 24, timeout: Number(process.env.DR_DEPTH_TIMEOUT_MS) || 600000 });
  const said = String(r.stdout ?? "").split("\n").filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const done = said.find((m) => m.dw), bad = said.find((m) => m.error);
  if (done && fs.existsSync(out)) return done;   // a crash after the result is written does not matter
  if (bad?.error === "missing") throw new CliError("The depth model library is not installed.", EXIT.environment, "Run: npm install");
  const why = bad?.message ?? (r.error?.code === "ETIMEDOUT" ? "it took too long" : String(r.stderr ?? "").trim().split("\n").pop() ?? "unknown error");
  throw new CliError(`Could not work out the depth of the picture: ${why}`, EXIT.environment, cached ? "Delete the models folder in the cache and try again." : "The first run needs an internet connection to download the depth model.");
}

/** Reads the picture, makes a working copy and a depth map. Results are cached by file content. */
export async function preparePicture(file, { log = () => {} } = {}) {
  requireFfmpeg();
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (e) { throw new CliError(`Cannot read the picture ${file}: ${e.code ?? e.message}.`, EXIT.usage); }
  const key = crypto.createHash("sha1").update(bytes).update(`v${VERSION}`).digest("hex").slice(0, 20);
  const dir = path.join(cacheRoot(), "pictures", key), meta = path.join(dir, "meta.json");
  if (fs.existsSync(meta)) { try { return { dir, ...JSON.parse(fs.readFileSync(meta, "utf8")), cached: true }; } catch { /* rebuild below */ } }
  fs.mkdirSync(dir, { recursive: true });
  const image = path.join(dir, "image.png");
  const r = spawnSync(ffmpegPath(), ["-y", "-loglevel", "error", "-i", file, "-frames:v", "1", "-vf", `scale='min(${LONG_SIDE},iw)':'min(${LONG_SIDE},ih)':force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,split[a][b];[a]drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:replace=1[bg];[bg][b]overlay=format=auto,format=rgb24`, "-update", "1", image]);
  if (r.status !== 0) throw new CliError(`This file could not be read as a picture: ${path.basename(file)}.`, EXIT.usage, String(r.stderr).trim().split("\n").pop() ?? "");
  const probe = spawnSync(ffprobePath(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", image]);
  const [width, height] = String(probe.stdout).trim().split(",").map(Number);
  if (!(width >= 64 && height >= 64)) throw new CliError(`The picture is too small (${width}x${height}). It needs at least 64 pixels each way.`, EXIT.usage);
  if (Math.max(width / height, height / width) > 4) throw new CliError("The picture is too long and thin. Use one no more than four times as long as it is wide.", EXIT.usage);
  const { dw, dh } = estimateDepth(image, path.join(dir, "depth.f32"), log);
  const info = { width, height, dw, dh };
  fs.writeFileSync(meta, JSON.stringify(info));
  return { dir, ...info, cached: false };
}

/** Output size for an aspect name, or the picture's own shape for "auto". */
export function frameSize(aspect, prepared) {
  if (aspect && aspect !== "auto") { const [width, height] = ASPECTS[aspect]; return { width, height }; }
  const a = Math.min(2, Math.max(0.5, prepared.width / prepared.height)), even = (v) => Math.round(v / 2) * 2;
  return a >= 1 ? { width: 1920, height: even(1920 / a) } : { width: even(1920 * a), height: 1920 };
}

/** Returns an opener with the same shape as openScene, for renderStills and renderVideo. */
export function pictureOpener(prepared, options) {
  return async (_file, { width, height, quality, duration }) => {
    const cfg = { ...options, image: "/data/image.png", depth: "/data/depth.f32", dw: prepared.dw, dh: prepared.dh, w: width, h: height, quality, duration: duration ?? options.duration };
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-picture-"));
    fs.writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify(cfg));
    const srv = await serve({ "/picture/": path.join(ROOT, "picture"), "/vendor/three/": path.join(ROOT, "node_modules", "three"), "/config/": cfgDir, "/data/": prepared.dir });
    const stop = srv.close; srv.close = async () => { await stop(); fs.rmSync(cfgDir, { recursive: true, force: true }); };
    return openPage(srv, "/picture/page.html", { width, height, what: "picture", timeoutMs: Number(process.env.DR_LOAD_TIMEOUT_MS) || 180000, slowHint: "Try a smaller picture." });
  };
}
