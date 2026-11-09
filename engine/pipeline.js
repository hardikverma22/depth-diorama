// The illustration renderer: geometry buffers plus a sun mask, combined into ink, two-tone shading and weather.
import * as THREE from "three";

THREE.ColorManagement.enabled = false;   // everything is authored and composited in display colours, like paint

export const shared = { windows: { value: 0 } };

const FLAT_VERT = /* glsl */ `
  out vec2 vUv; out vec3 vN;
  uniform vec2 uRepeat;
  void main() {
    vec4 p = vec4(position, 1.0); vec3 n = normal;
    #ifdef USE_INSTANCING
      p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
    #endif
    vN = mat3(modelMatrix) * n; vUv = uv * uRepeat;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * p;
  }`;
const FLAT_FRAG = /* glsl */ `
  precision highp float;
  in vec2 vUv; in vec3 vN;
  layout(location = 0) out vec4 oAlbedo;
  layout(location = 1) out vec4 oNormal;
  uniform vec3 uColor; uniform sampler2D uMap, uLit;
  uniform float uHasMap, uHasLit, uGlow, uWindows;
  void main() {
    vec3 c = uColor; float g = uGlow;
    if (uHasMap > 0.5) c *= texture(uMap, vUv).rgb;
    if (uHasLit > 0.5) { vec4 t = texture(uLit, vUv); float m = t.a * uWindows; c = mix(c, t.rgb, m); g = max(g, m); }
    vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
    oAlbedo = vec4(c, g); oNormal = vec4(N * 0.5 + 0.5, 1.0);
  }`;

/** The single surface material. It stores flat paint and normals; shading happens once, later. */
export function surface({ color = "#ffffff", map = null, lit = null, glow = 0, repeat = [1, 1] } = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: FLAT_VERT, fragmentShader: FLAT_FRAG, side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uMap: { value: map }, uLit: { value: lit }, uRepeat: { value: new THREE.Vector2(...repeat) },
      uHasMap: { value: map ? 1 : 0 }, uHasLit: { value: lit ? 1 : 0 }, uGlow: { value: glow }, uWindows: shared.windows,
    },
  });
}

