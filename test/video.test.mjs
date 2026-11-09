// The video checker must pass good loops and catch each kind of bad one.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { analyzeFrames, probeVideo, verifyVideo } from "../lib/verify.mjs";
import { CliError } from "../lib/core.mjs";

const W = 64, H = 36, FPS = 30, N = 90;
const base = () => { const f = new Uint8Array(W * H); for (let i = 0; i < f.length; i++) f[i] = 40 + ((i * 7) % 170); return f; };
/** A pattern that drifts smoothly and returns exactly to where it began: a perfect loop. */
function goodLoop(n = N) {
  const frames = [];
  for (let k = 0; k < n; k++) { const phase = 2.2 * Math.sin((2 * Math.PI * k) / n), f = new Uint8Array(W * H); for (let i = 0; i < f.length; i++) f[i] = Math.round(128 + 90 * Math.sin(i * 0.13 + phase)); frames.push(f); }
  return frames;
}
const run = (frames, opts) => analyzeFrames(frames, W, H, FPS, opts);
const status = (r, id) => r.checks.find((c) => c.id === id)?.status;
const clone = (a) => new Uint8Array(a);

describe("positive: frames", () => {
  it("passes a good loop", () => { const r = run(goodLoop()); assert.deepEqual(r.checks.filter((c) => c.status === "fail"), []); });
  it("allows a short hold", () => { const f = goodLoop(); for (let i = 20; i < 30; i++) f[i] = clone(f[20]); assert.equal(status(run(f), "freeze"), "pass"); });
  it("skips the seam for a partial render", () => { const f = goodLoop().slice(0, 30); assert.equal(status(run(f, { partial: true }), "seam"), "skip"); });
  it("skips flicker for drafts", () => assert.equal(status(run(goodLoop(), { draft: true }), "flicker"), "skip"));
  it("passes a baseline it matches", () => {
    const f = Array.from({ length: 40 }, () => base());
    for (let i = 0; i < 40; i++) f[i][0] = 40 + i;                 // barely moving, so the frames count as still
    const first = run(f); assert.equal(status(run(f, { baseline: first.metrics.flicker ?? 0 }), "flicker-baseline"), first.metrics.flicker === null ? undefined : "pass");
  });
});

describe("negative: frames", () => {
  it("catches a loop seam jump", () => { const f = goodLoop(); const b = base(); for (let i = 0; i < 12; i++) { const g = new Uint8Array(b.length); for (let p = 0; p < g.length; p++) g[p] = 255 - b[p]; f[f.length - 1 - i] = g; } const r = run(f); assert.equal(status(r, "seam"), "fail"); });
  it("catches a single-frame pop", () => { const f = goodLoop(); f[40] = f[40].map((v) => 255 - v); assert.equal(status(run(f), "pops"), "fail"); });
  it("catches a freeze", () => { const f = goodLoop(); for (let i = 10; i < 50; i++) f[i] = clone(f[10]); assert.equal(status(run(f), "freeze"), "fail"); });
  it("catches a black frame", () => { const f = goodLoop(); f[33] = new Uint8Array(W * H); assert.equal(status(run(f), "blank"), "fail"); });
  it("catches a single-colour frame", () => { const f = goodLoop(); f[33] = new Uint8Array(W * H).fill(128); assert.equal(status(run(f), "blank"), "fail"); });
  it("catches flicker", () => {
    const s = base(), f = [];
    for (let k = 0; k < 60; k++) { const g = clone(s); for (let p = 0; p < 20; p++) g[p * 3] = k % 2 ? 230 : 20; f.push(g); }
    const r = run(f); assert.equal(status(r, "flicker"), "fail");
  });
  it("catches flicker that got worse than the baseline", () => {
    const s = base(), f = [];
    for (let k = 0; k < 60; k++) { const g = clone(s); for (let p = 0; p < 10; p++) g[p * 3] = k % 2 ? 230 : 20; f.push(g); }
    const r = run(f, { baseline: 0 }); assert.equal(status(r, "flicker-baseline"), "fail");
  });
  it("fails on too few frames", () => assert.equal(run(goodLoop().slice(0, 2)).checks[0].status, "fail"));
  it("fails on no frames", () => assert.equal(run([]).checks[0].status, "fail"));
});

describe("video files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dr video ü-"));
  const make = (name, ...args) => { const out = path.join(dir, name); const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args, out]); assert.equal(r.status, 0, String(r.stderr)); return out; };
  const moving = make("moving.mp4", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=2", "-pix_fmt", "yuv420p");
  it("reads dimensions, length and frame count", () => { const i = probeVideo(moving); assert.equal(i.width, 320); assert.equal(i.height, 180); assert.equal(i.frames, 60); assert.ok(Math.abs(i.duration - 2) < 0.1); });
  it("reports expected size and length", () => { const r = verifyVideo(moving, { expect: { width: 320, height: 180, duration: 2 }, partial: true }); assert.equal(r.checks.find((c) => c.id === "size").status, "pass"); assert.equal(r.checks.find((c) => c.id === "duration").status, "pass"); });
  it("flags the wrong size", () => assert.equal(verifyVideo(moving, { expect: { width: 640, height: 360 }, partial: true }).checks.find((c) => c.id === "size").status, "fail"));
  it("flags the wrong length", () => assert.equal(verifyVideo(moving, { expect: { duration: 10 }, partial: true }).checks.find((c) => c.id === "duration").status, "fail"));
  it("catches an all-black video", () => assert.equal(verifyVideo(make("black.mp4", "-f", "lavfi", "-i", "color=black:s=320x180:r=30:d=2", "-pix_fmt", "yuv420p"), {}).checks.find((c) => c.id === "blank").status, "fail"));
  it("catches a still image held as video", () => assert.equal(verifyVideo(make("frozen.mp4", "-f", "lavfi", "-i", "color=orange:s=320x180:r=30:d=2", "-pix_fmt", "yuv420p"), {}).checks.find((c) => c.id === "freeze").status, "fail"));
  it("handles portrait video", () => assert.equal(probeVideo(make("tall.mp4", "-f", "lavfi", "-i", "testsrc2=s=180x320:r=30:d=1", "-pix_fmt", "yuv420p")).height, 320));
  it("reads webm", () => assert.equal(probeVideo(make("v.webm", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30:d=1", "-c:v", "libvpx-vp9", "-cpu-used", "8")).codec, "vp9"));
  it("fails a one-frame video", () => assert.equal(verifyVideo(make("one.mp4", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30:d=1", "-frames:v", "1", "-pix_fmt", "yuv420p"), {}).checks[0].status, "fail"));
  it("rejects a missing file", () => assert.throws(() => verifyVideo(path.join(dir, "nope.mp4")), /not found/));
  it("rejects a directory", () => assert.throws(() => verifyVideo(dir), /Not a file/));
  it("rejects a text file named .mp4", () => { const f = path.join(dir, "fake.mp4"); fs.writeFileSync(f, "this is not a video"); assert.throws(() => verifyVideo(f), /not a readable video/); });
  it("rejects an empty file", () => { const f = path.join(dir, "empty.mp4"); fs.writeFileSync(f, ""); assert.throws(() => verifyVideo(f), CliError); });
  it("rejects a truncated file", () => { const f = path.join(dir, "cut.mp4"); fs.writeFileSync(f, fs.readFileSync(moving).subarray(0, 800)); assert.throws(() => verifyVideo(f), CliError); });
  it("rejects a file with only audio", () => { const f = make("sound.m4a", "-f", "lavfi", "-i", "sine=d=1"); assert.throws(() => verifyVideo(f), /not a readable video/); });
});
