// First-run setup with no dependencies of its own: it uses only Node's built-in modules, so it can run before anything is installed.
// Packages are installed once per user into ~/.cache/depth-diorama/deps/<lockfile hash>/ and linked into the skill folder.
// A plugin update replaces the skill folder, so it only has to link again; a changed lockfile gets a fresh install beside the old one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULES = path.join(ROOT, "node_modules");
const REQUIRED = ["three", "playwright", "esbuild"];
const PICTURE = "@huggingface/transformers";

const say = (s) => process.stderr.write(`${s}\n`);
const has = (dir, name) => fs.existsSync(path.join(dir, name, "package.json"));
const cacheRoot = () => process.env.DEPTH_DIORAMA_CACHE || path.join(os.homedir(), ".cache", "depth-diorama");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function storeDir() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const lock = fs.existsSync(path.join(ROOT, "package-lock.json")) ? fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8") : "";
  const key = crypto.createHash("sha1").update(JSON.stringify(pkg.dependencies ?? {})).update(lock).digest("hex").slice(0, 12);
  return path.join(cacheRoot(), "deps", key);
}

function runNpm(args, cwd) {
  const r = spawnSync(npm, [...args, "--no-audit", "--no-fund", "--loglevel=error"], { cwd, stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32" });
  if (r.error?.code === "ENOENT") fail("npm was not found. Install Node.js 20 or newer from nodejs.org (it includes npm), then try again.");
  if (r.status !== 0) fail("Installing the packages failed. Check your internet connection and try again.");
}

function fail(message) { say(`Error: ${message}`); process.exit(3); }

/** Makes node_modules in the skill folder point at the shared, installed copy. */
function link(target) {
  try {
    const st = fs.lstatSync(MODULES, { throwIfNoEntry: false });
    if (st) { if (st.isSymbolicLink() || st.isFile()) fs.rmSync(MODULES, { force: true }); else return false; }
    fs.symlinkSync(target, MODULES, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch { return false; }
}

/** Installs the packages every command needs, the first time only. */
export function ensureDeps() {
  if (REQUIRED.every((name) => has(MODULES, name))) return;
  const store = storeDir(), modules = path.join(store, "node_modules");
  if (!REQUIRED.every((name) => has(modules, name))) {
    say("First run: installing the packages Depth Diorama needs. This happens once and takes about a minute.");
    fs.mkdirSync(store, { recursive: true });
    for (const f of ["package.json", "package-lock.json"]) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(store, f));
    runNpm([fs.existsSync(path.join(store, "package-lock.json")) ? "ci" : "install", "--omit=dev"], store);
  }
  if (!link(modules)) {
    // The skill folder holds a real node_modules already, or links are not allowed here: install in place instead.
    runNpm(["install", "--omit=dev"], ROOT);
  }
  if (!REQUIRED.every((name) => has(MODULES, name))) fail("The packages did not install correctly. Delete node_modules in the skill folder and try again.");
}

/** The render browser (Chromium's headless shell, all the renderer uses), downloaded once into Playwright's own per-user cache. */
export async function ensureBrowser() {
  const { chromium } = await import("playwright");
  try { const b = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }); await b.close(); return; }
  catch (e) { if (!/Executable doesn't exist|Looks like Playwright/.test(e.message)) return; }   // any other problem is reported by the command itself
  say("First run: downloading the render browser (about 100 MB, once).");
  const r = spawnSync(process.execPath, [path.join(MODULES, "playwright", "cli.js"), "install", "chromium", "--only-shell"], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) fail("The render browser could not be downloaded. Check your internet connection and run the command again.");
}

/** The depth model library used only by `film`, installed the first time someone films a picture. */
export function ensurePictureDeps() {
  if (has(MODULES, PICTURE)) return;
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const version = pkg.pictureDependencies?.[PICTURE] ?? "latest";
  const real = fs.realpathSync(MODULES), dir = path.dirname(real);
  say("First picture film: installing the depth model library. This happens once and takes a minute or two.");
  runNpm(["install", "--no-save", `${PICTURE}@${version}`], dir);
  if (!has(MODULES, PICTURE)) fail("The depth model library did not install. Check your internet connection and try again.");
}
