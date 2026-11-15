// depth-diorama: turn any place into a seamless loop that reads flat, then opens into deep 3D.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ASPECTS, CHOREOS, CliError, EXIT, FORMATS, LOOK_NAMES, ROOT, checkSceneSyntax, ffmpegPath, ffprobePath, hasTool, inRange, launchBrowser, oneOf, openScene, parseArgs, resolveScene, suggest,
} from "./core.mjs";
import { renderStills, renderVideo, sizeFor } from "./render.mjs";
import { contactSheet, failedChecks, printChecks, stillsSheet, verifyPicture, verifyScene, verifyVideo } from "./verify.mjs";
import { frameSize, pictureOpener, preparePicture } from "./picture.mjs";
import { ensurePictureDeps } from "./deps.mjs";
import { MOVES, MOVE_NAMES, compileMove } from "../picture/moves.js";

const HELP = `depth-diorama: films that open a flat image into deep 3D.

Any picture (product shot, portrait, poster, painting, landscape):
  film <picture>              Find its depth, cut it into layers, film a looping camera move
    --stills                  Only the key moments plus a contact sheet (seconds; do this first)
    --draft                   Fast half-size video
    --aspect auto|16:9|9:16|1:1|4:5|all      --move ${MOVE_NAMES.join("|")}|'[[phase,swing,tilt,distance,zoom],...]'
    --motion <0.2-2>  --depth <0-2.5>  --blur <0-2>  --fit auto|cover|contain  --focus <0-1>  --layers <1-6>
    --title "TWO|LINES"  --subtitle <text>  --title-at top|middle|bottom|<0-1>  --title-depth behind|front
    --title-color <css>  --title-size <0.2-1>  --font <css family>
    --duration <3-30>  --fps <12-60>  --format mp4|webm  --out <file or folder>  --no-verify
  moves                       Describe the camera moves

Scenes from words (<scene> is a name in scenes/, a folder holding scene.js, or the path to a scene.js):
  setup                       Install the render browser, then run doctor (the first command does this by itself)
  doctor                      Check this machine can render
  list                        Show the built-in scenes
  new <name> [--look day] [--dir <folder>]   Start a new scene from the template
  stills <scene>              Render a still of every key moment (--times 1.5,2.2 for chosen seconds, --final for full-quality motion blur)
  preview <scene>             Fast half-size video, with scene checks
  render <scene>              Full-quality video, with all checks
  verify <scene or video>     Run the checks and write a report
  share <scene>               Write one HTML file with a draggable player

Options for stills, preview and render:
  --aspect 16:9|9:16|1:1|4:5|all   --look day|dusk|night|rain|studio
  --choreo reveal|snap|grand|launch|glide|turntable     --duration <4-30 seconds>
  --format mp4|webm                --fps <12-60>
  --out <file>                     --from <s> --to <s>     --no-verify

Exit codes: 0 ok, 1 checks failed, 2 bad command, 3 machine not ready, 4 scene error.
`;

const log = (s) => process.stderr.write(`${s}\n`);
const RENDER_FLAGS = { aspect: "string", look: "string", choreo: "string", duration: "number", format: "string", fps: "number", out: "string", from: "number", to: "number", "no-verify": "boolean", baseline: "string", "save-baseline": "string" };

function renderOptions(a) {
  oneOf(a.aspect, [...Object.keys(ASPECTS), "all"], "aspect ratio");
  oneOf(a.look, LOOK_NAMES, "look");
  oneOf(a.choreo, CHOREOS, "choreography");
  oneOf(a.format, FORMATS, "format");
  inRange(a.duration, 4, 30, "--duration");
  inRange(a.fps, 12, 60, "--fps");
  if (a.fps !== undefined && !Number.isInteger(a.fps)) throw new CliError("--fps must be a whole number.");
  if (a.from !== undefined && a.from < 0) throw new CliError("--from cannot be negative.");
  return a;
}
const aspectsOf = (a) => (a.aspect === "all" ? ["16:9", "9:16", "1:1"] : [a.aspect ?? "16:9"]);
const slug = (file) => path.basename(path.dirname(file));
const stamp = (aspect) => aspect.replace(":", "x");

