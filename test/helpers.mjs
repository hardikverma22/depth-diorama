import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BIN = path.join(ROOT, "bin", "depth-diorama.mjs");
export const tempDir = (label = "dr") => fs.mkdtempSync(path.join(os.tmpdir(), `${label} ü-`));

export function cli(args, { env = {}, cwd } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...process.env, ...env }, cwd: cwd ?? tempDir("cwd"), maxBuffer: 1 << 26 });
  return { code: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}\n${r.stderr}` };
}

export function cliAsync(args, { env = {}, cwd } = {}) {
  return spawn(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, cwd: cwd ?? tempDir("cwd"), stdio: ["ignore", "pipe", "pipe"] });
}

/** A minimal scene that passes every check, which each negative case then breaks in exactly one way. */
export const GOOD_BODY = `
  k.ground(400, 500, "#8F93A3");
  k.tile(8, { across: [-10, 10], depth: [10, -50], shape: "peak" }, ({ x, z, i }) => {
    k.building(2.6, 4 + (i % 3) * 1.5, 5, [x, z], { wall: i % 2 ? "#D8A47F" : "#7FB7BE", storey: 2.2, bay: 1.3 });
  });
  k.building(26, 16, 8, [0, -58], { wall: "#83849A" });
  for (let i = 0; i < 5; i++) { const x = -4 + i * 2; const item = k.group(() => k.cyl(0.4, 1, "#D8452E", [0, 0, 0]), [x, 0, 16]); k.swap(item, { row: [x, 16], alt: [x, 18 - i * 3] }); }
`;

export function fixture(body, header = 'look: "day",') { const d = tempDir("scene"); fs.writeFileSync(path.join(d, "scene.js"), `export default { name: "fixture", ${header} build(k) { ${body} } };\n`); return d; }
export function rawFixture(source) { const d = tempDir("scene"); fs.writeFileSync(path.join(d, "scene.js"), source); return d; }

export function verifyReport(sceneDir, args = []) {
  const report = path.join(tempDir("report"), "r.json");
  const r = cli(["verify", sceneDir, "--report", report, ...args]);
  const body = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, "utf8")) : null;
  return { ...r, body, status: (id) => body?.checks.find((c) => c.id === id)?.status };
}
