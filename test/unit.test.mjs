// Pure logic: timeline maths, auto-framing, layouts, choreography, looks and argument handling.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { compileTimeline, curve, fitFlatFrame, seeded, shotDistance, tileLayout, wrap } from "../engine/math.js";
import { buildShots, buildTimeline, CHOREOGRAPHIES, FLAT_LENS_LIMIT } from "../engine/choreo.js";
import { LOOKS, resolveLook } from "../engine/looks.js";
import { CliError, inRange, oneOf, parseArgs, resolveScene } from "../lib/core.mjs";

const SHOT = { frame: 20, lens: 2, y: 5 };
const beats = (over = {}) => [{ t: 0, shot: SHOT }, { t: 1, shot: { ...SHOT, frame: 10, lens: 60 } }, { t: 2, shot: SHOT, ...over }];

describe("curve", () => {
  const f = curve([0, 1, 2, 3], [0, 10, 10, 0]);
  it("passes through every key", () => { for (const [x, y] of [[0, 0], [1, 10], [2, 10], [3, 0]]) assert.ok(Math.abs(f(x) - y) < 1e-9); });
  it("never overshoots", () => { for (let x = 0; x <= 3; x += 0.01) assert.ok(f(x) >= -1e-9 && f(x) <= 10 + 1e-9); });
  it("stays exactly still across equal keys", () => { for (let x = 1; x <= 2; x += 0.05) assert.equal(f(x), 10); });
  it("has continuous velocity at a key", () => { const g = curve([0, 1, 3], [0, 2, 3]), e = 1e-5; const left = (g(1) - g(1 - e)) / e, right = (g(1 + e) - g(1)) / e; assert.ok(Math.abs(left - right) < 1e-3); });
  it("clamps outside its range", () => { assert.equal(f(-5), 0); assert.equal(f(9), 0); });
  it("rejects times that do not increase", () => assert.throws(() => curve([0, 1, 1], [0, 1, 2]), /increase/));
  it("rejects a single point", () => assert.throws(() => curve([0], [0]), /at least 2/));
});

describe("timeline", () => {
  it("is periodic", () => { const t = compileTimeline(beats(), 2); assert.deepEqual(t.at(0.37), t.at(2.37)); assert.deepEqual(t.at(0.37), t.at(-1.63)); });
  it("first and last moments match", () => { const t = compileTimeline(beats(), 2); assert.ok(Math.abs(t.at(0).frame - t.at(2 - 1e-9).frame) < 1e-6); });
  it("rejects a loop that does not close", () => assert.throws(() => compileTimeline([{ t: 0, shot: SHOT }, { t: 1, shot: SHOT }, { t: 2, shot: { ...SHOT, frame: 9 } }], 2), /does not close/));
  it("rejects a late first beat", () => assert.throws(() => compileTimeline([{ t: 0.1, shot: SHOT }, { t: 1, shot: SHOT }, { t: 2, shot: SHOT }], 2), /t = 0/));
  it("rejects a short last beat", () => assert.throws(() => compileTimeline(beats(), 3), /loop end/));
  it("rejects too few beats", () => assert.throws(() => compileTimeline([{ t: 0, shot: SHOT }, { t: 1, shot: SHOT }], 1), /at least 3/));
  it("rejects a zero frame", () => assert.throws(() => compileTimeline([{ t: 0, shot: { ...SHOT, frame: 0 } }, { t: 1, shot: SHOT }, { t: 2, shot: { ...SHOT, frame: 0 } }], 2), /invalid frame/));
  it("rejects a 180 degree lens", () => assert.throws(() => compileTimeline([{ t: 0, shot: { ...SHOT, lens: 180 } }, { t: 1, shot: SHOT }, { t: 2, shot: { ...SHOT, lens: 180 } }], 2), /invalid frame or lens/));
  it("rejects NaN", () => assert.throws(() => compileTimeline([{ t: 0, shot: { ...SHOT, y: NaN } }, { t: 1, shot: SHOT }, { t: 2, shot: { ...SHOT, y: NaN } }], 2), /not a number/));
  it("blends the lens in log space", () => { const t = compileTimeline([{ t: 0, shot: { ...SHOT, lens: 1 } }, { t: 1, shot: { ...SHOT, lens: 100 } }, { t: 2, shot: { ...SHOT, lens: 1 } }], 2); assert.ok(t.at(0.5).lens < 50); });
});

