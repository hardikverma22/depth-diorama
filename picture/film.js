// Films one picture as a deep scene: the picture is cut into layers by depth, each layer is
// sculpted by its own depth map, and a camera flies a looping move that starts and ends on the
// untouched picture.
import * as THREE from "three";
import { buildLayers, fill, findCuts, minmax, normaliseDepth, subjectDepth } from "./layers.js";
import { MOVES, compileMove } from "./moves.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** 1-D opening: keeps only things that span most of a row (or column), such as floors and walls. */
function open1d(d, w, h, r, horizontal) {
  const run = (src, max) => {
    const out = new Float32Array(w * h), pick = max ? Math.max : Math.min;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = src[y * w + x];
      for (let k = -r; k <= r; k++) { const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k; if (xx >= 0 && xx < w && yy >= 0 && yy < h) v = pick(v, src[yy * w + xx]); }
      out[y * w + x] = v;
    }
    return out;
  };
  return run(run(d, false), true);
}

/** Finds the thing that stands out from its surroundings. Returns its box in picture units (height 1), or null. */
export function findSubject(raw, dw, dh) {
  const s = 128 / Math.max(dw, dh), w = Math.max(8, Math.round(dw * s)), h = Math.max(8, Math.round(dh * s));
  const { d, flat } = normaliseDepth(raw, dw, dh, w, h);
  if (flat) return null;
  const a = open1d(d, w, h, Math.round(w * 0.4), true), b = open1d(d, w, h, Math.round(h * 0.4), false);
  const xs = [], ys = [], ds = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (d[i] - Math.max(a[i], b[i]) > 0.12) { xs.push(x); ys.push(y); ds.push(d[i]); } }
  if (xs.length < w * h * 0.012) return null;
  const q = (arr, p) => { const v = [...arr].sort((m, n) => m - n); return v[Math.min(v.length - 1, Math.floor(v.length * p))]; };
  const A = dw / dh, x0 = q(xs, 0.02) / w * A, x1 = (q(xs, 0.98) + 1) / w * A, y0 = q(ys, 0.02) / h, y1 = (q(ys, 0.98) + 1) / h;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, depth: q(ds, 0.5), share: xs.length / (w * h) };
}

/** Chooses the part of the picture the film shows. Units: picture height is 1, width is A. */
export function frameFor(A, a, fit, box) {
  let Wf, Hf;
  if (A >= a) { Hf = 1; Wf = a; } else { Wf = A; Hf = A / a; }
  if (fit === "contain") { Wf = Math.max(A, a); Hf = Wf / a; }
  else if (fit !== "cover" && box) {
    const needW = Math.min(A, box.w * 1.2), needH = Math.min(1, box.h * 1.2);
    if (Wf < needW) { Wf = needW; Hf = Wf / a; }
    if (Hf < needH) { Hf = needH; Wf = Hf * a; }
  }
  const PW = Math.max(A, Wf), PH = Math.max(1, Hf);
  const cx = Wf >= A ? A / 2 : clamp(box ? box.cx : A / 2, Wf / 2, A - Wf / 2);
  const cy = Hf >= 1 ? 0.5 : clamp(box ? box.cy : 0.5, Hf / 2, 1 - Hf / 2);
  return { Wf, Hf, PW, PH, ox: (PW - A) / 2, oy: (PH - 1) / 2, cx, cy, padded: PW > A + 1e-6 || PH > 1 + 1e-6 };
}

const QUAD_VERT = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

const LAYER_VERT = `
uniform sampler2D uDepth; uniform vec2 uSize, uHero; uniform float uFocus, uRelief, uD;
varying vec2 vUv;
void main() {
  vUv = uv;
  float z = (texture2D(uDepth, uv).r - uFocus) * uRelief;
  vec2 p = vec2((uv.x - 0.5) * uSize.x, (0.5 - uv.y) * uSize.y);
  p = uHero + (p - uHero) * (uD - z) / uD;   // so the starting camera sees exactly the original picture
  gl_Position = projectionMatrix * viewMatrix * vec4(p, z, 1.0);
}`;
const LAYER_FRAG = `
uniform sampler2D uMap; varying vec2 vUv;
void main() { vec4 c = texture2D(uMap, vUv); if (c.a < 0.02) discard; gl_FragColor = c; }`;

