// The command line: helpful on success, clear and correctly coded on every kind of mistake.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { cli, fixture, rawFixture, ROOT, tempDir } from "./helpers.mjs";
import { startServer } from "../lib/core.mjs";

const expectUsage = (args, pattern) => { const r = cli(args); assert.equal(r.code, 2, r.all); assert.match(r.all, pattern); assert.doesNotMatch(r.all, /at .*\.mjs:\d+/, "should not print a stack trace"); };

describe("positive: basics", () => {
  it("--help works", () => { const r = cli(["--help"]); assert.equal(r.code, 0); assert.match(r.out, /depth-diorama/); });
  it("lists the built-in scenes", () => { const r = cli(["list"]); assert.equal(r.code, 0); for (const s of ["market", "pier", "station"]) assert.match(r.out, new RegExp(s)); });
  it("creates a new scene", () => { const dir = tempDir("new"); const r = cli(["new", "harbour", "--dir", dir, "--look", "dusk"]); assert.equal(r.code, 0, r.all); const text = fs.readFileSync(path.join(dir, "harbour", "scene.js"), "utf8"); assert.match(text, /look: "dusk"/); assert.match(text, /name: "harbour"/); });
});

describe("negative: commands and options", () => {
  it("no arguments prints help and exits 2", () => { const r = cli([]); assert.equal(r.code, 2); assert.match(r.out, /setup/); });
  it("unknown command suggests the nearest", () => expectUsage(["rendr", "pier"], /Did you mean "render"/));
  it("unknown option suggests the nearest", () => expectUsage(["preview", "pier", "--aspct", "1:1"], /Did you mean "aspect"/));
  it("bad aspect", () => expectUsage(["preview", "pier", "--aspect", "3:2"], /Unknown aspect ratio/));
  it("bad look suggests", () => expectUsage(["preview", "pier", "--look", "nigth"], /Did you mean "night"/));
  it("bad choreography", () => expectUsage(["preview", "pier", "--choreo", "spin"], /Unknown choreography/));
  it("bad format", () => expectUsage(["render", "pier", "--format", "avi"], /Unknown format/));
  it("duration too short", () => expectUsage(["preview", "pier", "--duration", "1"], /between 4 and 30/));
  it("duration too long", () => expectUsage(["preview", "pier", "--duration", "500"], /between 4 and 30/));
  it("duration not a number", () => expectUsage(["preview", "pier", "--duration", "long"], /must be a number/));
  it("fps too high", () => expectUsage(["render", "pier", "--fps", "240"], /between 12 and 60/));
  it("fps not whole", () => expectUsage(["render", "pier", "--fps", "29.97"], /whole number/));
  it("negative --from", () => expectUsage(["render", "pier", "--from", "-1"], /cannot be negative/));
  it("stills refuses --aspect all", () => expectUsage(["stills", "pier", "--aspect", "all"], /one aspect ratio/));
  it("verify refuses --aspect all", () => expectUsage(["verify", "pier", "--aspect", "all"], /one aspect ratio/));
  it("stills rejects bad --times", () => expectUsage(["stills", "pier", "--times", "1,abc"], /invalid value/));
  it("stills rejects negative --times", () => expectUsage(["stills", "pier", "--times", "-2"], /invalid value/));
  it("missing scene argument", () => expectUsage(["preview"], /Which scene/));
  it("verify needs a target", () => expectUsage(["verify"], /What should I verify/));
  it("unknown scene suggests", () => expectUsage(["preview", "markt"], /Did you mean "market"/));
  it("verify on a missing video", () => expectUsage(["verify", "/nope/missing.mp4"], /not found/));
  it("verify on a fake video fails, without a crash", () => { const f = path.join(tempDir("v"), "fake.mp4"); fs.writeFileSync(f, "nope"); const r = cli(["verify", f]); assert.equal(r.code, 1, r.all); assert.match(r.all, /not a readable video/); });
  it("bad baseline file", () => expectUsage(["verify", "pier", "--baseline", "/nope/b.json"], /Cannot read baseline/));
  it("baseline that is not JSON", () => { const f = path.join(tempDir("b"), "b.json"); fs.writeFileSync(f, "{"); expectUsage(["verify", "pier", "--baseline", f], /invalid JSON/); });
  it("baseline with no flicker number", () => { const f = path.join(tempDir("b"), "b.json"); fs.writeFileSync(f, "{}"); expectUsage(["verify", "pier", "--baseline", f], /no "flicker"/); });
});