const QUAD_VERT = /* glsl */ `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  in vec2 vUv; out vec4 o;
  uniform sampler2D tA, tN, tD, tL, tR;
  uniform mat4 invVP; uniform vec3 camPos, sunDir; uniform vec2 res; uniform float near, far, pixelAngle, unit, phase;
  uniform vec3 uShade, uInk, uHaze, uTint; uniform float uHatch, uHazeAmount, uBloom, uWet, uSat, uContrast, uVignette, uHasReflect;
  uniform vec3 sZenith, sMid, sHorizon, sCloud, sCloudShade; uniform float sClouds, sStars;
  uniform vec2 stageCenter; uniform float stageRadius, poolCount;
  uniform vec4 poolPos[16]; uniform vec3 poolColor[16];

  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 29341.77); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.07 + 11.3; a *= 0.5; } return v; }
  float linearZ(float d) { return near * far / (far - d * (far - near)); }

  vec3 skyColor(vec3 dir) {
    float e = dir.y;
    vec3 c = mix(sHorizon, sMid, smoothstep(-0.02, 0.16, e)); c = mix(c, sZenith, smoothstep(0.16, 0.7, e));
    vec2 q = dir.xz / (max(e, 0.0) + 0.14);
    float n = fbm(q * 1.35 + vec2(4.2, 1.7));
    float band = smoothstep(0.015, 0.09, e) * (1.0 - smoothstep(0.55, 0.9, e));
    float edge = 0.62 - sClouds * 0.24;
    float cloud = smoothstep(edge, edge + 0.012, n) * band;
    vec3 cc = mix(sCloudShade, sCloud, smoothstep(edge + 0.075, edge + 0.087, n));
    c = mix(c, cc, cloud * 0.92);
    if (sStars > 0.0) { vec2 g = floor(dir.xz / (e + 0.25) * 170.0); c += step(0.9972, hash(g)) * smoothstep(0.2, 0.5, e) * (1.0 - cloud) * sStars; }
    return c;
  }

  float colorEdge;
  float inkAt(vec2 uv, float r, float foot) {
    vec2 px = r / res; float dc = texture(tD, uv).r; bool skyC = dc >= 0.999999; float zc = linearZ(dc);
    vec3 nc = texture(tN, uv).xyz * 2.0 - 1.0; vec4 ac = texture(tA, uv);
    float e = 0.0; colorEdge = 0.0;
    float scale = zc * zc * (far - near) / (near * far);
    float t0 = 0.045 + foot * 1.6;
    for (int k = 0; k < 4; k++) {
      float a = float(k) * 0.785398; vec2 off = vec2(cos(a), sin(a)) * px;
      float d1 = texture(tD, uv + off).r, d2 = texture(tD, uv - off).r;
      bool s1 = d1 >= 0.999999, s2 = d2 >= 0.999999;
      if (skyC != s1 || skyC != s2) { e = 1.0; continue; }
      if (skyC) continue;
      e = max(e, smoothstep(t0, t0 * 1.7, abs(d1 + d2 - 2.0 * dc) * scale));
      vec3 n1 = texture(tN, uv + off).xyz * 2.0 - 1.0, n2 = texture(tN, uv - off).xyz * 2.0 - 1.0;
      e = max(e, smoothstep(0.3, 0.55, 1.0 - min(dot(nc, n1), dot(nc, n2))));
      vec4 a1 = texture(tA, uv + off), a2 = texture(tA, uv - off);
      colorEdge = max(colorEdge, smoothstep(0.16, 0.26, max(length(a1.rgb - ac.rgb), length(a2.rgb - ac.rgb))));
    }
    return e;
  }

  void main() {
    float d = texture(tD, vUv).r; bool isSky = d >= 0.999999;
    vec4 clip = invVP * vec4(vUv * 2.0 - 1.0, isSky ? 1.0 : d * 2.0 - 1.0, 1.0); clip /= clip.w;
    vec3 P = clip.xyz; vec3 view = normalize(P - camPos);
    float zl = isSky ? far : linearZ(d), foot = zl * pixelAngle;
    vec3 c; float glow = 0.0;
    vec3 N = texture(tN, vUv).xyz * 2.0 - 1.0;
    if (isSky) c = skyColor(view);
    else {
      vec4 alb = texture(tA, vUv); c = alb.rgb; glow = alb.a;
      float lit = texture(tL, vUv).r, ndl = dot(N, sunDir);
      if (glow < 0.5) {
        bool inShade = lit < 0.17;
        c *= inShade ? uShade : uTint;
        if (inShade && ndl > 0.14) {                                     // a cast shadow, as opposed to a surface turned from the sun
          vec3 an = abs(N); vec2 q = an.y > 0.7 ? P.xz : (an.x > an.z ? P.zy : P.xy);
          float hv = (q.x + q.y) * 7.5, fw = fwidth(hv);
          float stripe = 1.0 - smoothstep(0.0, fw * 1.5 + 0.06, abs(fract(hv) - 0.5) - 0.3);
          c = mix(c, c * uHatch, stripe * (1.0 - smoothstep(0.14, 0.26, fw)));
        }
        vec3 pools = vec3(0.0);
        for (int i = 0; i < int(poolCount); i++) {
          float k = 1.0 - clamp(length(P - poolPos[i].xyz) / poolPos[i].w, 0.0, 1.0);
          pools += poolColor[i] * smoothstep(0.0, 0.08, k) * (0.45 + 0.55 * smoothstep(0.34, 0.42, k));
        }
        c += alb.rgb * pools;
      }
      // wet ground mirrors the street; planar reflection needs no ray march and cannot miss off-screen signs
      if (uHasReflect > 0.5 && N.y > 0.9 && P.y < 0.12 && glow < 0.5) {
        float puddle = smoothstep(0.38, 0.58, fbm(P.xz * 0.34 + 3.1));
        float wet = uWet * (0.42 + 0.58 * puddle), fres = 0.25 + 0.75 * pow(1.0 - max(dot(-view, vec3(0, 1, 0)), 0.0), 3.0);
        vec2 ripple = vec2(noise(P.xz * 7.0) - 0.5, noise(P.xz * 7.0 + 9.0) - 0.5) * 0.004 * puddle * (1.0 - smoothstep(0.01, 0.05, foot));
        vec4 r = texture(tR, vUv + ripple);
        vec3 refl = r.a < -0.5 ? skyColor(reflect(view, vec3(0, 1, 0))) * 0.8 : r.rgb;
        c = mix(c * (1.0 - 0.35 * wet), refl, clamp(wet * fres, 0.0, 0.72));
      }
      float away = smoothstep(stageRadius * 0.8, stageRadius * 2.6, length(P.xz - stageCenter));
      if (glow < 0.5) c = mix(c, uHaze, away * uHazeAmount);
    }
    float widthPx = mix(1.25, 0.95, smoothstep(5.0, 40.0, zl)) * unit;
    float e = inkAt(vUv, widthPx, foot);
    float fineFade = 1.0 - smoothstep(0.02, 0.055, foot);
    float colorInk = colorEdge * fineFade * (isSky ? 0.0 : (N.y > 0.7 ? 0.45 : 0.9)) * (1.0 - glow);
    float ink = max(smoothstep(0.34, 0.62, e), smoothstep(0.34, 0.62, colorInk) * (N.y > 0.7 ? 0.5 : 1.0));
    bool poster = abs(glow - 0.6) < 0.02;                            // poster paint: no ink, so slices join without a seam
    c = mix(c, uInk, ink * (poster ? 0.0 : (glow > 0.5 ? 0.35 : 0.94)));
    if (uBloom > 0.0) {
      vec3 sum = vec3(0.0);
      for (int k = 0; k < 18; k++) { float a = float(k) * 2.39996, r = (4.0 + float(k) * 2.6) * unit;
        vec4 g = texture(tA, vUv + vec2(cos(a), sin(a)) * r / res); sum += g.rgb * (abs(g.a - 0.6) < 0.02 ? 0.0 : g.a) * (1.0 - float(k) / 22.0); }
      c += sum * 0.03 * uBloom;
    }
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = max(mix(vec3(lum), c, uSat), 0.0);
    c = mix(c, c * c * (3.0 - 2.0 * c), (uContrast - 1.0) * 3.0);
    vec2 v = (vUv - 0.5) * vec2(1.5, 1.2); c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(v));
    o = vec4(clamp(c, 0.0, 1.0), 1.0);
  }`;