const BLUR_FRAG = `
uniform sampler2D tColor, tDepth; uniform vec2 uPx;
uniform float uNear, uFar, uFocus, uAperture, uMaxCoc, uStep, uWeight;
varying vec2 vUv;
float viewZ(vec2 uv) { float ndc = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear)); }
float coc(float z) { return clamp(uAperture * abs(z - uFocus) / z, 0.0, uMaxCoc); }
void main() {
  vec3 col = texture2D(tColor, vUv).rgb; float tot = 1.0;
  if (uAperture > 0.05) {
    float cz = viewZ(vUv), cc = coc(cz), r = 0.7;
    for (float ang = 0.0; r < uMaxCoc; ang += 2.39996323) {
      vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uPx * r;
      float sz = viewZ(tc), sc = coc(sz);
      if (sz > cz) sc = clamp(sc, 0.0, cc * 2.0);
      col += mix(col / tot, texture2D(tColor, tc).rgb, smoothstep(r - 0.5, r + 0.5, sc));
      tot += 1.0; r += uStep / r;
    }
  }
  gl_FragColor = vec4(col / tot * uWeight, uWeight);
}`;
const SHOW_FRAG = `
uniform sampler2D tColor; uniform float uVignette; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  vec2 q = vUv - 0.5; c *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(q) * 1.25);
  gl_FragColor = vec4(c, 1.0);
}`;

function grid(nx, ny, m) {
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3), uv = new Float32Array((nx + 1) * (ny + 1) * 2), idx = new Uint32Array(nx * ny * 6);
  for (let y = 0, k = 0; y <= ny; y++) for (let x = 0; x <= nx; x++, k++) { uv[k * 2] = -m + (1 + 2 * m) * x / nx; uv[k * 2 + 1] = -m + (1 + 2 * m) * y / ny; }
  for (let y = 0, k = 0; y < ny; y++) for (let x = 0; x < nx; x++) { const a = y * (nx + 1) + x, b = a + 1, c = a + nx + 1, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function shrink(src, W, H, f) {
  const w = Math.ceil(W / f), h = Math.ceil(H / f), out = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const xx = x * f + dx, yy = y * f + dy; if (xx < W && yy < H) { s += src[yy * W + xx]; n++; } }
    out[y * w + x] = THREE.DataUtils.toHalfFloat(s / n);
  }
  return { data: out, w, h };
}

function titleCanvas(cfg, colour, above) {
  const lines = String(cfg.title).split(/\\n|\n|\|/).map((s) => s.trim()).filter(Boolean);
  const sub = cfg.subtitle ? String(cfg.subtitle).trim() : "";
  const family = cfg.font || '"Helvetica Neue", "Arial Black", Arial, sans-serif';
  const px = 240, subPx = 62, pad = 30, probe = new OffscreenCanvas(8, 8).getContext("2d");
  const big = `800 ${px}px ${family}`, small = `500 ${subPx}px ${family}`;
  probe.font = big; probe.letterSpacing = "-6px";
  let w = Math.max(...lines.map((l) => probe.measureText(l).width));
  probe.font = small; probe.letterSpacing = "9px";
  if (sub) w = Math.max(w, probe.measureText(sub).width);
  const lineH = px * 0.92, h = lines.length * lineH + (sub ? subPx * 1.9 : 0);
  const cv = new OffscreenCanvas(Math.ceil(w + pad * 2), Math.ceil(h + pad * 2)), c = cv.getContext("2d");
  c.fillStyle = colour; c.textAlign = "center"; c.textBaseline = "alphabetic";
  c.font = big; c.letterSpacing = "-6px";
  const top = pad + (sub && above ? subPx * 1.9 : 0);
  lines.forEach((l, i) => c.fillText(l, cv.width / 2 - 3, top + lineH * (i + 1) - px * 0.14));
  if (sub) { c.font = small; c.letterSpacing = "9px"; c.fillText(sub, cv.width / 2 + 4, above ? pad + subPx * 1.05 : pad + lines.length * lineH + subPx * 1.35); }
  return cv;
}

