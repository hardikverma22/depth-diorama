// Boots a scene module and exposes window.DR: the one interface the CLI and the player use.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildShots, buildTimeline, FLAT_LENS_LIMIT } from "./choreo.js";
import { fitFlatFrame, shotDistance, fract } from "./math.js";
import { resolveLook } from "./looks.js";
import { Pipeline } from "./pipeline.js";
import { createKit } from "./kit.js";

export class SceneError extends Error { constructor(m) { super(m); this.name = "SceneError"; } }

export function validateScene(def) {
  if (!def || typeof def !== "object") throw new SceneError("The scene file must `export default { name, look, build(kit) {...} }`.");
  if (typeof def.build !== "function") throw new SceneError("The scene is missing a build(kit) function.");
  if (def.name !== undefined && typeof def.name !== "string") throw new SceneError("scene.name must be a string.");
}

function worldBoxes(root) {
  const boxes = [], box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.userData.role === "ground" || o.userData.ignoreBounds) return;
    if (!o.visible) return;
    box.setFromObject(o);
    if (!box.isEmpty()) boxes.push({ xmin: box.min.x, xmax: box.max.x, ymin: box.min.y, ymax: box.max.y, zmin: box.min.z, zmax: box.max.z });
  });
  return boxes;
}

function mergeStatic(scene, keep) {
  scene.updateMatrixWorld(true);
  const pinned = (o) => { for (let q = o; q; q = q.parent) if (keep.has(q) || q.userData.dynamic) return true; return false; };
  const buckets = new Map(), drop = [];
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || pinned(o) || o.userData.role === "ground") return;
    const key = o.material.uuid + (o.castShadow ? "c" : "") + (o.receiveShadow ? "r" : "");
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, geos: [] });
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const a of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(a)) g.deleteAttribute(a);
    g.applyMatrix4(o.matrixWorld); g.clearGroups();
    buckets.get(key).geos.push(g); drop.push(o);
  });
  drop.forEach((o) => o.parent.remove(o));
  for (const { mat, cast, receive, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false); if (!merged) continue;
    const m = new THREE.Mesh(merged, mat); m.castShadow = cast; m.receiveShadow = receive; m.frustumCulled = false; scene.add(m);
  }
}

const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const QUALITY = { draft: { supersample: 1, minK: 1, maxK: 8, step: 6, shadow: 4096 }, final: { supersample: 1.5, minK: 4, maxK: 32, step: 2, shadow: 8192 } };

