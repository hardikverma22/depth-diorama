// Picture films: the layer maths, the camera moves, the command line, and one real film from start to finish.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { cli, tempDir } from "./helpers.mjs";
import { buildLayers, fill, findCuts, minmax, normaliseDepth, regrain, subjectDepth } from "../picture/layers.js";
import { MOVE_NAMES, compileMove } from "../picture/moves.js";
import { findSubject, frameFor } from "../picture/film.js";
import { MODEL, cacheRoot, frameSize } from "../lib/picture.mjs";

// A grey wall with a bright square standing in front of it.
function card(W = 96, H = 64) {
  const rgb = new Float32Array(W * H * 3), d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, front = x >= 32 && x < 64 && y >= 16 && y < 48;
    d[i] = front ? 0.9 : 0.1;
    rgb.set(front ? [240, 60, 40] : [90 + (x % 7), 95, 100 + (y % 5)], i * 3);
  }
  return { rgb, d, W, H };
}

describe("picture: layers", () => {
  it("finds the gap between a subject and its background", () => {
    const { d, W, H } = card();
    const cuts = findCuts(d, minmax(d, W, H, 2, false), minmax(d, W, H, 2, true), W, H);
    assert.equal(cuts.length, 1); assert.ok(cuts[0] > 0.2 && cuts[0] < 0.8, `cut at ${cuts[0]}`);
  });
  it("finds no gap in a smooth slope", () => {
    const W = 96, H = 64, d = new Float32Array(W * H); for (let i = 0; i < d.length; i++) d[i] = (i % W) / W;
    assert.deepEqual(findCuts(d, minmax(d, W, H, 2, false), minmax(d, W, H, 2, true), W, H), []);
  });
  it("splits into a full background and a cut-out subject", () => {
    const { rgb, d, W, H } = card(), { layers } = buildLayers(rgb, d, W, H);
    assert.equal(layers.length, 2);
    const [back, front] = layers, mid = (32 * W + 48) * 4, corner = (2 * W + 2) * 4;
    for (let i = 3; i < back.rgba.length; i += 4) assert.equal(back.rgba[i], 255);
    assert.ok(back.rgba[mid] < 150, "the subject is painted out of the background");
    assert.equal(front.rgba[mid + 3], 255); assert.equal(front.rgba[corner + 3], 0);
    assert.ok(back.depth[32 * W + 48] < 0.3, "the background stays far behind the subject");
  });
  it("respects a layer limit of one", () => { const { rgb, d, W, H } = card(); assert.equal(buildLayers(rgb, d, W, H, { maxCuts: 0 }).layers.length, 1); });
  it("fill only changes the missing pixels", () => {
    const W = 16, H = 16, src = new Float32Array(W * H).fill(7), ok = new Uint8Array(W * H).fill(1);
    for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) { ok[y * W + x] = 0; src[y * W + x] = 99; }
    const out = fill(src, 1, ok, W, H);
    assert.ok(Math.abs(out[7 * W + 7] - 7) < 0.01); assert.equal(out[0], 7);
  });
  it("regrain keeps valid pixels and stays in range", () => {
    const { rgb, W, H } = card(), ok = new Uint8Array(W * H).fill(1); for (let y = 20; y < 40; y++) for (let x = 40; x < 60; x++) ok[y * W + x] = 0;
    const out = regrain(fill(rgb, 3, ok, W, H), ok, W, H);
    assert.equal(out[0], rgb[0]); for (const v of out) assert.ok(Number.isFinite(v));
  });
  it("normalises depth to 0..1 and reports a flat picture", () => {
    const raw = new Float32Array(100); for (let i = 0; i < 100; i++) raw[i] = 3 + i;
    const a = normaliseDepth(raw, 10, 10, 40, 40); assert.equal(a.flat, false); assert.ok(Math.min(...a.d) >= 0 && Math.max(...a.d) <= 1);
    assert.equal(normaliseDepth(new Float32Array(100).fill(5), 10, 10, 40, 40).flat, true);
  });
  it("picks the subject's depth as the still point", () => { const { d, W, H } = card(); assert.ok(subjectDepth(d, W, H) > 0.8); });
});