describe("flat framing", () => {
  const wall = { xmin: -10, xmax: 10, ymin: 0, ymax: 12 };
  it("fills the frame when the scene allows", () => { const r = fitFlatFrame([wall], 16 / 9); assert.ok(r.reached && r.coverage >= 0.74); assert.ok(Math.abs(r.x) < 1e-6); });
  it("rests the view on the ground", () => { const r = fitFlatFrame([wall], 16 / 9); assert.ok(Math.abs(r.y - r.frame / (16 / 9) / 2) < 1e-6); });
  it("gives a narrower window for portrait", () => assert.ok(fitFlatFrame([wall], 9 / 16).frame < fitFlatFrame([wall], 16 / 9).frame));
  it("returns null for nothing at all", () => assert.equal(fitFlatFrame([], 16 / 9), null));
  it("returns null when everything is underground", () => assert.equal(fitFlatFrame([{ xmin: 0, xmax: 1, ymin: -5, ymax: -1 }], 1), null));
  it("returns null for a bad aspect", () => assert.equal(fitFlatFrame([wall], 0), null));
  it("ignores zero-size boxes", () => assert.equal(fitFlatFrame([{ xmin: 1, xmax: 1, ymin: 0, ymax: 3 }], 1), null));
  it("reports honestly when it cannot fill", () => { const r = fitFlatFrame([{ xmin: -50, xmax: -49.9, ymin: 0, ymax: 40 }, { xmin: 49.9, xmax: 50, ymin: 0, ymax: 40 }], 16 / 9, { target: 0.9 }); assert.equal(r.reached, false); });
  it("finds off-centre content", () => { const r = fitFlatFrame([{ xmin: 40, xmax: 60, ymin: 0, ymax: 12 }, { xmin: -60, xmax: -59.8, ymin: 0, ymax: 1 }], 16 / 9, { minFraction: 0.1 }); assert.ok(r.x > 20); });
});

describe("tile layout", () => {
  const span = { across: [-10, 10], depth: [10, -30] };
  it("spaces items evenly across", () => { const t = tileLayout(5, span), gaps = t.slice(1).map((p, i) => p.x - t[i].x); assert.ok(gaps.every((g) => Math.abs(g - 5) < 1e-9)); });
  it("peak puts the middle far", () => assert.equal(tileLayout(3, { ...span, shape: "peak" })[1].z, -30));
  it("vee puts the middle near", () => assert.equal(tileLayout(3, { ...span, shape: "vee" })[1].z, 10));
  it("zigzag alternates", () => { const z = tileLayout(4, { ...span, shape: "zigzag" }).map((p) => p.z); assert.deepEqual(z, [10, -30, 10, -30]); });
  it("slope is monotonic", () => { const z = tileLayout(5, { ...span, shape: "slope" }).map((p) => p.z); assert.ok(z.every((v, i) => !i || v < z[i - 1])); });
  it("handles a single item", () => assert.equal(tileLayout(1, span)[0].x, 0));
  it("rejects zero items", () => assert.throws(() => tileLayout(0, span), /at least one/));
  it("rejects an unknown shape", () => assert.throws(() => tileLayout(3, { ...span, shape: "blob" }), /unknown tile shape/));
});