export async function boot(cfg, canvas) {
  const W = cfg.w, H = cfg.h, a = W / H, final = cfg.quality !== "draft", warnings = [];
  const [bmp, raw] = await Promise.all([
    fetch(cfg.image).then((r) => r.blob()).then((b) => createImageBitmap(b)),
    fetch(cfg.depth).then((r) => r.arrayBuffer()).then((b) => new Float32Array(b)),
  ]);
  if (raw.length !== cfg.dw * cfg.dh) throw new Error("The depth map does not match the picture.");
  const A = bmp.width / bmp.height;
  const subject = findSubject(raw, cfg.dw, cfg.dh);
  const fr = frameFor(A, a, cfg.fit ?? "auto", subject);

  // Working picture: the part of the original in view, plus any area that has to be painted in around it.
  let S = Math.min(bmp.height, (H * 1.35) / fr.Hf);
  S = Math.min(S, Math.sqrt((final ? 4.4e6 : 1.3e6) / (fr.PW * fr.PH)));
  const Tw = Math.round(fr.PW * S), Th = Math.round(fr.PH * S);
  const px = Math.round(fr.ox * S), py = Math.round(fr.oy * S), pw = Math.min(Tw - px, Math.round(A * S)), ph = Math.min(Th - py, Math.round(S));
  const cv = new OffscreenCanvas(Tw, Th), ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high"; ctx.fillStyle = cfg.background || "#ffffff"; ctx.fillRect(0, 0, Tw, Th);
  ctx.drawImage(bmp, px, py, pw, ph);
  const pix = ctx.getImageData(0, 0, Tw, Th).data;
  let rgb = new Float32Array(Tw * Th * 3);
  for (let i = 0; i < Tw * Th; i++) { rgb[i * 3] = pix[i * 4]; rgb[i * 3 + 1] = pix[i * 4 + 1]; rgb[i * 3 + 2] = pix[i * 4 + 2]; }
  const part = normaliseDepth(raw, cfg.dw, cfg.dh, pw, ph);
  if (part.flat) warnings.push("No depth was found in this picture, so the film will look flat.");
  let d = new Float32Array(Tw * Th);
  for (let y = 0; y < ph; y++) d.set(part.d.subarray(y * pw, (y + 1) * pw), (y + py) * Tw + px);
  if (fr.padded) {
    const inside = new Uint8Array(Tw * Th);
    for (let y = py + 1; y < py + ph - 1; y++) inside.fill(1, y * Tw + px + 1, y * Tw + px + pw - 1);
    rgb = fill(rgb, 3, inside, Tw, Th); d = fill(d, 1, inside, Tw, Th);
  }
  const focus = cfg.focus ?? subject?.depth ?? subjectDepth(part.d, pw, ph);
  // Where to cut is decided on a fixed-size copy, so a draft, a still and the final film all get the same layers.
  const s0 = Math.min(1, Math.sqrt(3e5 / (Tw * Th))), aw = Math.max(8, Math.round(Tw * s0)), ah = Math.max(8, Math.round(Th * s0)), small = new Float32Array(aw * ah);
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) small[y * aw + x] = d[Math.min(Th - 1, Math.floor((y + 0.5) * Th / ah)) * Tw + Math.min(Tw - 1, Math.floor((x + 0.5) * Tw / aw))];
  const ar = Math.max(2, Math.round(Math.max(aw, ah) / 500));
  const where = findCuts(small, minmax(small, aw, ah, ar, false), minmax(small, aw, ah, ar, true), aw, ah, { maxCuts: cfg.layers ?? 4 });
  const { layers, cuts } = buildLayers(rgb, d, Tw, Th, { cuts: where });

  // Stage. All sizes are in picture heights.
  const ref = Math.sqrt(fr.Wf * fr.Hf), D = 1.6 * fr.Hf, relief = 0.42 * (cfg.depthAmount ?? 1) * ref;
  const hero = new THREE.Vector2(fr.ox + fr.cx - fr.PW / 2, fr.PH / 2 - (fr.oy + fr.cy));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.autoClear = false;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, a, 0.05 * fr.Hf, 12 * fr.Hf);
  const long = final ? 560 : 300, m = 0.32, nx = Math.round(long * (Tw >= Th ? 1 : Tw / Th) * (1 + 2 * m)), ny = Math.round(long * (Tw >= Th ? Th / Tw : 1) * (1 + 2 * m));
  const geometry = grid(nx, ny, m), f = Math.max(1, Math.ceil(Math.max(Tw, Th) / (long * 1.5)));
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const meshes = layers.map((layer, i) => {
    const map = new THREE.DataTexture(new Uint8Array(layer.rgba.buffer), Tw, Th, THREE.RGBAFormat, THREE.UnsignedByteType);
    map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping; map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true; map.anisotropy = Math.min(8, aniso); map.needsUpdate = true;
    const small = shrink(layer.depth, Tw, Th, f);
    const dep = new THREE.DataTexture(small.data, small.w, small.h, THREE.RedFormat, THREE.HalfFloatType);
    dep.wrapS = dep.wrapT = THREE.MirroredRepeatWrapping; dep.magFilter = dep.minFilter = THREE.LinearFilter; dep.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      vertexShader: LAYER_VERT, fragmentShader: LAYER_FRAG, transparent: i > 0, depthWrite: true, depthTest: true, side: THREE.DoubleSide,
      uniforms: { uMap: { value: map }, uDepth: { value: dep }, uSize: { value: new THREE.Vector2(fr.PW, fr.PH) }, uHero: { value: hero }, uFocus: { value: focus }, uRelief: { value: relief }, uD: { value: D } },
    });
    const mesh = new THREE.Mesh(geometry, mat); mesh.frustumCulled = false; mesh.renderOrder = i * 2; scene.add(mesh);
    return mesh;
  });

  // Title: real type standing inside the scene, behind the subject when there is one.
  let title = null;
  if (cfg.title) {
    const at = typeof cfg.titleAt === "number" ? cfg.titleAt : { top: 0.2, middle: 0.5, bottom: 0.82 }[cfg.titleAt ?? "top"] ?? 0.2;
    const found = layers.findIndex((l, i) => i > 0 && l.cut > focus - 0.02), usable = found < 0 ? layers.length - 1 : found;   // the layer the subject is in
    const behind = (cfg.titleDepth ?? "behind") === "behind" && cuts.length > 0;
    let colour = cfg.titleColor;
    if (!colour) {
      const src = layers[0].rgba, y0 = clamp(Math.round((fr.oy + fr.cy - fr.Hf / 2 + fr.Hf * (at - 0.08)) * S), 0, Th - 1), y1 = clamp(Math.round((fr.oy + fr.cy - fr.Hf / 2 + fr.Hf * (at + 0.08)) * S), 0, Th - 1);
      let lum = 0, n = 0;
      for (let y = y0; y <= y1; y += 4) for (let x = 0; x < Tw; x += 4) { const i = (y * Tw + x) * 4; lum += 0.3 * src[i] + 0.59 * src[i + 1] + 0.11 * src[i + 2]; n++; }
      colour = lum / Math.max(1, n) > 165 ? "#111111" : "#ffffff";
    }
    const tc = titleCanvas(cfg, colour, at <= 0.5), tex = new THREE.CanvasTexture(tc);
    tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = Math.min(8, aniso); tex.minFilter = THREE.LinearMipmapLinearFilter;
    const lines = String(cfg.title).split(/\\n|\n|\|/).filter((s) => s.trim()).length;
    let tw = fr.Wf * (cfg.titleSize ?? 0.74), th = tw * tc.height / tc.width;
    const maxH = fr.Hf * (0.13 * lines + (cfg.subtitle ? 0.04 : 0)); if (th > maxH) { th = maxH; tw = th * tc.width / tc.height; }
    const z = behind ? (layers[usable].cut - focus) * relief - 0.004 * ref : 0, k = (D - z) / D;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: true, depthFunc: behind ? THREE.LessEqualDepth : THREE.AlwaysDepth, depthWrite: true, alphaTest: 0.02, toneMapped: false });
    title = new THREE.Mesh(new THREE.PlaneGeometry(tw * k, th * k), mat);
    title.position.set(hero.x, hero.y + fr.Hf * (0.5 - at) * k, z); title.renderOrder = behind ? usable * 2 - 1 : 99; title.userData = { where: behind ? "behind" : "front", colour };
    scene.add(title);
  }

  // Passes: scene -> focus blur, added up over several moments inside each frame -> screen.
  const sceneRT = new THREE.WebGLRenderTarget(W, H, { depthTexture: new THREE.DepthTexture(W, H, THREE.UnsignedIntType), minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const sumRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad.frustumCulled = false;
  const maxCoc = 13 * H / 1920 * (a > 1 ? 1.6 : 1);
  const blur = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    uniforms: { tColor: { value: sceneRT.texture }, tDepth: { value: sceneRT.depthTexture }, uPx: { value: new THREE.Vector2(1 / W, 1 / H) }, uNear: { value: camera.near }, uFar: { value: camera.far }, uFocus: { value: D }, uAperture: { value: 0 }, uMaxCoc: { value: Math.max(1.5, maxCoc) }, uStep: { value: final ? 1.1 : 2.6 }, uWeight: { value: 1 } },
  });
  const show = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: SHOW_FRAG, depthTest: false, depthWrite: false, uniforms: { tColor: { value: sumRT.texture }, uVignette: { value: 0 } } });

  const duration = cfg.duration ?? 8, amount = cfg.motion ?? 1, pose = compileMove(cfg.move ?? "reveal", amount);
  const target = new THREE.Vector3(hero.x, hero.y, 0), dof = cfg.blur ?? 0.6;
  const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

  function place(t) {
    const p = pose(t / duration), yaw = p.yaw * Math.PI / 180, pitch = p.pitch * Math.PI / 180, dist = D * p.dist;
    camera.position.set(target.x + dist * Math.sin(yaw) * Math.cos(pitch), target.y + dist * Math.sin(pitch), dist * Math.cos(yaw) * Math.cos(pitch));
    camera.up.set(0, 1, 0); camera.lookAt(target);
    camera.fov = 2 * Math.atan(fr.Hf / p.zoom / 2 / dist) * 180 / Math.PI; camera.updateProjectionMatrix();
    return p;
  }
  function drawScene(t, jx = 0, jy = 0) {
    const p = place(t);
    if (jx || jy) camera.setViewOffset(W, H, jx, jy, W, H); else camera.clearViewOffset();
    renderer.setRenderTarget(sceneRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
    return p;
  }
  function frame(t, fps = 30, samples) {
    const n = samples ?? (final ? 8 : 2);
    renderer.setRenderTarget(sumRT); renderer.setClearColor(0x000000, 0); renderer.clear();
    let open = 0;
    for (let s = 0; s < n; s++) {
      const ts = n > 1 ? t + ((s + 0.5) / n - 0.5) * 0.5 / fps : t;
      const p = drawScene(((ts % duration) + duration) % duration, n > 1 ? halton(s + 1, 2) - 0.5 : 0, n > 1 ? halton(s + 1, 3) - 0.5 : 0);
      open += p.open / n;
      blur.uniforms.uFocus.value = D * p.dist; blur.uniforms.uAperture.value = dof * p.open * 34 * H / 1920; blur.uniforms.uWeight.value = 1 / n;
      quad.material = blur; renderer.setRenderTarget(sumRT); renderer.render(quad, flat);
    }
    show.uniforms.uVignette.value = (cfg.vignette ?? 0.22) * open;
    quad.material = show; renderer.setRenderTarget(null); renderer.render(quad, flat);
    return n;
  }

  const read = () => { const buf = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(sceneRT, 0, 0, W, H, buf); return buf; };
  const measure = {
    /** How closely the first frame matches the original picture, in decibels (higher is closer). */
    hero() {
      if (title) title.visible = false; drawScene(0); if (title) title.visible = true;
      const got = read(), refCv = new OffscreenCanvas(W, H), rc = refCv.getContext("2d", { willReadFrequently: true });
      rc.imageSmoothingQuality = "high";
      const sc = H / fr.Hf, left = (fr.Wf / 2 - fr.cx) * sc, top = (fr.Hf / 2 - fr.cy) * sc;
      rc.drawImage(bmp, left, top, A * sc, sc);
      const want = rc.getImageData(0, 0, W, H).data, x0 = Math.max(2, Math.ceil(left) + 2), x1 = Math.min(W - 2, Math.floor(left + A * sc) - 2), y0 = Math.max(2, Math.ceil(top) + 2), y1 = Math.min(H - 2, Math.floor(top + sc) - 2);
      let err = 0, n = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const i = (y * W + x) * 4, j = ((H - 1 - y) * W + x) * 4; for (let c = 0; c < 3; c++) { const e = want[i + c] - got[j + c]; err += e * e; n++; } }
      return n ? 10 * Math.log10(255 * 255 / Math.max(1e-6, err / n)) : 0;
    },
    /** Largest share of any frame that has nothing drawn in it. */
    holes() {
      let worst = 0;
      for (let k = 0; k < 16; k++) { drawScene(duration * k / 16); const b = read(); let empty = 0; for (let i = 3; i < b.length; i += 16) if (b[i] < 128) empty++; worst = Math.max(worst, empty / (b.length / 16)); }
      return worst;
    },
    /** Largest camera swing and how much of the frame moves at the widest point. */
    travel() { let yaw = 0, near = 1; for (let k = 0; k < 200; k++) { const p = pose(k / 200); yaw = Math.max(yaw, Math.abs(p.yaw), Math.abs(p.pitch)); near = Math.min(near, p.dist); } return { swing: yaw, closest: near }; },
  };

  const keys = (Array.isArray(cfg.move) ? cfg.move : MOVES[cfg.move ?? "reveal"].keys).map((k) => +(k[0] * duration).toFixed(3));
  const info = () => ({
    loop: duration, width: W, height: H, move: Array.isArray(cfg.move) ? "custom" : cfg.move ?? "reveal", keys,
    picture: { width: bmp.width, height: bmp.height }, layers: layers.length, cuts: cuts.map((c) => +c.toFixed(3)), focus: +focus.toFixed(3),
    subject: subject ? { x: +(subject.cx / A).toFixed(3), y: +subject.cy.toFixed(3), width: +(subject.w / A).toFixed(3), height: +subject.h.toFixed(3) } : null,
    framing: { fit: fr.padded ? "extended" : "cropped", shown: { width: +Math.min(1, fr.Wf / A).toFixed(3), height: +Math.min(1, fr.Hf).toFixed(3) }, paintedIn: +(1 - Math.min(1, A / fr.PW) * Math.min(1, 1 / fr.PH)).toFixed(3) },
    title: title ? title.userData : null, working: { width: Tw, height: Th }, warnings,
  });
  return { frame, info, measure, timeline: { beats: keys.map((t) => ({ t, role: "key" })) } };
}