const quadScene = (material) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); m.frustumCulled = false; const s = new THREE.Scene(); s.add(m); return s; };
const quadMat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: QUAD_VERT, fragmentShader: `precision highp float; in vec2 vUv; out vec4 o; ${frag}`, uniforms, depthTest: false, depthWrite: false, ...extra });

export class Pipeline {
  constructor(renderer, { width, height, supersample = 1.5, look, shadowSize = 8192 }) {
    this.R = renderer; this.look = look; this.width = width; this.height = height;
    const iw = this.iw = Math.round(width * supersample), ih = this.ih = Math.round(height * supersample);
    const gl = renderer.getContext();
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("This GPU cannot render to float textures (EXT_color_buffer_float is missing).");
    const float = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.gbuffer = new THREE.WebGLRenderTarget(iw, ih, { count: 2, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.gbuffer.depthTexture = new THREE.DepthTexture(iw, ih, THREE.FloatType);
    this.mask = new THREE.WebGLRenderTarget(iw, ih, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.frame = new THREE.WebGLRenderTarget(iw, ih, float);
    this.accum = new THREE.WebGLRenderTarget(iw, ih, float);
    this.useReflect = look.wet > 0;
    if (this.useReflect) { this.reflect = new THREE.WebGLRenderTarget(Math.round(iw / 2), Math.round(ih / 2), { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }); }
    this.maskMat = new THREE.MeshLambertMaterial({ color: "#ffffff", side: THREE.DoubleSide });
    shared.windows.value = look.windows;
    this.shadowSize = Math.min(shadowSize, renderer.capabilities.maxTextureSize);

    const v3 = (a) => ({ value: new THREE.Vector3(...a) });
    this.u = {
      tA: { value: this.gbuffer.textures[0] }, tN: { value: this.gbuffer.textures[1] }, tD: { value: this.gbuffer.depthTexture }, tL: { value: this.mask.texture }, tR: { value: this.reflect?.texture ?? null },
      invVP: { value: new THREE.Matrix4() }, camPos: { value: new THREE.Vector3() }, sunDir: { value: new THREE.Vector3() }, res: { value: new THREE.Vector2(iw, ih) },
      near: { value: 1 }, far: { value: 100 }, pixelAngle: { value: 0.001 }, phase: { value: 0 }, unit: { value: Math.min(iw, ih) / 1080 },
      uShade: v3(look.shade), uInk: v3(look.ink), uHaze: v3(look.haze), uTint: v3(look.tint), uHatch: { value: look.hatch }, uHazeAmount: { value: look.hazeAmount }, uBloom: { value: look.bloom }, uWet: { value: look.wet },
      uSat: { value: look.saturation }, uContrast: { value: look.contrast }, uVignette: { value: look.vignette }, uHasReflect: { value: this.useReflect ? 1 : 0 },
      sZenith: v3(look.sky.zenith), sMid: v3(look.sky.mid), sHorizon: v3(look.sky.horizon), sCloud: v3(look.sky.cloud), sCloudShade: v3(look.sky.cloudShade), sClouds: { value: look.sky.clouds }, sStars: { value: look.sky.stars },
      stageCenter: { value: new THREE.Vector2() }, stageRadius: { value: 50 }, poolCount: { value: 0 },
      poolPos: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, poolColor: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
    };
    this.compositeScene = quadScene(new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG, uniforms: this.u, depthTest: false, depthWrite: false }));
    this.addScene = quadScene(quadMat("uniform sampler2D t; uniform float w; void main() { o = vec4(texture(t, vUv).rgb * w, 1.0); }", { t: { value: this.frame.texture }, w: { value: 1 } }, { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation }));
    this.addMat = this.addScene.children[0].material;
    this.resolveScene = quadScene(quadMat(`uniform sampler2D t; uniform vec2 px; void main() {
      vec3 c = texture(t, vUv + px * vec2(-0.25, -0.75)).rgb + texture(t, vUv + px * vec2(0.75, -0.25)).rgb + texture(t, vUv + px * vec2(0.25, 0.75)).rgb + texture(t, vUv + px * vec2(-0.75, 0.25)).rgb;
      o = vec4(c * 0.25, 1.0); }`, { t: { value: this.accum.texture }, px: { value: new THREE.Vector2(1 / iw, 1 / ih) } }));
    this.resolveMat = this.resolveScene.children[0].material;
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fx = null;
    this.probeRT = null;
  }

  setStage(center, radius, pools) {
    this.u.stageCenter.value.set(center.x, center.z); this.u.stageRadius.value = radius;
    const list = pools.slice(0, 16);
    this.u.poolCount.value = list.length;
    list.forEach((p, i) => { this.u.poolPos.value[i].set(p.x, p.y, p.z, p.radius); this.u.poolColor.value[i].set(...p.rgb); });
  }

  setRain(sceneBounds) {
    if (!this.look.rain) return;
    const count = 2600, geo = new THREE.InstancedBufferGeometry(), quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index; geo.setAttribute("position", quad.attributes.position);
    const seeds = new Float32Array(count * 4); let s = 12345;
    const rnd = () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < count; i++) { seeds[i * 4] = sceneBounds.xmin - 6 + rnd() * (sceneBounds.xmax - sceneBounds.xmin + 12); seeds[i * 4 + 1] = rnd(); seeds[i * 4 + 2] = sceneBounds.zmin + rnd() * (sceneBounds.zmax - sceneBounds.zmin + 8); seeds[i * 4 + 3] = rnd(); }
    geo.setAttribute("seed", new THREE.InstancedBufferAttribute(seeds, 4));
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { phase: this.u.phase, tD: this.u.tD, res: this.u.res, near: this.u.near, far: this.u.far, pixelAngle: this.u.pixelAngle, volume: { value: Math.max(30, sceneBounds.top + 6) } },
      vertexShader: `in vec4 seed; uniform float phase, volume, pixelAngle; out float vAlpha; out float vDepth;
        void main() { float cycles = 3.0 + floor(seed.w * 3.0);
          float y = mod(seed.y - phase * cycles, 1.0) * volume; vec3 root = vec3(seed.x, y, seed.z);
          vec3 toCam = cameraPosition - root; float dist = length(toCam); vec3 side = normalize(cross(vec3(0, 1, 0), toCam));
          float foot = dist * pixelAngle, width = max(0.018, foot * 0.9);
          vec3 p = root + side * position.x * width + vec3(0, 1, 0) * (position.y + 0.5) * 0.85;
          vAlpha = 0.3 * clamp(0.018 / width, 0.08, 1.0); vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0); vDepth = clip.z / clip.w * 0.5 + 0.5; gl_Position = clip; }`,
      fragmentShader: `precision highp float; in float vAlpha; in float vDepth; out vec4 o; uniform sampler2D tD; uniform vec2 res;
        void main() { if (texture(tD, gl_FragCoord.xy / res).r < vDepth) discard; o = vec4(vec3(0.72, 0.8, 1.0) * vAlpha, 1.0); }`,
    });
    const mesh = new THREE.Mesh(geo, material); mesh.frustumCulled = false;
    this.fx = new THREE.Scene(); this.fx.add(mesh);
  }

  renderReflection(scene, camera, grounds) {
    const mirror = new THREE.Matrix4().makeScale(1, -1, 1);
    const w0 = camera.matrixWorld.clone(), i0 = camera.matrixWorldInverse.clone();
    camera.matrixWorldAutoUpdate = false;
    camera.matrixWorld.premultiply(mirror); camera.matrixWorldInverse.multiply(mirror);
    grounds.forEach((g) => { g.visible = false; });
    this.R.setRenderTarget(this.reflect); this.R.setClearColor(0x000000, -1); this.R.clear(); this.R.render(scene, camera);
    grounds.forEach((g) => { g.visible = true; });
    camera.matrixWorld.copy(w0); camera.matrixWorldInverse.copy(i0); camera.matrixWorldAutoUpdate = true;
  }

  /** Draws one illustrated image into this.frame. */
  draw({ scene, camera, sun, grounds, shadowsDirty, phase }) {
    const { R, u } = this;
    R.shadowMap.autoUpdate = false;
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    R.setRenderTarget(this.gbuffer); R.setClearColor(0x000000, 0); R.clear(); R.render(scene, camera);
    if (this.useReflect) this.renderReflection(scene, camera, grounds);
    R.shadowMap.needsUpdate = shadowsDirty;
    scene.overrideMaterial = this.maskMat;
    R.setRenderTarget(this.mask); R.setClearColor(0x000000, 1); R.clear(); R.render(scene, camera);
    scene.overrideMaterial = null;
    u.invVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    u.camPos.value.copy(camera.position);
    u.sunDir.value.copy(sun.position).sub(sun.target.position).normalize();
    u.near.value = camera.near; u.far.value = camera.far;
    u.pixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) / this.iw;
    u.phase.value = phase;
    R.setRenderTarget(this.frame); R.render(this.compositeScene, this.ortho);
    if (this.fx) { const a = R.autoClear; R.autoClear = false; R.render(this.fx, camera); R.autoClear = a; }
  }

  beginAccumulate() { const { R } = this; R.setRenderTarget(this.accum); R.setClearColor(0x000000, 1); R.clear(); }
  addSample(weight) { const { R } = this, a = R.autoClear; this.addMat.uniforms.w.value = weight; R.autoClear = false; R.setRenderTarget(this.accum); R.render(this.addScene, this.ortho); R.autoClear = a; }
  present() { const { R } = this; R.setRenderTarget(null); R.setClearColor(0, 1); R.render(this.resolveScene, this.ortho); }

  /** Reads the current frame as a small greyscale image, for automated checks. */
  grey(w, h) {
    const { R } = this;
    if (!this.greyRT) { this.greyRT = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }); this.greyScene = quadScene(quadMat("uniform sampler2D t; void main() { o = vec4(texture(t, vUv).rgb, 1.0); }", { t: { value: this.frame.texture } })); }
    R.setRenderTarget(this.greyRT); R.render(this.greyScene, this.ortho);
    const buf = new Uint8Array(w * h * 4); R.readRenderTargetPixels(this.greyRT, 0, 0, w, h, buf);
    const out = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) out[i] = (buf[i * 4] * 54 + buf[i * 4 + 1] * 183 + buf[i * 4 + 2] * 19) >> 8;
    R.setRenderTarget(null);
    return out;
  }

  /** Reads linear depth (metres) per pixel; sky is reported as Infinity-like negative value. */
  depthGrid(w, h) {
    const { R, u } = this;
    if (!this.depthRT) {
      this.depthRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.depthScene = quadScene(quadMat("uniform sampler2D t; uniform float near, far; void main() { float d = texture(t, vUv).r; o = vec4(d >= 0.999999 ? -1.0 : near * far / (far - d * (far - near)), 0.0, 0.0, 1.0); }", { t: u.tD, near: u.near, far: u.far }));
    }
    R.setRenderTarget(this.depthRT); R.render(this.depthScene, this.ortho);
    const buf = new Float32Array(w * h * 4); R.readRenderTargetPixels(this.depthRT, 0, 0, w, h, buf);
    const out = new Float32Array(w * h); for (let i = 0; i < w * h; i++) out[i] = buf[i * 4];
    R.setRenderTarget(null);
    return out;
  }
}