describe("choreography", () => {
  const stage = { xmin: -13, xmax: 13, zmin: -76, zmax: 36, top: 20 }, flat = { x: 0, y: 7.3, frame: 26 }, hero = { x: 0, z: 5 };
  for (const name of Object.keys(CHOREOGRAPHIES)) for (const aspect of [16 / 9, 9 / 16, 1, 4 / 5]) {
    it(`${name} compiles at aspect ${aspect.toFixed(2)}`, () => { const tl = buildTimeline(buildShots(stage, flat, aspect, hero), name); assert.equal(tl.loop, CHOREOGRAPHIES[name]); });
  }
  for (const name of Object.keys(CHOREOGRAPHIES)) {
    it(`${name} only swaps on a flat lens`, () => {
      const tl = buildTimeline(buildShots(stage, flat, 16 / 9, hero), name); let prev = tl.at(0);
      for (let i = 1; i <= 2000; i++) { const cur = tl.at((i / 2000) * tl.loop); if (Math.abs(cur.swap - prev.swap) > 1e-5) assert.ok(cur.lens <= FLAT_LENS_LIMIT, `swap at lens ${cur.lens}`); prev = cur; }
    });
    it(`${name} ends where it starts`, () => { const tl = buildTimeline(buildShots(stage, flat, 16 / 9, hero), name), a = tl.at(0), b = tl.at(tl.loop - 1e-7); for (const k in a) { const d = Math.abs(a[k] - b[k]); assert.ok((k === "orbit" ? Math.min(d % 360, 360 - (d % 360)) : d) < 1e-3, k); } });
  }
  it("keeps the same camera path in every aspect", () => { const a = buildShots(stage, flat, 16 / 9, hero).deep, b = buildShots(stage, flat, 9 / 16, hero, {}, 26).deep; assert.ok(Math.abs(shotDistance(a) - shotDistance(b)) < 1e-6); });
  it("turns the first corner away from the hero", () => { assert.ok(buildShots(stage, flat, 16 / 9, { x: 5, z: 0 }).cornerAOpen.orbit < 0); assert.ok(buildShots(stage, flat, 16 / 9, { x: -5, z: 0 }).cornerAOpen.orbit > 0); });
  it("climbs less steeply in a canyon", () => assert.ok(buildShots({ ...stage, clearPitch: 50 }, flat, 16 / 9, hero).cornerAOpen.pitch <= 30));
  it("scales to a custom duration", () => { const tl = buildTimeline(buildShots(stage, flat, 16 / 9, hero), "reveal", 20); assert.equal(tl.loop, 20); assert.equal(tl.beats.at(-1).t, 20); });
  it("rejects an unknown choreography", () => assert.throws(() => buildTimeline(buildShots(stage, flat, 1, hero), "wobble"), /unknown choreography/));
  it("says what a new shot is missing and lists the built-in shots", () => assert.throws(() => buildShots(stage, flat, 1, hero, { nope: { x: 0 } }), /nope is a new shot, so it needs z, y, frame, lens[\s\S]*Built-in shots: flat/));
  it("rejects a shot derived from one that does not exist", () => assert.throws(() => buildShots(stage, flat, 1, hero, { dive: { from: "nope" } }), /no shot called "nope" to start from/));
  it("derives a new shot from an existing one", () => { const s = buildShots(stage, flat, 16 / 9, hero, { dive: { from: "deep", y: 1.2 } }); assert.equal(s.dive.y, 1.2); assert.equal(s.dive.lens, s.deep.lens); });
  it("accepts a shot defined outright", () => { const s = buildShots(stage, flat, 16 / 9, hero, { perch: { x: 0, z: -5, y: 4, frame: 12, lens: 50, pitch: 20 } }); assert.equal(s.perch.orbit, 0); assert.equal(s.perch.pitch, 20); });
  it("films a scene's own camera path and closes the loop", () => {
    const shots = buildShots(stage, flat, 16 / 9, hero, { dive: { from: "deep", y: 1.2 } });
    const tl = buildTimeline(shots, [[0, "flatIn", "flat"], [1, "flat", "flat"], [3, "dive", "reveal"], [5, "flat", "flat"], [6, "flatIn", "flat"]]);
    assert.equal(tl.loop, 6); const a = tl.at(0), b = tl.at(6 - 1e-7); for (const k in a) assert.ok(Math.abs(a[k] - b[k]) < 1e-3, k);
  });
  it("checks a scene's own camera path", () => {
    const shots = buildShots(stage, flat, 16 / 9, hero);
    assert.throws(() => buildTimeline(shots, [[0, "flat", "flat"], [2, "nope"], [4, "flat", "flat"]]), /no shot called "nope"/);
    assert.throws(() => buildTimeline(shots, [[0, "deep", "reveal"], [2, "flat", "flat"], [4, "deep", "reveal"]]), /must start on a flat beat/);
    assert.throws(() => buildTimeline(shots, [[0, "flat", "flat"], [3, "deep"], [2, "flat", "flat"]]), /times must be numbers that increase/);
  });
  it("applies an override", () => assert.equal(buildShots(stage, flat, 1, hero, { high: { y: 3 } }).high.y, 3));
});