/** Built-in scenes write to out/ here; a scene kept anywhere else gets its own out/ folder beside it. */
function outRoot(sceneFile) { return path.resolve(sceneFile).startsWith(path.join(ROOT, "scenes") + path.sep) ? path.resolve("out") : path.join(path.dirname(path.resolve(sceneFile)), "out"); }

function outPath(a, sceneFile, aspect, multiple, suffix) {
  const format = a.format ?? "mp4";
  if (a.out) { if (!multiple) return path.resolve(a.out); const { dir, name, ext } = path.parse(path.resolve(a.out)); return path.join(dir, `${name}-${stamp(aspect)}${ext || `.${format}`}`); }
  return path.join(outRoot(sceneFile), slug(sceneFile), `${slug(sceneFile)}-${stamp(aspect)}${suffix}.${format}`);
}

function writeReport(file, body) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`); return file; }
const readBaseline = (file) => {
  if (!file) return null;
  let parsed; try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw new CliError(`Cannot read baseline ${file}: ${e.code ?? "invalid JSON"}.`); }
  if (typeof parsed.flicker !== "number") throw new CliError(`Baseline ${file} has no "flicker" number.`);
  return parsed.flicker;
};

async function runVideo(argv, quality) {
  const a = renderOptions(parseArgs(argv, RENDER_FLAGS));
  const sceneFile = resolveScene(a._[0]);
  const aspects = aspectsOf(a), multiple = aspects.length > 1, suffix = quality === "draft" ? "-preview" : "";
  const baseline = readBaseline(a.baseline);
  let failed = 0;
  for (const aspect of aspects) {
    const out = outPath(a, sceneFile, aspect, multiple, suffix);
    let lastPct = -1;
    log(`Rendering ${slug(sceneFile)} at ${aspect} (${quality})...`);
    const result = await renderVideo(sceneFile, { out, aspect, format: a.format ?? "mp4", fps: a.fps, quality, look: a.look, choreo: a.choreo, duration: a.duration, from: a.from, to: a.to,
      onProgress: (i, n) => { const p = Math.floor((i / n) * 10) * 10; if (p !== lastPct) { lastPct = p; log(`  ${p}%`); } } });
    log(`  ${result.frames} frames in ${result.seconds.toFixed(0)}s -> ${out}`);
    const report = { scene: result.info.name, aspect, quality, video: out, seconds: result.seconds, frames: result.frames, samples: result.samples, gpu: result.info.gpu };
    if (!a["no-verify"]) {
      const { width, height } = sizeFor(aspect, quality === "draft" ? 0.5 : 1);
      const v = verifyVideo(out, { partial: result.partial, draft: quality === "draft", baseline, expect: result.partial ? { width, height } : { width, height, duration: result.info.loop } });
      printChecks(`Video checks: ${path.basename(out)}`, v.checks);
      const sess = await openScene(sceneFile, { ...sizeFor(aspect, 0.5), quality: "draft", look: a.look, choreo: a.choreo, duration: a.duration });
      let s; try { s = await verifyScene(sess.page, sess.info); } finally { await sess.close(); }
      printChecks("Scene checks", s.checks);
      const sheet = out.replace(/\.[^.]+$/, "-sheet.png");
      contactSheet(out, sheet, aspect === "9:16" ? { count: 12, columns: 6, width: 270 } : {});
      const bad = [...failedChecks(v.checks), ...failedChecks(s.checks)];
      Object.assign(report, { checks: { video: v.checks, scene: s.checks }, metrics: v.metrics, contactSheet: sheet, passed: bad.length === 0 });
      failed += bad.length;
      if (a["save-baseline"] && v.metrics.flicker != null) writeReport(path.resolve(a["save-baseline"]), { flicker: v.metrics.flicker, video: out });
      process.stdout.write(`\n${bad.length ? `FAILED ${bad.length} check(s)` : "All checks passed"}. Contact sheet: ${sheet}\n`);
    }
    writeReport(out.replace(/\.[^.]+$/, "-report.json"), report);
  }
  return failed ? EXIT.failed : EXIT.ok;
}

async function cmdStills(argv) {
  const a = parseArgs(argv, { aspect: "string", look: "string", choreo: "string", duration: "number", out: "string", times: "string", final: "boolean" });
  renderOptions(a);
  if (a.aspect === "all") throw new CliError("stills renders one aspect ratio at a time.");
  const sceneFile = resolveScene(a._[0]);
  const times = a.times?.split(",").map((s) => { const n = Number(s); if (!Number.isFinite(n) || n < 0) throw new CliError(`--times has an invalid value: "${s}".`); return n; });
  const outDir = path.resolve(a.out ?? path.join(outRoot(sceneFile), slug(sceneFile), "stills"));
  const { files } = await renderStills(sceneFile, { times, outDir, aspect: a.aspect ?? "16:9", look: a.look, choreo: a.choreo, duration: a.duration, quality: a.final ? "final" : "draft" });
  for (const f of files) process.stdout.write(`${f}\n`);
  return EXIT.ok;
}

async function cmdVerify(argv) {
  const a = parseArgs(argv, { aspect: "string", look: "string", choreo: "string", duration: "number", draft: "boolean", baseline: "string", report: "string", "save-baseline": "string" });
  renderOptions(a);
  if (a.aspect === "all") throw new CliError("verify checks one aspect ratio at a time.");
  const target = a._[0];
  if (!target) throw new CliError("What should I verify? Give a scene name or a video file.");
  const looksLikeVideo = /\.(mp4|webm|mov|mkv|avi|gif)$/i.test(target);
  const baseline = readBaseline(a.baseline);
  let checks, extra = {};
  if (looksLikeVideo || (fs.existsSync(target) && fs.statSync(target).isFile() && !target.endsWith(".js"))) {
    const v = verifyVideo(path.resolve(target), { draft: a.draft, baseline }); checks = v.checks; extra = { info: v.info, metrics: v.metrics };
    if (a["save-baseline"] && v.metrics.flicker != null) writeReport(path.resolve(a["save-baseline"]), { flicker: v.metrics.flicker, video: target });
    printChecks(`Video checks: ${path.basename(target)}`, checks);
  } else {
    const sceneFile = resolveScene(target);
    const sess = await openScene(sceneFile, { ...sizeFor(a.aspect ?? "16:9", 0.5), quality: "draft", look: a.look, choreo: a.choreo, duration: a.duration });
    let s; try { s = await verifyScene(sess.page, sess.info); } finally { await sess.close(); }
    checks = s.checks; extra = { info: sess.info };
    printChecks(`Scene checks: ${sess.info.name}`, checks);
  }
  if (a.report) writeReport(path.resolve(a.report), { target, checks, ...extra, passed: failedChecks(checks).length === 0 });
  const bad = failedChecks(checks).length;
  process.stdout.write(`\n${bad ? `FAILED ${bad} check(s)` : "All checks passed"}\n`);
  return bad ? EXIT.failed : EXIT.ok;
}

function cmdNew(argv) {
  const a = parseArgs(argv, { look: "string", dir: "string" });
  oneOf(a.look, LOOK_NAMES, "look");
  const name = a._[0];
  if (!name) throw new CliError("Give the new scene a name, e.g. `depth-diorama new harbour`.");
  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(name)) throw new CliError(`Scene names use lowercase letters, numbers and hyphens, got "${name}".`);
  const dir = path.resolve(a.dir ?? path.join(ROOT, "scenes"), name), file = path.join(dir, "scene.js");
  if (fs.existsSync(file)) throw new CliError(`Scene "${name}" already exists at ${file}. It was left untouched.`);
  fs.mkdirSync(dir, { recursive: true });
  const template = fs.readFileSync(path.join(ROOT, "lib", "scene.template.js"), "utf8").replaceAll("__NAME__", name).replaceAll("__LOOK__", a.look ?? "day");
  fs.writeFileSync(file, template);
  process.stdout.write(`${file}\n`);
  return EXIT.ok;
}

async function cmdShare(argv) {
  const a = parseArgs(argv, { out: "string" });
  const sceneFile = resolveScene(a._[0]);
  await checkSceneSyntax(sceneFile);
  const out = path.resolve(a.out ?? path.join(outRoot(sceneFile), slug(sceneFile), `${slug(sceneFile)}.html`));
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, "engine", "player.js")], bundle: true, write: false, format: "iife", minify: true, target: "es2020", logLevel: "silent",
    alias: { three: path.join(ROOT, "node_modules/three/build/three.module.js") },
    plugins: [{ name: "scene", setup(b) { b.onResolve({ filter: /^__scene__$/ }, () => ({ path: sceneFile })); b.onResolve({ filter: /^three\/addons\// }, (r) => ({ path: path.join(ROOT, "node_modules/three/examples/jsm", r.path.slice("three/addons/".length)) })); } }],
  }).catch((e) => { throw new CliError(`Could not bundle the scene: ${e.errors?.[0]?.text ?? e.message}`, EXIT.scene); });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  // Picture files next to the scene travel inside the page, so it still opens with no server.
  const assets = {}, dir = path.dirname(sceneFile), types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
  const walk = (d, rel = "") => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "out") walk(path.join(d, e.name), r); else if (types[path.extname(e.name).toLowerCase()] && js.includes(e.name)) assets[r] = `data:${types[path.extname(e.name).toLowerCase()]};base64,${fs.readFileSync(path.join(d, e.name)).toString("base64")}`; } };
  walk(dir);
  const html = fs.readFileSync(path.join(ROOT, "engine", "player.template.html"), "utf8").replace("/*__BUNDLE__*/", () => `globalThis.__DR_ASSETS__=${JSON.stringify(assets)};\n${js}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  process.stdout.write(`${out} (${(html.length / 1048576).toFixed(1)} MB, opens with a double click, no server needed)\n`);
  return EXIT.ok;
}