describe("picture: framing", () => {
  it("finds the subject's box", () => {
    const { d, W, H } = card(), box = findSubject(d, W, H);
    assert.ok(box, "a subject is found"); assert.ok(Math.abs(box.cx / (W / H) - 0.5) < 0.08 && Math.abs(box.cy - 0.5) < 0.08, JSON.stringify(box));   // units: picture height is 1
  });
  it("auto keeps a wide picture whole in a tall frame, cover fills it", () => {
    const box = { x: 0.5, y: 0.5, w: 0.5, h: 0.6 };
    const whole = frameFor(1.5, 9 / 16, "contain", box), filled = frameFor(1.5, 9 / 16, "cover", box);
    assert.ok(whole.Wf >= filled.Wf, "contain shows at least as much width as cover");
  });
  it("auto output keeps the picture's shape within limits", () => {
    assert.deepEqual(frameSize("auto", { width: 3000, height: 2000 }), { width: 1920, height: 1280 });
    assert.deepEqual(frameSize("auto", { width: 500, height: 4000 }), { width: 960, height: 1920 });
    assert.deepEqual(frameSize("9:16", { width: 3000, height: 2000 }), { width: 1080, height: 1920 });
  });
});

describe("picture: camera moves", () => {
  for (const name of MOVE_NAMES) it(`${name} starts on the picture, loops and moves smoothly`, () => {
    const pose = compileMove(name), a = pose(0), b = pose(1);
    assert.deepEqual([a.yaw, a.pitch, a.dist, a.zoom, a.open], [0, 0, 1, 1, 0]);
    assert.ok(Math.abs(b.yaw) < 1e-9 && Math.abs(b.dist - 1) < 1e-9);
    let far = 0, jump = 0, last = a;
    for (let i = 1; i <= 480; i++) { const p = pose(i / 480); far = Math.max(far, Math.abs(p.yaw), Math.abs(1 - p.dist) * 20); jump = Math.max(jump, Math.abs(p.yaw - last.yaw), Math.abs(p.dist - last.dist) * 20); last = p; }
    assert.ok(far > 3, "the camera really moves"); assert.ok(jump < 0.5, `largest step ${jump}`);
  });
  it("amount scales the travel", () => assert.ok(Math.abs(compileMove("slide", 2)(0.33).yaw) > Math.abs(compileMove("slide", 1)(0.33).yaw) * 1.9));
  it("rejects bad custom moves", () => {
    assert.throws(() => compileMove("spin"), /Unknown move/);
    assert.throws(() => compileMove([[0, 5, 0, 1, 1], [0.5, 0, 0, 1, 1]]), /untouched picture/);
    assert.throws(() => compileMove([[0, 0, 0, 1, 1], [0.5, 90, 0, 1, 1]]), /limited to 40/);
    assert.throws(() => compileMove([[0, 0, 0, 1, 1], [0.5, 0, 0, 0.1, 1]]), /distance must be/);
    assert.throws(() => compileMove([[0, 0, 0, 1, 1], [0.5, 1, 0, 1, 1], [0.4, 1, 0, 1, 1]]), /must increase/);
    assert.throws(() => compileMove([[0, 0, 0, 1, 1], [0.5, 1, 0, 1]]), /five numbers/);
  });
});

const usage = (args, pattern) => { const r = cli(["film", ...args]); assert.equal(r.code, 2, r.all); assert.match(r.all, pattern); assert.doesNotMatch(r.all, /at .*\.mjs:\d+/); };
const tiny = () => { const f = path.join(tempDir("pic"), "p.png"); fs.writeFileSync(f, "x"); return f; };

