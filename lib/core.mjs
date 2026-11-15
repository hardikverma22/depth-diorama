// Shared plumbing: errors, argument parsing, scene lookup, the local server and the headless browser.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EXIT = { ok: 0, failed: 1, usage: 2, environment: 3, scene: 4 };

export class CliError extends Error {
  constructor(message, code = EXIT.usage, hint = "") { super(message); this.code = code; this.hint = hint; }
}

export const ASPECTS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };
export const FORMATS = ["mp4", "webm"];
export const LOOK_NAMES = ["day", "dusk", "night", "rain", "studio"];
export const CHOREOS = ["reveal", "snap", "grand", "launch", "glide", "turntable"];

const nearest = (word, options) => {
  const dist = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const best = options.map((o) => [dist(word, o), o]).sort((x, y) => x[0] - y[0])[0];
  return best && best[0] <= 3 ? best[1] : null;
};
export const suggest = (word, options) => { const n = nearest(word, options); return n ? ` Did you mean "${n}"?` : ""; };

/** spec: { flag: "string" | "number" | "boolean" }. Rejects unknown flags and missing values. */
export function parseArgs(argv, spec) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const eq = a.indexOf("="), key = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (!spec[key]) throw new CliError(`Unknown option --${key}.${suggest(key, Object.keys(spec))}`);
    if (spec[key] === "boolean") { if (eq > 0) throw new CliError(`--${key} does not take a value.`); out[key] = true; continue; }
    const raw = eq > 0 ? a.slice(eq + 1) : argv[++i];
    if (raw === undefined || (eq < 0 && raw.startsWith("--"))) throw new CliError(`--${key} needs a value.`);
    if (raw === "") throw new CliError(`--${key} needs a value.`);
    if (spec[key] === "number") { const n = Number(raw); if (!Number.isFinite(n)) throw new CliError(`--${key} must be a number, got "${raw}".`); out[key] = n; } else out[key] = raw;
  }
  return out;
}

export function oneOf(value, allowed, label) {
  if (value !== undefined && !allowed.includes(value)) throw new CliError(`Unknown ${label} "${value}". Choose one of: ${allowed.join(", ")}.${suggest(String(value), allowed)}`);
  return value;
}
export function inRange(value, lo, hi, label) {
  if (value !== undefined && !(value >= lo && value <= hi)) throw new CliError(`${label} must be between ${lo} and ${hi}, got ${value}.`);
  return value;
}

/** A scene is a name in scenes/, a folder containing scene.js, or a path to a .js file. */
export function resolveScene(arg) {
  if (!arg) throw new CliError("Which scene? Give a name or a path, e.g. `depth-diorama preview pier`.");
  const candidates = [path.join(ROOT, "scenes", arg, "scene.js"), path.resolve(arg, "scene.js"), path.resolve(arg)];
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  const known = fs.existsSync(path.join(ROOT, "scenes")) ? fs.readdirSync(path.join(ROOT, "scenes")) : [];
  throw new CliError(`Scene "${arg}" was not found.${suggest(arg, known)}`, EXIT.usage, known.length ? `Built-in scenes: ${known.join(", ")}` : "");
}

/** Catches syntax errors with a real line number before a browser is involved. */
export async function checkSceneSyntax(file) {
  const esbuild = await import("esbuild");
  try { await esbuild.transform(fs.readFileSync(file, "utf8"), { loader: "js", sourcefile: file, logLevel: "silent" }); }
  catch (e) {
    const m = e.errors?.[0];
    throw new CliError(m ? `Syntax error in ${path.basename(file)}, line ${m.location.line}: ${m.text}` : e.message, EXIT.scene, m?.location?.lineText?.trim() ?? "");
  }
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };

/** Serves only the folders it is given. Nothing else on disk is reachable. */
export function startServer(sceneFile) {
  return serve({ "/engine/": path.join(ROOT, "engine"), "/vendor/three/": path.join(ROOT, "node_modules", "three"), "/scene/": path.dirname(sceneFile) });
}
export function serve(mounts) {
  const server = http.createServer((req, res) => {
    let url; try { url = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400); return res.end(); }
    const mount = Object.keys(mounts).find((m) => url.startsWith(m));
    if (!mount) { res.writeHead(404); return res.end("not found"); }
    const base = mounts[mount], file = path.resolve(base, url.slice(mount.length));
    if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" }); res.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) }));
  });
}

