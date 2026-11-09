// The scene-building vocabulary. All sizes are metres, +y is up, the long axis runs towards -z.
// A position [x, y, z] means the object's base sits at y, except ball() which is centred.
import { surface } from "./pipeline.js";
import { seeded, fract, lerp, tileLayout } from "./math.js";

const FONT = '"Helvetica Neue", Helvetica, Arial, "Hiragino Sans", sans-serif';
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export function createKit({ THREE, scene, look }) {
  let parent = scene;
  const rnd = seeded(11), cache = new Map(), swaps = [], ticks = [], dynamic = [], pools = [], warnings = [];

  const canvasTexture = (w, h, fn, wrapIt = true) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    fn(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 16; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    if (wrapIt) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const mat = (m, glow = 0) => {
    if (m && m.isMaterial) return m;
    const key = `${m}|${glow}`;
    if (!cache.has(key)) cache.set(key, surface({ color: m, glow }));
    return cache.get(key);
  };
  const place = (mesh, [x, y, z], ry = 0, rz = 0, rx = 0) => {
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const mesh = (geo, m) => new THREE.Mesh(geo, m);

  const kit = {
    THREE, look, rnd,
    isNight: look.windows > 0.5,

    // ---- primitives ----
    box: (w, h, d, m, [x, y, z], { ry = 0, rz = 0, rx = 0, glow = 0 } = {}) => place(mesh(new THREE.BoxGeometry(w, h, d), mat(m, glow)), [x, y + h / 2, z], ry, rz, rx),
    cyl: (r, h, m, [x, y, z], { top = r, seg = 18, glow = 0 } = {}) => place(mesh(new THREE.CylinderGeometry(top, r, h, seg), mat(m, glow)), [x, y + h / 2, z]),
    cone: (r, h, m, [x, y, z], { seg = 24 } = {}) => place(mesh(new THREE.ConeGeometry(r, h, seg), mat(m)), [x, y + h / 2, z]),
    ball: (r, m, [x, y, z], { glow = 0, seg = 18 } = {}) => place(mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 6)), mat(m, glow)), [x, y, z]),
    dome: (r, m, [x, y, z], { seg = 36 } = {}) => place(mesh(new THREE.SphereGeometry(r, seg, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(m)), [x, y, z]),
    bar(a, b, r, m, { seg = 8, glow = 0 } = {}) {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
      const o = mesh(new THREE.CylinderGeometry(r, r, len, seg), mat(m, glow));
      o.position.copy(A).add(B).multiplyScalar(0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      o.castShadow = o.receiveShadow = true; parent.add(o); return o;
    },
    /** A gabled roof with its ridge along z. */
    roof(w, rise, d, m, [x, y, z], { overhang = 0.18, ry = 0 } = {}) {
      const s = new THREE.Shape(); const hw = w / 2 + overhang;
      s.moveTo(-hw, -0.08); s.lineTo(0, rise); s.lineTo(hw, -0.08); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: d + overhang * 2, bevelEnabled: false }); g.translate(0, 0, -(d + overhang * 2) / 2);
      return place(mesh(g, mat(m)), [x, y, z], ry);
    },
    group(fn, [x, y, z], ry = 0) {
      const g = new THREE.Group(), prev = parent; parent = g; fn(g); parent = prev;
      g.position.set(x, y, z); g.rotation.y = ry; parent.add(g); return g;
    },

    // ---- paint ----
    /** A material painted on a canvas. Detail painted on one surface cannot flicker at long range. */
    paint(w, h, fn, { repeat = [1, 1], lit = null, poster = false } = {}) {
      return surface({ map: canvasTexture(w, h, fn), repeat, lit: lit ? canvasTexture(w, h, lit) : null, glow: poster ? 0.6 : 0 });
    },
    /** A sign whose text always fits. */
    sign(text, w, h, { bg = "#D8452E", fg = "#FFF7E6", font = FONT, weight = 800, glow = 0, border = null, vertical = false } = {}) {
      const px = 90, cw = Math.max(8, Math.round(w * px)), ch = Math.max(8, Math.round(h * px));
      const paintIt = (g) => {
        g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
        if (border) { g.strokeStyle = border; g.lineWidth = Math.min(cw, ch) * 0.06; g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, cw - g.lineWidth, ch - g.lineWidth); }
        g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
        if (vertical) {
          const chars = [...text], size = Math.min(cw * 0.72, (ch * 0.92) / chars.length);
          g.font = `${weight} ${size}px ${font}`; chars.forEach((c, i) => g.fillText(c, cw / 2, (ch - size * chars.length) / 2 + size * (i + 0.5)));
        } else {
          let size = ch * 0.68; g.font = `${weight} ${size}px ${font}`;
          const wide = g.measureText(text).width; if (wide > cw * 0.9) size *= (cw * 0.9) / wide;
          g.font = `${weight} ${size}px ${font}`; g.fillText(text, cw / 2, ch / 2 + size * 0.04);
        }
      };
      return surface({ map: canvasTexture(cw, ch, paintIt, false), glow });
    },
    board(text, w, h, [x, y, z], opts = {}) { return kit.box(w, h, opts.thick ?? 0.12, kit.sign(text, w, h, opts), [x, y, z], { ry: opts.ry ?? 0 }); },

    // ---- ground and light ----
    ground(w, d, m, [x, y, z] = [0, 0, 0]) {
      const o = mesh(new THREE.PlaneGeometry(w, d), mat(m)); o.rotation.x = -Math.PI / 2; o.position.set(x, y, z);
      o.receiveShadow = true; o.frustumCulled = false; o.userData.role = "ground"; parent.add(o); return o;
    },
    /** A cel-shaded pool of coloured light. Only 16 can exist; extra ones are ignored with a warning. */
    pool([x, y, z], radius, color, strength = 1) {
      if (pools.length >= 16) { warnings.push("more than 16 light pools: extras are ignored"); return; }
      pools.push({ x, y, z, radius, rgb: hexRgb(color).map((v) => v * strength) });
    },

    // ---- illusion layouts ----
    /** Items that sit edge to edge in the flat view and spread out in depth when it opens. */
    tile(count, opts, fn) { return tileLayout(count, opts).map((item) => fn(item)); },
    along([z0, z1], step, fn) { const out = []; let i = 0; for (let z = z0; step > 0 ? z >= z1 : false; z -= step) out.push(fn(z, i++)); return out; },
    /** Moves an object between two floor positions, only ever while the view is flat. */
    swap(object, { row, alt }) {
      if (!object || !object.position) throw new Error("kit.swap needs an object made with kit.group or a primitive.");
      if (!Array.isArray(row) || !Array.isArray(alt) || row.length !== 2 || alt.length !== 2) throw new Error("kit.swap needs row: [x, z] and alt: [x, z].");
      swaps.push({ object, row, alt, apply(v) { object.position.x = lerp(row[0], alt[0], v); object.position.z = lerp(row[1], alt[1], v); } });
      return object;
    },
    /** Runs fn(phase) every frame. phase goes 0..1 over the loop, so anything built on it loops by construction. */
    animate(object, fn) { object.userData.dynamic = true; dynamic.push(object); ticks.push((phase) => fn(phase)); return object; },

    // ---- props ----
    lamp([x, z], { h = 5, side = 1, color = "#2F4858", bulb = "#FFF0B8" } = {}) {
      kit.cyl(0.11, h, color, [x, 0, z], { top: 0.07 });
      kit.box(1.05, 0.07, 0.07, color, [x - side * 0.5, h - 0.2, z]);
      kit.ball(0.25, bulb, [x - side * 0.95, h - 0.46, z], { glow: kit.isNight ? 1 : 0 });
      kit.cyl(0.2, 0.42, color, [x, 0, z], { top: 0.13 });
    },
    bench([x, z], { ry = 0, wood = "#8A5A36", iron = "#2F4858" } = {}) {
      return kit.group(() => { kit.box(1.8, 0.09, 0.5, wood, [0, 0.46, 0]); kit.box(1.8, 0.48, 0.08, wood, [0, 0.58, -0.24]); for (const s of [-0.75, 0.75]) kit.box(0.09, 0.46, 0.46, iron, [s, 0, 0]); }, [x, 0, z], ry);
    },
    rail(x, [z0, z1], { color = "#F3EEDF", h = 1.1, spacing = 2.5 } = {}) {
      const len = Math.abs(z0 - z1), mid = (z0 + z1) / 2;
      for (const y of [h * 0.55, h]) kit.box(0.09, 0.09, len, color, [x, y, mid]);
      for (let z = Math.max(z0, z1); z > Math.min(z0, z1); z -= spacing) kit.box(0.11, h, 0.11, color, [x, 0, z]);
    },
    bin([x, z], c = "#3D6B4F") { kit.cyl(0.32, 0.92, c, [x, 0, z], { top: 0.36 }); kit.cyl(0.39, 0.09, "#2B2F36", [x, 0.92, z]); },
    bollard([x, z], c = "#E7B93E") { kit.cyl(0.11, 0.85, c, [x, 0, z]); kit.ball(0.12, c, [x, 0.87, z]); },
    tree([x, z], { h = 5, leaf = "#3F8F5A", trunk = "#6A4A32" } = {}) { kit.cyl(0.18, h * 0.5, trunk, [x, 0, z], { top: 0.12 }); kit.ball(h * 0.27, leaf, [x, h * 0.66, z]); kit.ball(h * 0.2, leaf, [x + h * 0.14, h * 0.5, z + 0.2]); kit.ball(h * 0.19, leaf, [x - h * 0.15, h * 0.55, z - 0.2]); },
    planter([x, z], { c = "#B56A44", leaf = "#4C9A5F" } = {}) { kit.box(1.4, 0.55, 0.6, c, [x, 0, z]); for (const s of [-0.42, 0, 0.42]) kit.ball(0.33, leaf, [x + s, 0.74, z]); },
    crate([x, y, z], { s = 0.6, c = "#C19A62" } = {}) {
      const m = kit.paint(128, 128, (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(60,35,10,.65)"; g.lineWidth = 7; g.strokeRect(3, 3, w - 6, h - 6); g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.stroke(); });
      return kit.box(s, s, s, m, [x, y, z]);
    },
    vending([x, z], { c = "#C8332C", ry = 0 } = {}) {
      const face = kit.paint(256, 512, (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = "#EAF2FA"; g.fillRect(24, 44, w - 48, h * 0.55); const cols = ["#E4572E", "#17BEBB", "#FFC914", "#76B041", "#6C5CE7"]; for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) { g.fillStyle = cols[(i * 3 + j * 2) % 5]; g.fillRect(34 + i * 33, 60 + j * 66, 22, 50); } g.fillStyle = "#23262E"; g.fillRect(50, h - 120, w - 100, 60); }, { lit: (g, w, h) => { g.fillStyle = "rgba(0,0,0,0)"; g.clearRect(0, 0, w, h); g.fillStyle = "#F7FBFF"; g.fillRect(24, 44, w - 48, h * 0.55); } });
      return kit.box(1, 1.9, 0.75, face, [x, 0, z], { ry });
    },
    awning(w, d, [x, y, z], { a = "#D8452E", b = "#FFF7E6", ry = 0 } = {}) {
      const m = kit.paint(256, 64, (g, cw, ch) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * cw) / 8, 0, cw / 8 + 1, ch); } });
      return kit.group(() => kit.box(w, 0.06, d, m, [0, 0, d * 0.5 * Math.cos(0.3)], { rx: 0.3 }), [x, y, z], ry);
    },
    /** A building as one painted surface, with optional lit windows after dark. */
    building(w, h, d, [x, z], { wall = "#83849A", trim = "#EDE7D8", glass = "#2A3650", storey = 3.3, bay = 2.4, lit = "#E7B25C", shop = null, ry = 0 } = {}) {
      const px = 22, cw = Math.max(32, Math.round(w * px)), ch = Math.max(32, Math.round(h * px));
      const floors = Math.max(1, Math.floor(h / storey)), bays = Math.max(1, Math.floor(w / bay)), seed = Math.floor(rnd() * 99999);
      const each = (fn) => { const r = seeded(seed); for (let j = 0; j < floors; j++) for (let i = 0; i < bays; i++) { const bw = cw / bays, bh = ch / floors; fn(i * bw + bw * 0.22, j * bh + bh * 0.2, bw * 0.56, bh * 0.56, r(), j); } };
      const m = kit.paint(cw, ch, (g) => {
        g.fillStyle = wall; g.fillRect(0, 0, cw, ch);
        each((x0, y0, ww, wh) => { g.fillStyle = trim; g.fillRect(x0 - 3, y0 - 3, ww + 6, wh + 8); g.fillStyle = glass; g.fillRect(x0, y0, ww, wh); g.fillStyle = trim; g.fillRect(x0 + ww / 2 - 1, y0, 2, wh); });
        g.fillStyle = trim; for (let j = 1; j < floors; j++) g.fillRect(0, (j * ch) / floors - 1, cw, 3);
        if (shop) { g.fillStyle = shop; g.fillRect(0, ch - ch / floors, cw, ch / floors); g.fillStyle = "#23304A"; g.fillRect(cw * 0.1, ch - ch / floors * 0.72, cw * 0.8, ch / floors * 0.6); }
      }, { lit: (g) => {
        g.clearRect(0, 0, cw, ch);
        each((x0, y0, ww, wh, r) => { if (r < 0.42) { g.fillStyle = lit; g.fillRect(x0, y0, ww, wh); } });
        if (shop) { g.fillStyle = "#B97F46"; g.fillRect(cw * 0.1, ch - ch / floors * 0.72, cw * 0.8, ch / floors * 0.6); }
      } });
      const roofTrim = trim;
      return kit.group(() => { kit.box(w, h, d, m, [0, 0, 0]); kit.box(w + 0.3, 0.3, d + 0.3, roofTrim, [0, h, 0]); kit.box(1.4, 1.1, 1.4, "#8E8FA0", [w * 0.25, h + 0.3, -d * 0.2]); }, [x, 0, z], ry);
    },
    /** String of lights between two points that sags a little. */
    garland(a, b, n, colors = ["#FFD36B", "#FF7A59", "#6FE3D2"], { sag = 0.5, r = 0.09, wire = "#3A3A4A" } = {}) {
      let prev = a;
      for (let i = 1; i <= n; i++) {
        const u = i / n, p = [lerp(a[0], b[0], u), lerp(a[1], b[1], u) - sag * 4 * u * (1 - u), lerp(a[2], b[2], u)];
        kit.bar(prev, p, 0.012, wire, { seg: 4 }); if (i < n) kit.ball(r, colors[i % colors.length], p, { glow: 1, seg: 10 }); prev = p;
      }
    },
    person(opts = {}) {
      const { at = [0, 0], face = 0, walk = null, h = 1.7, shirt, pants, skin, hair, umbrella = null } = opts;
      const shirts = ["#D8452E", "#3A6EA5", "#E9C46A", "#6A994E", "#F4F1DE", "#7B5EA7", "#264653", "#E76F51"], bottoms = ["#2B2D42", "#4A4E69", "#6B705C", "#22333B", "#8D99AE"], skins = ["#F2C9A5", "#D9A77F", "#A9734E", "#7E5236"], hairs = ["#1E1B18", "#4A2F1D", "#8A5A2B", "#BDBDBD"];
      const c = { shirt: shirt ?? rnd.pick(shirts), pants: pants ?? rnd.pick(bottoms), skin: skin ?? rnd.pick(skins), hair: hair ?? rnd.pick(hairs) };
      const s = h / 1.7; const limbs = [];
      const limb = (x, y, len, r, color) => { const g = new THREE.Group(); g.position.set(x, y, 0); parent.add(g); const m = mesh(new THREE.CapsuleGeometry(r, len - 2 * r, 4, 8), mat(color)); m.position.y = -len / 2; m.castShadow = m.receiveShadow = true; g.add(m); return g; };
      const g = kit.group(() => {
        kit.cyl(0.17 * s, 0.56 * s, c.shirt, [0, 0.86 * s, 0], { top: 0.2 * s, seg: 12 });
        kit.cyl(0.075 * s, 0.1 * s, c.skin, [0, 1.42 * s, 0], { seg: 8 });
        kit.ball(0.13 * s, c.skin, [0, 1.58 * s, 0], { seg: 14 });
        kit.dome(0.138 * s, c.hair, [0, 1.6 * s, -0.012 * s], { seg: 14 });
        limbs.push(limb(-0.09 * s, 0.88 * s, 0.86 * s, 0.075 * s, c.pants), limb(0.09 * s, 0.88 * s, 0.86 * s, 0.075 * s, c.pants));
        limbs.push(limb(-0.24 * s, 1.38 * s, 0.62 * s, 0.055 * s, c.shirt), limb(0.24 * s, 1.38 * s, 0.62 * s, 0.055 * s, c.shirt));
        if (umbrella) { kit.bar([0.12 * s, 1.3 * s, 0], [0.12 * s, 2.15 * s, 0], 0.012, "#222"); kit.cone(0.62, 0.3, umbrella, [0.12 * s, 2.05 * s, 0], { seg: 10 }); }
      }, [at[0], 0, at[1]], face);
      if (walk) {
        const steps = walk.steps ?? 8, seedPhase = rnd();
        const dir = Math.atan2(walk.to[0] - at[0], walk.to[1] - at[1]); g.rotation.y = dir;
        kit.animate(g, (phase, wrapped) => {
          const u = wrapped; g.position.x = lerp(at[0], walk.to[0], u); g.position.z = lerp(at[1], walk.to[1], u);
          const a = Math.sin(2 * Math.PI * (steps * phase + Math.round(seedPhase * 4) / 4));
          limbs[0].rotation.x = a * 0.5; limbs[1].rotation.x = -a * 0.5; limbs[2].rotation.x = -a * 0.4; limbs[3].rotation.x = a * 0.4;
          g.position.y = Math.abs(Math.cos(2 * Math.PI * (steps * phase + Math.round(seedPhase * 4) / 4))) * 0.025;
        });
      } else { limbs[2].rotation.z = -0.05; limbs[3].rotation.z = 0.05; }
      return g;
    },
    /** People crossing between two x limits, spread over a z range. */
    crowd(n, { x = [-8, 8], z = [0, 8], umbrellas = 0, steps = 8 } = {}) {
      for (let i = 0; i < n; i++) {
        const lane = lerp(z[0], z[1], rnd()), dir = rnd() < 0.5, x0 = dir ? x[0] : x[1], x1 = dir ? x[1] : x[0], off = rnd() * 0.5;
        const from = lerp(x0, x1, off * 0.6), to = lerp(x0, x1, 0.45 + off);
        kit.person({ at: [from, lane], walk: { to: [to, lane + rnd.range(-1, 1)], steps }, h: rnd.range(1.55, 1.85), umbrella: rnd() < umbrellas ? rnd.pick(["#23262E", "#3A6EA5", "#D8452E", "#EDEDED"]) : null });
      }
    },
    /** A slow big wheel. Its 8 identical cars make a quarter turn repeat exactly. */
    wheel([x, y, z], radius, { color = "#F3EEDF", cars = ["#D8452E", "#17BEBB"] } = {}) {
      const spin = kit.group(() => {
        for (const dz of [-0.45, 0.45]) { const rim = mesh(new THREE.TorusGeometry(radius, 0.1, 8, 64), mat(color)); rim.position.z = dz; rim.castShadow = true; parent.add(rim); }
        for (let i = 0; i < 16; i++) { const a = (i * Math.PI) / 8; for (const dz of [-0.45, 0.45]) kit.bar([0, 0, dz], [Math.cos(a) * radius, Math.sin(a) * radius, dz], 0.045, color); }
      }, [x, y, z]);
      const gondolas = [];
      for (let i = 0; i < 8; i++) gondolas.push(kit.group(() => { kit.box(1.4, 1.1, 1.1, cars[i % 2], [0, -1.15, 0]); kit.cyl(0.78, 0.14, "#F3EEDF", [0, -0.1, 0], { seg: 14 }); kit.bar([0, 0, 0], [0, -0.1, 0], 0.03, color); }, [x, y, z]));
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) kit.bar([x + dx * radius * 0.62, 0, z + dz], [x, y, z + dz * 0.55], 0.16, color).userData.ignoreBounds = true;
      for (const g of [spin, ...gondolas]) g.traverse((o) => { o.userData.ignoreBounds = true; });
      kit.animate(spin, (phase) => {
        const a = phase * (Math.PI / 2); spin.rotation.z = a;
        gondolas.forEach((g, i) => { const b = a + (i * Math.PI) / 4; g.position.set(x + Math.cos(b) * radius, y + Math.sin(b) * radius, z); });
      });
      gondolas.forEach((g) => { g.userData.dynamic = true; dynamic.push(g); });
      return spin;
    },
    /** Birds circling; each completes a whole number of laps per loop. */
    birds(n, [x, y, z], spread = 10) {
      for (let i = 0; i < n; i++) {
        const r = spread * rnd.range(0.4, 1), start = rnd() * Math.PI * 2, laps = rnd() < 0.5 ? 1 : -1, wing = [];
        const g = kit.group(() => { for (const s of [-1, 1]) { const w = new THREE.Group(); parent.add(w); const m = mesh(new THREE.BoxGeometry(0.5, 0.025, 0.2), mat("#FBFBF6")); m.position.x = s * 0.25; w.add(m); wing.push(w); } kit.ball(0.09, "#FBFBF6", [0, 0, 0], { seg: 8 }); }, [x, y, z]);
        g.traverse((o) => { o.userData.ignoreBounds = true; });
        kit.animate(g, (phase) => { const a = start + laps * 2 * Math.PI * phase; g.position.set(x + Math.cos(a) * r, y + Math.sin(3 * a) * 0.5, z + Math.sin(a) * r * 0.5); g.rotation.y = -a; const f = Math.sin(2 * Math.PI * 12 * phase + i) * 0.5; wing[0].rotation.z = -f; wing[1].rotation.z = f; });
      }
    },

    // ---- internal ----
    _swaps: () => swaps,
    _dynamic: () => dynamic,
    _ticks: () => ticks,
    _pools: () => pools,
    _warnings: () => [...new Set(warnings)],
    _runTicks(phase, wrapPhase) { const wrapped = fract(phase - wrapPhase); for (const t of ticks) t(phase, wrapped); },
  };
  return kit;
}