export function boot(def, options) {
  validateScene(def);
  const { canvas, width, height, quality = "final" } = options;
  const aspect = width / height, q = QUALITY[quality];
  if (!q) throw new SceneError(`unknown quality "${quality}"`);
  const look = resolveLook(options.look ?? def.look ?? "day", def.tune);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.NoToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const scene = new THREE.Scene();
  const pipeline = new Pipeline(renderer, { width, height, supersample: q.supersample, look, shadowSize: q.shadow });
  const widthFor = typeof def.flatWidth === "function" ? def.flatWidth : null;
  if (widthFor && !(widthFor(aspect) > 0 && widthFor(16 / 9) > 0)) throw new SceneError("scene.flatWidth must return a positive number of metres.");
  const kitFrame = widthFor ? { width: widthFor(aspect), height: widthFor(aspect) / aspect, distance: widthFor(16 / 9) / 2 / Math.tan((1.6 * Math.PI) / 360) } : null;
  const kit = createKit({ THREE, scene, look, aspect, frame: kitFrame });

  const built = def.build(kit);
  if (built && typeof built.then === "function") throw new SceneError("build(kit) must be synchronous; scenes load no remote assets.");
  kit._finish();

  const boxes = worldBoxes(scene);
  if (!boxes.length) throw new SceneError("The scene built no visible objects. Add something besides the ground.");
  const stage = { xmin: Infinity, xmax: -Infinity, zmin: Infinity, zmax: -Infinity, top: 0 };
  for (const b of boxes) { stage.xmin = Math.min(stage.xmin, b.xmin); stage.xmax = Math.max(stage.xmax, b.xmax); stage.zmin = Math.min(stage.zmin, b.zmin); stage.zmax = Math.max(stage.zmax, b.zmax); stage.top = Math.max(stage.top, b.ymax); }
  for (const k of ["xmin", "xmax", "zmin", "zmax", "top"]) if (!Number.isFinite(stage[k])) throw new SceneError(`The scene has invalid geometry (${k} is not finite).`);
  if (stage.zmax - stage.zmin < 4) throw new SceneError("The scene has almost no depth. Lay it out along the -z axis so there is depth to hide.");
  const center = new THREE.Vector3((stage.xmin + stage.xmax) / 2, stage.top / 2, (stage.zmin + stage.zmax) / 2);
  const radius = Math.hypot(stage.xmax - stage.xmin, stage.zmax - stage.zmin, stage.top) / 2;

  const REF = 16 / 9, areaScale = Math.sqrt(aspect / REF);
  if (def.flatWidth !== undefined && !widthFor && !(def.flatWidth > 0)) throw new SceneError("scene.flatWidth must be a positive number of metres.");
  const forced = (frame) => ({ frame, x: (stage.xmin + stage.xmax) / 2, y: frame / aspect / 2, coverage: 1, reached: true });
  const fitted = fitFlatFrame(boxes, aspect);
  const flat = widthFor ? forced(widthFor(aspect)) : def.flatWidth ? forced(aspect < 1 && fitted ? Math.min(def.flatWidth * areaScale, fitted.frame) : def.flatWidth * areaScale) : fitted;   // tall frames never trade the subject for empty sky
  if (!flat) throw new SceneError("Could not frame the scene: nothing stands above the ground.");
  const basis = widthFor ? widthFor(REF) : def.flatWidth ?? fitFlatFrame(boxes, REF).frame;
  const swaps = kit._swaps();
  const heroPos = swaps.length ? { x: swaps.reduce((s, w) => s + w.row[0], 0) / swaps.length, z: swaps.reduce((s, w) => s + (w.row[1] + w.alt[1]) / 2, 0) / swaps.length } : { x: 0, z: stage.zmax - (stage.zmax - stage.zmin) * 0.25 };
  const heroDef = typeof def.hero === "function" ? def.hero(aspect) : def.hero;
  if (heroDef) { heroPos.x = heroDef.x ?? heroPos.x; heroPos.z = heroDef.z ?? heroPos.z; heroPos.y = heroDef.y; }
  // Side walls near the hero would block a low corner view, so the corner shots climb just enough to see over them.
  const sideLine = (stage.xmin + stage.xmax) / 2, sideMass = boxes.filter((b) => Math.min(Math.abs(b.xmin - sideLine), Math.abs(b.xmax - sideLine)) > basis * 0.3 && b.zmin < heroPos.z + basis && b.zmax > heroPos.z - basis);
  const sideHeight = sideMass.reduce((m, b) => Math.max(m, b.ymax), 0);
  stage.swapFront = swaps.length ? Math.max(...swaps.flatMap((w) => [w.row[1], w.alt[1]])) : undefined;
  stage.clearPitch = (Math.atan(sideHeight / (basis * 0.75)) * 180) / Math.PI;
  const shots = buildShots(stage, flat, aspect, heroPos, typeof def.shots === "function" ? def.shots(aspect) : def.shots, basis, def.corners);
  const choreography = options.choreography ?? def.choreography ?? "reveal";
  const timeline = def.timeline ? def.timeline({ shots, buildTimeline }) : buildTimeline(shots, def.camera && !options.choreography ? def.camera : choreography, options.duration ?? def.duration);
  const loop = timeline.loop;

  const keep = new Set([...swaps.map((w) => w.object), ...kit._dynamic()]);
  mergeStatic(scene, keep);
  const grounds = []; scene.traverse((o) => { if (o.userData.role === "ground") grounds.push(o); });

  const sun = new THREE.DirectionalLight("#ffffff", Math.PI);
  const sv = new THREE.Vector3(...look.sun).normalize();
  sun.position.copy(center).addScaledVector(sv, radius * 2.2); sun.target.position.copy(center);
  sun.castShadow = true; sun.shadow.mapSize.set(pipeline.shadowSize, pipeline.shadowSize);
  Object.assign(sun.shadow.camera, { left: -radius * 1.1, right: radius * 1.1, top: radius * 1.1, bottom: -radius * 1.1, near: 1, far: radius * 4.4 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  pipeline.setStage(center, radius, kit._pools());
  pipeline.setRain(stage);
  for (const p of kit._particles()) pipeline.addParticles(p, stage);

  const cam = new THREE.PerspectiveCamera(30, aspect, 1, 100);
  const camCorners = []; for (const x of [stage.xmin, stage.xmax]) for (const y of [0, stage.top]) for (const z of [stage.zmin, stage.zmax]) camCorners.push(new THREE.Vector3(x, y, z));
  let lastStageFar = 0;
  function aim(shot, jx = 0, jy = 0) {
    const D = shotDistance(shot), o = (shot.orbit * Math.PI) / 180, half = (shot.lens * Math.PI) / 360, vt = Math.tan(half) / aspect, rise = Math.tan((shot.pitch * Math.PI) / 180);
    const cx = shot.x + Math.sin(o) * D, cz = shot.z + Math.cos(o) * D, cy = shot.y + D * rise;
    cam.position.set(cx, cy, cz); cam.up.set(0, 1, 0); cam.lookAt(cx - Math.sin(o), cy, cz - Math.cos(o));   // always level, so verticals stay vertical
    cam.fov = (2 * Math.atan(vt) * 180) / Math.PI; cam.aspect = aspect;
    let lo = Infinity, hi = 0; const fwd = new THREE.Vector3(-Math.sin(o), 0, -Math.cos(o));
    for (const c of camCorners) { const z = c.clone().sub(cam.position).dot(fwd); lo = Math.min(lo, z); hi = Math.max(hi, z); }
    lastStageFar = hi; cam.near = Math.max(0.15, Math.min(lo - 2, D * 0.5)); cam.far = Math.max(hi + 40, cam.near + 60) + 1400;
    cam.updateProjectionMatrix();
    cam.projectionMatrix.elements[9] = -(shot.horizon + rise / vt) + jy;
    cam.projectionMatrix.elements[8] += jx;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld();
  }

  const swapsDirty = () => { const v = swaps.map((w) => w.object.position.z.toFixed(4) + w.object.position.x.toFixed(4)).join(); const changed = v !== swapsDirty.last; swapsDirty.last = v; return changed; };
  const isDynamic = kit._ticks().length > 0;
  let shadowsReady = false;

  function pose(t) {
    const shot = timeline.at(t), phase = fract(t / loop);
    swaps.forEach((w) => w.apply(shot.swap));
    kit._runTicks(phase, wrapPhase, shot);
    return { shot, phase };
  }
  let wrapPhase = 0;
  function renderSample(t, jx, jy) {
    const { shot, phase } = pose(t);
    aim(shot, jx, jy);
    const dirty = !shadowsReady || isDynamic || swapsDirty(); shadowsReady = true;
    pipeline.draw({ scene, camera: cam, sun, grounds, shadowsDirty: dirty, phase });
  }

  const probePoints = [];
  for (let i = 0; i <= 4; i++) for (let k = 0; k <= 4; k++) for (const y of [0, stage.top * 0.5, stage.top]) probePoints.push(new THREE.Vector3(stage.xmin + (stage.xmax - stage.xmin) * i / 4, y, stage.zmin + (stage.zmax - stage.zmin) * k / 4));
  const project = (t) => { aim(timeline.at(t)); cam.updateMatrixWorld(); return probePoints.map((p) => p.clone().project(cam)); };
  function screenMotion(a, b) {
    const pa = project(a), pb = project(b); let m = 0;
    pa.forEach((u, i) => { const v = pb[i]; if (Math.abs(u.z) < 1 && Math.abs(v.z) < 1 && Math.abs(u.x) < 1.2 && Math.abs(u.y) < 1.2) m = Math.max(m, Math.hypot((u.x - v.x) * width / 2, (u.y - v.y) * height / 2)); });
    return m;
  }
  { let best = -1; for (let i = 0; i < 200; i++) { const t = (i / 200) * loop; const m = screenMotion(t, t + loop / 400); if (m > best) { best = m; wrapPhase = i / 200; } } }

  // A 180 degree shutter like a film camera, and blur capped at a fraction of the frame width so the fastest whip still reads.
  const blurScale = def.motionBlur ?? 1;
  if (!(blurScale >= 0 && blurScale <= 2)) throw new SceneError("scene.motionBlur must be a number from 0 (none) to 2 (double).");
  const SHUTTER = 0.5 * blurScale, BLUR_CAP = 0.035 * blurScale;
  function frame(t, fps = 60, overrideK) {
    const dt = 1 / fps;
    let half = (dt * SHUTTER) / 2, px = half > 0 ? screenMotion(t - half, t + half) : 0;
    const cap = BLUR_CAP * width;
    if (px > cap) { half *= cap / px; px = cap; }
    let k = overrideK ?? q.minK;
    if (overrideK === undefined) while (k < q.maxK && px / k > q.step) k *= 2;
    k = Math.min(k, q.maxK);
    pipeline.beginAccumulate();
    for (let i = 0; i < k; i++) {
      const u = k === 1 ? 0.5 : (i + 0.5) / k;
      const jx = q.minK > 1 || k > 1 ? ((halton(i + 1, 2) - 0.5) * 2) / pipeline.iw : 0, jy = q.minK > 1 || k > 1 ? ((halton(i + 1, 3) - 0.5) * 2) / pipeline.ih : 0;
      renderSample(t - half + u * 2 * half, jx, jy);
      pipeline.addSample(1 / k);
    }
    pipeline.present();
    return k;
  }

  // ---- measurements for `verify` ----
  const GW = 320, GH = Math.max(2, Math.round(320 / aspect));
  function snapshot(t, shotPatch) {
    const base = pose(t);
    aim({ ...base.shot, ...shotPatch });
    pipeline.draw({ scene, camera: cam, sun, grounds, shadowsDirty: true, phase: base.phase });
    return pipeline.grey(GW, GH);
  }
  const diffFraction = (a, b, thr) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > thr) n++; return n / a.length; };
  const hashOf = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
  function depthStats(t) {
    snapshot(t);
    const grid = pipeline.depthGrid(GW, GH), vals = [];
    let sky = 0, close = 0, leftC = 0, rightC = 0, topC = 0, bottomC = 0, nb = 0, nedge = 0;
    const band = Math.max(1, Math.round(GW * 0.08));
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const z = grid[j * GW + i];
      const hit = z >= 0 && z <= lastStageFar + 1;                  // far ground and sea are backdrop, not stage
      if (!hit) sky++; else { vals.push(z); if (z < 0.5) close++; }
      if (i < band || i >= GW - band) { nedge++; if (hit) { if (i < band) leftC++; else rightC++; } }
      if (j < band || j >= GH - band) { nb++; if (hit) { if (j < band) bottomC++; else topC++; } }
    }
    vals.sort((a, b) => a - b);
    const p = (f) => vals[Math.min(vals.length - 1, Math.floor(vals.length * f))] ?? 0;
    const c = cam.position, solid = boxes.some((b) => Math.min(b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin) > 0.5 && c.x > b.xmin && c.x < b.xmax && c.y > b.ymin && c.y < b.ymax && c.z > b.zmin && c.z < b.zmax);
    return { inside: solid, coverage: vals.length / (GW * GH), strength: vals.length ? p(0.95) / Math.max(p(0.05), 1e-3) : 1, blocked: close / (GW * GH), left: leftC / (nedge / 2), right: rightC / (nedge / 2), top: topC / (nb / 2), bottom: bottomC / (nb / 2) };
  }

  const measure = {
    flat() {
      const t = timeline.beats.find((b) => b.name === "flat")?.t ?? 0;
      const stats = depthStats(t), shot = timeline.at(t);
      const a = snapshot(t), b = snapshot(t, { lens: shot.lens / 12 });
      return { t, ...stats, orthoDiff: diffFraction(a, b, 40) };
    },
    beats() { return timeline.beats.map((b) => ({ t: b.t, name: b.name, role: b.role, lens: b.shot.lens, ...depthStats(Math.min(b.t, loop - 1e-3)) })); },
    /** The camera's position all along the path, not just at the beats: moves between views can sweep through buildings. */
    path() {
      const hits = [], solid = boxes.filter((b) => Math.min(b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin) > 0.5);
      for (let i = 0; i < 600; i++) {
        const t = (i / 600) * loop; aim(pose(t).shot); const c = cam.position;
        if (solid.some((b) => c.x > b.xmin && c.x < b.xmax && c.y > b.ymin && c.y < b.ymax && c.z > b.zmin && c.z < b.zmax)) hits.push(+t.toFixed(2));
      }
      return hits;
    },
    swaps() {
      const issues = []; let prev = timeline.at(0), steps = 800;
      for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * loop, cur = timeline.at(t);
        if (Math.abs(cur.swap - prev.swap) > 1e-4 && (cur.lens > FLAT_LENS_LIMIT || prev.lens > FLAT_LENS_LIMIT)) issues.push({ t: +t.toFixed(3), lens: +cur.lens.toFixed(2) });
        prev = cur;
      }
      const flatT = timeline.beats.find((b) => b.name === "flat")?.t ?? 0; const shot = timeline.at(flatT); aim(shot);
      const moves = swaps.map((w, i) => { const a = new THREE.Vector3(w.row[0], 0.5, w.row[1]).project(cam), b = new THREE.Vector3(w.alt[0], 0.5, w.alt[1]).project(cam); return { i, shift: Math.max(Math.abs(a.x - b.x) / 2, Math.abs(a.y - b.y) / 2) }; });
      return { count: swaps.length, issues, visibleShift: Math.max(0, ...moves.map((m) => m.shift)) };
    },
    repeat() { const t = loop * 0.37, a = snapshot(t); snapshot(loop * 0.81); const b = snapshot(t); return { same: hashOf(a) === hashOf(b), diff: diffFraction(a, b, 2) }; },
    seam() { const a = snapshot(0), b = snapshot(loop - 1e-4); return { diff: diffFraction(a, b, 12) }; },
  };

  return {
    frame, loop, width, height, measure, timeline, ready: kit._pending(),
    info: () => ({ name: def.name ?? "untitled", look: look.name, loop, width, height, stage, flat, swaps: swaps.length, poster: kit._usesPoster(), dynamic: isDynamic, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, gpu: gpuName(renderer), warnings: kit._warnings() }),
  };
}

function gpuName(renderer) {
  const gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
}