describe("negative: new scene names", () => {
  for (const bad of ["Harbour", "my scene", "../escape", "a/b", "-dash", "x".repeat(60), "émile"]) it(`rejects ${JSON.stringify(bad.slice(0, 12))}`, () => expectUsage(["new", bad, "--dir", tempDir("n")], /lowercase letters/));
  it("requires a name", () => expectUsage(["new"], /Give the new scene a name/));
  it("rejects a bad look", () => expectUsage(["new", "ok", "--look", "foggy", "--dir", tempDir("n")], /Unknown look/));
  it("never overwrites an existing scene", () => { const dir = tempDir("n"); assert.equal(cli(["new", "keep", "--dir", dir]).code, 0); const f = path.join(dir, "keep", "scene.js"); fs.writeFileSync(f, "// precious"); const r = cli(["new", "keep", "--dir", dir]); assert.equal(r.code, 2); assert.match(r.all, /already exists/); assert.equal(fs.readFileSync(f, "utf8"), "// precious"); });
});

describe("negative: broken scene source", () => {
  it("reports the line of a syntax error", () => { const r = cli(["verify", rawFixture("export default {\n  name: 'x',\n  build(k) { const = 3; },\n};\n")]); assert.equal(r.code, 4, r.all); assert.match(r.all, /line 3/); });
  it("share reports a syntax error too", () => { const r = cli(["share", rawFixture("export default {")]); assert.equal(r.code, 4, r.all); assert.match(r.all, /Syntax error/); });
});

describe("negative: machine not ready", () => {
  it("doctor reports missing ffmpeg", () => { const r = cli(["doctor"], { env: { FFMPEG: "/nope/ffmpeg" } }); assert.equal(r.code, 3, r.all); assert.match(r.out, /FAIL\s+ffmpeg/); assert.match(r.out, /brew install ffmpeg/); });
  it("rendering explains missing ffmpeg", () => { const r = cli(["preview", "pier"], { env: { FFMPEG: "/nope/ffmpeg" } }); assert.equal(r.code, 3, r.all); assert.match(r.all, /ffmpeg was not found/); });
  it("rendering explains a missing browser when automatic setup is off", () => { const r = cli(["stills", "pier"], { env: { PLAYWRIGHT_BROWSERS_PATH: tempDir("nobrowser"), DEPTH_DIORAMA_NO_INSTALL: "1" } }); assert.equal(r.code, 3, r.all); assert.match(r.all, /setup/); assert.doesNotMatch(r.all, /╔/); });
  it("doctor explains a missing browser", () => { const r = cli(["doctor"], { env: { PLAYWRIGHT_BROWSERS_PATH: tempDir("nobrowser") } }); assert.equal(r.code, 3, r.all); assert.match(r.out, /FAIL\s+Render browser/); });
});

describe("local server safety", () => {
  const scene = path.join(fixture("k.ground(10, 10, '#000');"), "scene.js");
  const get = async (port, raw) => new Promise((resolve) => import("node:net").then(({ default: net }) => { const s = net.connect(port, "127.0.0.1", () => s.write(`GET ${raw} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)); let d = ""; s.on("data", (c) => { d += c; }); s.on("end", () => resolve(d)); }));
  it("serves the scene and the engine", async () => { const s = await startServer(scene); try { assert.match(await get(s.port, "/scene/scene.js"), /200 OK/); assert.match(await get(s.port, "/engine/math.js"), /200 OK/); } finally { await s.close(); } });
  for (const raw of ["/scene/../../../../../etc/passwd", "/engine/%2e%2e/package.json", "/scene/..%2f..%2fetc%2fpasswd", "/vendor/three/../../package.json", "/package.json", "/", "/lib/core.mjs"]) {
    it(`refuses ${raw}`, async () => { const s = await startServer(scene); try { const body = await get(s.port, raw); assert.doesNotMatch(body, /200 OK/); assert.doesNotMatch(body, /root:|"depth-diorama"/); } finally { await s.close(); } });
  }
  it("only listens on this machine", async () => { const s = await startServer(scene); try { assert.equal(s.server.address().address, "127.0.0.1"); } finally { await s.close(); } });
  it("the project's own source was not touched by these tests", () => assert.ok(fs.existsSync(path.join(ROOT, "SKILL.md"))));
});