describe("looks", () => {
  for (const name of Object.keys(LOOKS)) it(`${name} resolves to numbers`, () => { const l = resolveLook(name); for (const v of [...l.ink, ...l.shade, ...l.sky.zenith]) assert.ok(v >= 0 && v <= 1); });
  it("only glowing looks bloom, so bright paint never halos in daylight", () => assert.equal(resolveLook("day").bloom, 0));
  it("defaults to day", () => assert.equal(resolveLook().name, "day"));
  it("rejects an unknown look", () => assert.throws(() => resolveLook("noir"), /unknown look/));
  it("applies scene tuning", () => { const l = resolveLook("day", { saturation: 2, sky: { clouds: 0.1 } }); assert.equal(l.saturation, 2); assert.equal(l.sky.clouds, 0.1); assert.ok(Array.isArray(l.sky.zenith)); });
});

describe("seeded random", () => {
  it("repeats for a seed", () => { const a = seeded(5), b = seeded(5); for (let i = 0; i < 50; i++) assert.equal(a(), b()); });
  it("differs across seeds", () => assert.notEqual(seeded(1)(), seeded(2)()));
  it("stays in range", () => { const r = seeded(9); for (let i = 0; i < 2000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); } });
  it("wrap handles negatives", () => assert.ok(Math.abs(wrap(-0.5, 2) - 1.5) < 1e-9));
});

describe("argument parsing", () => {
  const spec = { look: "string", fps: "number", quiet: "boolean" };
  it("reads every form", () => assert.deepEqual(parseArgs(["a", "--look", "day", "--fps=30", "--quiet", "b"], spec), { _: ["a", "b"], look: "day", fps: 30, quiet: true }));
  it("suggests a near flag", () => assert.throws(() => parseArgs(["--lok", "day"], spec), /Did you mean "look"/));
  it("rejects an unknown flag", () => assert.throws(() => parseArgs(["--zzzzzzz"], spec), CliError));
  it("rejects a missing value", () => assert.throws(() => parseArgs(["--look"], spec), /needs a value/));
  it("rejects a flag as a value", () => assert.throws(() => parseArgs(["--look", "--quiet"], spec), /needs a value/));
  it("rejects an empty value", () => assert.throws(() => parseArgs(["--look="], spec), /needs a value/));
  it("rejects text for a number", () => assert.throws(() => parseArgs(["--fps", "fast"], spec), /must be a number/));
  it("rejects Infinity", () => assert.throws(() => parseArgs(["--fps", "Infinity"], spec), /must be a number/));
  it("rejects a value on a switch", () => assert.throws(() => parseArgs(["--quiet=yes"], spec), /does not take a value/));
  it("oneOf allows undefined", () => assert.equal(oneOf(undefined, ["a"], "x"), undefined));
  it("oneOf suggests", () => assert.throws(() => oneOf("nigth", ["night", "day"], "look"), /Did you mean "night"/));
  it("inRange enforces bounds", () => { assert.throws(() => inRange(3, 4, 30, "d"), /between/); assert.throws(() => inRange(31, 4, 30, "d"), /between/); assert.equal(inRange(4, 4, 30, "d"), 4); });
});

describe("finding a scene", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dr unit ü-"));
  fs.mkdirSync(path.join(dir, "harbour")); fs.writeFileSync(path.join(dir, "harbour", "scene.js"), "export default {}"); fs.writeFileSync(path.join(dir, "loose.js"), "export default {}");
  it("finds a built-in", () => assert.match(resolveScene("pier"), /scenes.pier.scene\.js$/));
  it("finds a folder with spaces and accents", () => assert.match(resolveScene(path.join(dir, "harbour")), /scene\.js$/));
  it("finds a file", () => assert.match(resolveScene(path.join(dir, "loose.js")), /loose\.js$/));
  it("suggests a near name", () => assert.throws(() => resolveScene("peir"), /Did you mean "pier"/));
  it("requires an argument", () => assert.throws(() => resolveScene(undefined), /Which scene/));
  it("rejects a folder with no scene", () => assert.throws(() => resolveScene(dir), /not found/));
});