async function cmdDoctor() {
  const rows = [], add = (label, ok, detail, fix = "") => rows.push({ label, ok, detail, fix });
  const major = Number(process.versions.node.split(".")[0]);
  add("Node 20 or newer", major >= 20, process.versions.node, "Install a current Node from nodejs.org.");
  add("ffmpeg", hasTool(ffmpegPath()), ffmpegPath(), "macOS: brew install ffmpeg. Or set FFMPEG=/path/to/ffmpeg.");
  add("ffprobe", hasTool(ffprobePath()), ffprobePath(), "It ships with ffmpeg.");
  if (hasTool(ffmpegPath())) {
    const enc = spawnSync(ffmpegPath(), ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "";
    add("H.264 encoder", enc.includes("libx264"), "libx264", "Install an ffmpeg build with libx264.");
    add("VP9 encoder (optional, for webm)", enc.includes("libvpx-vp9"), "libvpx-vp9", "Only needed for --format webm.");
  }
  add("Dependencies installed", fs.existsSync(path.join(ROOT, "node_modules/three")) && fs.existsSync(path.join(ROOT, "node_modules/playwright")), "three, playwright", "Run: npm install");
  try {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    const gl = await page.evaluate(() => { const c = document.createElement("canvas").getContext("webgl2"); if (!c) return null; const d = c.getExtension("WEBGL_debug_renderer_info"); return { float: !!c.getExtension("EXT_color_buffer_float"), gpu: d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : "unknown" }; });
    await browser.close();
    add("Render browser", true, "installed");
    add("WebGL2 with float targets", !!gl?.float, gl?.gpu ?? "no WebGL2", "This machine's GPU or driver cannot run the renderer.");
    if (gl && /swiftshader|llvmpipe/i.test(gl.gpu)) add("Hardware GPU (optional)", false, gl.gpu, "Software rendering works but is far slower.");
  } catch (e) { add("Render browser", false, e.message, e.hint ?? "Run: node bin/depth-diorama.mjs setup"); }
  const optional = (r) => /optional/.test(r.label);
  for (const r of rows) process.stdout.write(`  ${r.ok ? "OK  " : optional(r) ? "WARN" : "FAIL"}  ${r.label}: ${r.detail}${r.ok ? "" : `\n        Fix: ${r.fix}`}\n`);
  const bad = rows.filter((r) => !r.ok && !optional(r));
  process.stdout.write(bad.length ? `\nNot ready: ${bad.length} problem(s).\n` : "\nReady to render.\n");
  return bad.length ? EXIT.environment : EXIT.ok;
}

async function cmdSetup() {
  log("Installing the render browser...");
  const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules/playwright/cli.js"), "install", "chromium", "--only-shell"], { stdio: "inherit" });
  if (r.status !== 0) throw new CliError("The browser install failed.", EXIT.environment, "Check your connection and try again.");
  return cmdDoctor();
}

function cmdList() {
  for (const name of fs.readdirSync(path.join(ROOT, "scenes")).sort()) if (fs.existsSync(path.join(ROOT, "scenes", name, "scene.js"))) process.stdout.write(`${name}\n`);
  return EXIT.ok;
}

const slugName = (file) => path.basename(file).replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "picture";
const FILM_FLAGS = { aspect: "string", move: "string", motion: "number", depth: "number", blur: "number", fit: "string", focus: "number", layers: "number", title: "string", subtitle: "string", "title-at": "string", "title-depth": "string", "title-color": "string", "title-size": "number", font: "string", duration: "number", fps: "number", format: "string", out: "string", times: "string", draft: "boolean", stills: "boolean", "no-verify": "boolean" };

function filmOptions(a) {
  oneOf(a.aspect, ["auto", ...Object.keys(ASPECTS), "all"], "aspect ratio"); oneOf(a.fit, ["auto", "cover", "contain"], "fit"); oneOf(a.format, FORMATS, "format"); oneOf(a["title-depth"], ["behind", "front"], "title depth");
  inRange(a.motion, 0.2, 2, "--motion"); inRange(a.depth, 0, 2.5, "--depth"); inRange(a.blur, 0, 2, "--blur"); inRange(a.focus, 0, 1, "--focus"); inRange(a.layers, 1, 6, "--layers"); inRange(a["title-size"], 0.2, 1, "--title-size"); inRange(a.duration, 3, 30, "--duration"); inRange(a.fps, 12, 60, "--fps");
  if (a.fps !== undefined && !Number.isInteger(a.fps)) throw new CliError("--fps must be a whole number.");
  if (a.layers !== undefined && !Number.isInteger(a.layers)) throw new CliError("--layers must be a whole number.");
  if (a.subtitle && !a.title) throw new CliError("--subtitle needs --title.");
  if (a.stills && a.draft) throw new CliError("Use --stills or --draft, not both.");
  let move = a.move ?? "reveal";
  if (move.trim().startsWith("[")) { try { move = JSON.parse(move); } catch { throw new CliError("--move is not valid JSON. Give a list of keys: [[phase, swing, tilt, distance, zoom], ...]."); } }
  else oneOf(move, MOVE_NAMES, "move");
  try { compileMove(move, a.motion ?? 1); } catch (e) { throw new CliError(`--move: ${e.message}`); }
  let titleAt = a["title-at"];
  if (titleAt !== undefined && !["top", "middle", "bottom"].includes(titleAt)) { const n = Number(titleAt); if (!(n >= 0 && n <= 1)) throw new CliError(`--title-at must be top, middle, bottom or a number from 0 (top) to 1 (bottom), got "${titleAt}".`); titleAt = n; }
  return { move, motion: a.motion, depthAmount: a.depth, blur: a.blur, fit: a.fit, focus: a.focus, layers: a.layers === undefined ? undefined : a.layers - 1, title: a.title, subtitle: a.subtitle, titleAt, titleDepth: a["title-depth"], titleColor: a["title-color"], titleSize: a["title-size"], font: a.font, duration: a.duration };
}

function describe(info) {
  const pc = (v) => `${Math.round(v * 100)}%`, lines = [];
  lines.push(`Picture ${info.picture.width}x${info.picture.height} -> film ${info.width}x${info.height}, ${info.loop}s loop, move "${info.move}"`);
  lines.push(`Layers: ${info.layers}${info.layers > 1 ? ` (cut at depth ${info.cuts.join(", ")}; 0 is far, 1 is near)` : ""}. Camera holds depth ${info.focus} still.`);
  lines.push(info.subject ? `Subject: centred ${pc(info.subject.x)} across, ${pc(info.subject.y)} down; ${pc(info.subject.width)} wide, ${pc(info.subject.height)} tall.` : "Subject: none stood out.");
  lines.push(info.framing.fit === "extended" ? `Framing: whole picture kept; ${pc(info.framing.paintedIn)} of the frame is painted in around it.` : `Framing: shows ${pc(info.framing.shown.width)} of the width and ${pc(info.framing.shown.height)} of the height.`);
  if (info.title) lines.push(`Title: ${info.title.where === "behind" ? "stands behind the subject" : "in front"}, colour ${info.title.colour}.`);
  return `${lines.join("\n")}\n`;
}

async function cmdFilm(argv) {
  const a = parseArgs(argv, FILM_FLAGS), options = filmOptions(a);
  ensurePictureDeps();
  const file = a._[0];
  if (!file) throw new CliError("Which picture? e.g. `depth-diorama film photo.jpg`.");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new CliError(`Picture not found: ${file}`);
  const name = slugName(file), quality = a.draft ? "draft" : "final", format = a.format ?? "mp4";
  const prepared = await preparePicture(path.resolve(file), { log });
  if (!prepared.cached) log("Depth map made.");
  const open = pictureOpener(prepared, options);
  const aspects = a.aspect === "all" ? ["16:9", "9:16", "1:1"] : [a.aspect ?? "auto"], multiple = aspects.length > 1;
  const asDir = a.out && !path.extname(a.out), dir = path.resolve(asDir ? a.out : a.out ? path.dirname(a.out) : path.join("out", name));
  let failed = 0;
  for (const aspect of aspects) {
    const frame = frameSize(aspect, prepared), tag = aspect === "auto" ? "" : `-${stamp(aspect)}`;
    if (a.stills) {
      const times = a.times?.split(",").map((s) => { const n = Number(s); if (!Number.isFinite(n) || n < 0) throw new CliError(`--times has an invalid value: "${s}".`); return n; });
      const outDir = path.join(dir, `stills${tag}`);
      const { files, info } = await renderStills(file, { times, outDir, open, frame, quality: "draft", duration: options.duration });
      const sheet = stillsSheet(files, path.join(outDir, "sheet.png"), frame.width >= frame.height ? { columns: 3, width: 640 } : { columns: 6, width: 320 });
      process.stdout.write(`${describe(info)}Stills: ${outDir}\nContact sheet: ${sheet}\n`);
      continue;
    }
    if (a.times) throw new CliError("--times only works with --stills.");
    const base = a.out && !asDir ? path.parse(path.resolve(a.out)).name + (multiple ? tag : "") : `${name}${tag}${a.draft ? "-preview" : ""}`;
    const out = path.join(dir, `${base}.${a.out && !asDir && path.extname(a.out) ? path.extname(a.out).slice(1) : format}`);
    let lastPct = -1;
    log(`Filming ${path.basename(file)}${aspect === "auto" ? "" : ` at ${aspect}`} (${quality})...`);
    const result = await renderVideo(file, { out, format, fps: a.fps, quality, duration: options.duration, open, frame,
      onProgress: (i, n) => { const p = Math.floor((i / n) * 10) * 10; if (p !== lastPct) { lastPct = p; log(`  ${p}%`); } } });
    log(`  ${result.frames} frames in ${result.seconds.toFixed(0)}s -> ${out}`);
    process.stdout.write(describe(result.info));
    const report = { picture: path.resolve(file), aspect, quality, video: out, seconds: result.seconds, frames: result.frames, info: result.info, options };
    if (!a["no-verify"]) {
      const probe = verifyVideo(out, { draft: a.draft, expect: { width: result.info.width, height: result.info.height, duration: result.info.loop } });
      printChecks(`Video checks: ${path.basename(out)}`, probe.checks);
      const sess = await open(file, { width: Math.round(frame.width / 4) * 2, height: Math.round(frame.height / 4) * 2, quality: "draft", duration: options.duration });
      let s; try { s = await verifyPicture(sess.page, sess.info); } finally { await sess.close(); }
      printChecks("Picture checks", s.checks);
      const sheet = out.replace(/\.[^.]+$/, "-sheet.png");
      contactSheet(out, sheet, frame.width >= frame.height ? {} : { count: 12, columns: 6, width: 270 });
      const bad = [...failedChecks(probe.checks), ...failedChecks(s.checks)];
      Object.assign(report, { checks: { video: probe.checks, picture: s.checks }, metrics: { ...probe.metrics, ...s.measurements }, contactSheet: sheet, passed: bad.length === 0 });
      failed += bad.length;
      process.stdout.write(`\n${bad.length ? `FAILED ${bad.length} check(s)` : "All checks passed"}. Contact sheet: ${sheet}\n`);
    }
    writeReport(out.replace(/\.[^.]+$/, "-report.json"), report);
  }
  return failed ? EXIT.failed : EXIT.ok;
}

function cmdMoves() {
  for (const [name, m] of Object.entries(MOVES)) process.stdout.write(`${name.padEnd(8)}${m.about}\n`);
  process.stdout.write(`\nOr write your own: --move '[[0,0,0,1,1],[0.3,14,4,0.6,1.05],[0.7,-12,2,0.65,1.03]]'\nEach key is phase (0 to 1), swing and tilt in degrees, distance (1 = start, smaller = closer) and zoom.\nThe first key must be 0,0,0,1,1 so the film starts on the untouched picture; the loop closes itself.\n`);
  return EXIT.ok;
}

const COMMANDS = { film: cmdFilm, moves: cmdMoves, setup: cmdSetup, doctor: cmdDoctor, list: cmdList, new: cmdNew, stills: cmdStills, verify: cmdVerify, share: cmdShare, preview: (a) => runVideo(a, "draft"), render: (a) => runVideo(a, "final") };

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { process.stdout.write(HELP); return cmd ? EXIT.ok : EXIT.usage; }
  if (!COMMANDS[cmd]) throw new CliError(`Unknown command "${cmd}".${suggest(cmd, Object.keys(COMMANDS))}`, EXIT.usage, "Run with --help to see all commands.");
  return COMMANDS[cmd](rest);
}

// Exiting explicitly means a helper left running can never hang the command.
main().then((code) => process.exit(code)).catch((e) => {
  if (e instanceof CliError) { log(`Error: ${e.message}`); if (e.hint) log(`  ${e.hint}`); process.exit(e.code); }
  log(`Unexpected error: ${e.stack ?? e}`); process.exit(EXIT.failed);
});