export function ffmpegPath() { return process.env.FFMPEG || "ffmpeg"; }
export function ffprobePath() { return process.env.FFPROBE || (process.env.FFMPEG ? path.join(path.dirname(process.env.FFMPEG), "ffprobe") : "ffprobe"); }
export function hasTool(cmd) { const r = spawnSync(cmd, ["-version"], { stdio: "ignore" }); return !r.error && r.status === 0; }
export function requireFfmpeg() {
  if (!hasTool(ffmpegPath())) throw new CliError("ffmpeg was not found.", EXIT.environment, "Install it (macOS: brew install ffmpeg) or set FFMPEG=/path/to/ffmpeg.");
}

function launchArgs() {
  if (process.platform === "darwin") return ["--use-angle=metal", "--ignore-gpu-blocklist"];
  return ["--use-angle=default", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"];
}

export async function launchBrowser() {
  const { chromium } = await import("playwright");
  try { return await chromium.launch({ args: launchArgs(), handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }); }
  catch (e) {
    if (/Executable doesn't exist|browserType\.launch/.test(e.message)) throw new CliError("The render browser is not installed.", EXIT.environment, "Run: node bin/depth-diorama.mjs setup");
    throw new CliError(`Could not start the browser: ${e.message.split("\n")[0]}`, EXIT.environment);
  }
}

const explain = (message) => {
  if (/kit\.\w+ is not a function/.test(message)) return `${message}. See the kit reference in SCENES.md for available props.`;
  return message;
};

/** Opens a scene in a headless page and waits for window.DR, turning every failure into a readable error. */
export async function openScene(sceneFile, { width, height, quality = "final", look, choreo, duration, timeoutMs } = {}) {
  await checkSceneSyntax(sceneFile);
  const srv = await startServer(sceneFile);
  const params = new URLSearchParams({ scene: `/scene/${path.basename(sceneFile)}`, w: width, h: height, quality });
  if (look) params.set("look", look); if (choreo) params.set("choreo", choreo); if (duration) params.set("duration", duration);
  return openPage(srv, `/engine/page.html?${params}`, { width, height, timeoutMs });
}

/** Opens a page served by srv and waits for window.DR. what names the thing being loaded in error messages. */
export async function openPage(srv, pagePath, { width, height, timeoutMs, what = "scene", slowHint = "Look for an endless loop in build(), or reduce how much it creates." } = {}) {
  timeoutMs ??= Number(process.env.DR_LOAD_TIMEOUT_MS) || 60000;
  const What = what[0].toUpperCase() + what.slice(1);
  let browser;
  try { browser = await launchBrowser(); } catch (e) { await srv.close(); throw e; }
  const blocked = [], glErrors = [];
  // A page stuck in an endless loop can stop the browser from answering, so closing it must never wait forever.
  const close = async () => { await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000).unref?.())]); await srv.close(); };
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.route("**/*", (route) => {
      const u = route.request().url();
      if (u.startsWith(`http://127.0.0.1:${srv.port}/`) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
      blocked.push(u); return route.abort();
    });
    page.on("console", (m) => { if (m.type() === "error" && /THREE\.WebGLProgram|Shader Error|GL_INVALID/.test(m.text())) glErrors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${srv.port}${pagePath}`);
    let timer;
    const expired = new Promise((r) => { timer = setTimeout(() => r(null), timeoutMs); });
    const handle = await Promise.race([page.waitForFunction(() => window.DR_READY || window.DR_ERROR, null, { timeout: 0, polling: 50 }).catch(() => null), expired]);   // a timer on this side still fires if the page hangs
    clearTimeout(timer);
    if (!handle) throw new CliError(`The ${what} took longer than ${Math.round(timeoutMs / 1000)} seconds to load.`, EXIT.scene, slowHint);
    const err = await page.evaluate(() => window.DR_ERROR);
    if (err) throw new CliError(`${What} failed: ${explain(err.message)}`, EXIT.scene, blocked.length ? `Blocked network request: ${blocked[0]}. Scenes must be self-contained.` : "");
    if (glErrors.length) throw new CliError(`The graphics pipeline failed to compile: ${glErrors[0].slice(0, 400)}`, EXIT.environment);
    const info = await page.evaluate(() => window.DR.info());
    return { page, info, close, blocked };
  } catch (e) { await close(); throw e; }
}