describe("picture: command line", () => {
  it("help lists film first", () => { const r = cli(["--help"]); assert.match(r.out, /film <picture>/); });
  it("moves describes every move", () => { const r = cli(["moves"]); assert.equal(r.code, 0); for (const m of MOVE_NAMES) assert.match(r.out, new RegExp(`^${m}\\b`, "m")); });
  it("needs a picture", () => usage([], /Which picture/));
  it("missing picture", () => usage(["/nope/x.jpg"], /Picture not found/));
  it("a folder is not a picture", () => usage([tempDir("d")], /Picture not found/));
  it("unreadable picture", () => usage([tiny()], /could not be read as a picture/));
  it("unknown move suggests", () => usage([tiny(), "--move", "orbt"], /Did you mean "orbit"/));
  it("broken custom move", () => usage([tiny(), "--move", "[[0,0,0"], /not valid JSON/));
  it("custom move out of limits", () => usage([tiny(), "--move", "[[0,0,0,1,1],[0.5,80,0,1,1]]"], /limited to 40/));
  it("bad aspect", () => usage([tiny(), "--aspect", "3:2"], /Unknown aspect ratio/));
  it("bad fit", () => usage([tiny(), "--fit", "stretch"], /Unknown fit/));
  it("motion out of range", () => usage([tiny(), "--motion", "9"], /between 0.2 and 2/));
  it("depth out of range", () => usage([tiny(), "--depth", "-1"], /between 0 and 2.5/));
  it("layers not whole", () => usage([tiny(), "--layers", "2.5"], /whole number/));
  it("subtitle needs a title", () => usage([tiny(), "--subtitle", "hi"], /needs --title/));
  it("bad title position", () => usage([tiny(), "--title", "A", "--title-at", "left"], /top, middle, bottom/));
  it("stills and draft together", () => usage([tiny(), "--stills", "--draft"], /not both/));
  it("unknown option suggests", () => usage([tiny(), "--titel", "A"], /Did you mean "title"/));
});

// The real thing needs the depth model, which is a one-time 100 MB download. Skipped until it is present.
const haveModel = fs.existsSync(path.join(cacheRoot(), "models", MODEL));
describe("picture: a real film", { skip: haveModel ? false : "depth model not downloaded yet (run `film` once)" }, () => {
  const dir = tempDir("film"), pic = path.join(dir, "Test Card.png");
  // a bright disc on a striped wall, with transparency in one corner
  const made = spawnSync(process.env.FFMPEG || "ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x480:d=1", "-frames:v", "1", "-vf", "format=rgba,geq=r='if(lt(hypot(X-320,Y-240),120),250,r(X,Y)*0.4)':g='if(lt(hypot(X-320,Y-240),120),200,g(X,Y)*0.4)':b='if(lt(hypot(X-320,Y-240),120),60,b(X,Y)*0.4)':a='if(lt(X+Y,80),0,255)'", "-update", "1", pic]);

  it("stills: key frames, a contact sheet and a description", () => {
    assert.equal(made.status, 0, String(made.stderr));
    const r = cli(["film", pic, "--stills", "--out", path.join(dir, "o")]);
    assert.equal(r.code, 0, r.all); assert.match(r.out, /Picture 640x480 -> film 1920x1440/); assert.match(r.out, /Layers: \d/);
    const stills = fs.readdirSync(path.join(dir, "o", "stills"));
    assert.ok(stills.includes("sheet.png")); assert.ok(stills.filter((f) => f.startsWith("still_")).length >= 3);
  });
  it("draft: a looping video that passes its checks, with a report", () => {
    const r = cli(["film", pic, "--draft", "--aspect", "1:1", "--move", "orbit", "--title", "HELLO", "--duration", "3", "--out", path.join(dir, "o")]);
    assert.equal(r.code, 0, r.all); assert.match(r.out, /All checks passed/);
    const report = JSON.parse(fs.readFileSync(path.join(dir, "o", "test-card-1x1-preview-report.json"), "utf8"));
    assert.equal(report.passed, true); assert.equal(report.info.width, 540); assert.equal(report.info.loop, 3);
    assert.ok(fs.statSync(report.video).size > 20000); assert.ok(fs.existsSync(report.contactSheet));
  });
  it("a custom move and a named output file", () => {
    const out = path.join(dir, "named", "mine.mp4");
    const r = cli(["film", pic, "--draft", "--duration", "3", "--no-verify", "--move", "[[0,0,0,1,1],[0.5,10,3,0.7,1.05]]", "--out", out]);
    assert.equal(r.code, 0, r.all); assert.ok(fs.existsSync(out));
  });
});
