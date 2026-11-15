// The scene-building vocabulary. All sizes are metres, +y is up, the long axis runs towards -z.
// A position [x, y, z] means the object's base sits at y, except ball() which is centred.
import { surface } from "./pipeline.js";
import { seeded, fract, lerp, clamp, curve, tileLayout } from "./math.js";

const FONT = '"Helvetica Neue", Helvetica, Arial, "Hiragino Sans", sans-serif';
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export function createKit({ THREE, scene, look, aspect = 16 / 9, frame = null }) {
  let parent = scene;
  const rnd = seeded(11), cache = new Map(), swaps = [], ticks = [], dynamic = [], pools = [], warnings = [], pending = [];
  let usesPoster = false;
  const people = []; let crowdParts = null; const particles = [];
  // One instanced mesh per body part for everyone in the scene: the part's shape, where it hangs, and which colour it takes.
  const PARTS = [
    { geo: () => new THREE.CylinderGeometry(0.2, 0.17, 0.56, 12).translate(0, 0.28, 0), at: [0, 0.86, 0], color: (p) => p.c.shirt },
    { geo: () => new THREE.CylinderGeometry(0.075, 0.075, 0.1, 8).translate(0, 0.05, 0), at: [0, 1.42, 0], color: (p) => p.c.skin },
    { geo: () => new THREE.SphereGeometry(0.13, 14, 10), at: [0, 1.58, 0], color: (p) => p.c.skin },
    { geo: () => new THREE.SphereGeometry(0.138, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), at: [0, 1.6, -0.012], color: (p) => p.c.hair },
    { geo: () => new THREE.CapsuleGeometry(0.075, 0.71, 4, 8).translate(0, -0.43, 0), at: [-0.09, 0.88, 0], limb: 0, color: (p) => p.c.pants },
    { geo: () => new THREE.CapsuleGeometry(0.075, 0.71, 4, 8).translate(0, -0.43, 0), at: [0.09, 0.88, 0], limb: 1, color: (p) => p.c.pants },
    { geo: () => new THREE.CapsuleGeometry(0.055, 0.51, 4, 8).translate(0, -0.31, 0), at: [-0.24, 1.38, 0], limb: 2, out: -1, color: (p) => p.c.shirt },
    { geo: () => new THREE.CapsuleGeometry(0.055, 0.51, 4, 8).translate(0, -0.31, 0), at: [0.24, 1.38, 0], limb: 3, out: 1, color: (p) => p.c.shirt },
    { geo: () => new THREE.CylinderGeometry(0.012, 0.012, 0.85, 4).translate(0, 0.425, 0), at: [0.12, 1.3, 0], only: (p) => p.umbrella, color: () => "#222222" },
    { geo: () => new THREE.ConeGeometry(0.62, 0.3, 10).translate(0, 0.15, 0), at: [0.12, 2.05, 0], only: (p) => p.umbrella, color: (p) => p.umbrella, unscaled: true },
    { geo: () => new THREE.CylinderGeometry(0.22, 0.27, 0.95, 12).translate(0, -0.475, 0), at: [0, 1.4, 0], only: (p) => p.style === "coat", color: (p) => p.c.coat },
    { geo: () => new THREE.CylinderGeometry(0.19, 0.3, 0.42, 12).translate(0, -0.21, 0), at: [0, 0.98, 0], only: (p) => p.style === "skirt", color: (p) => p.c.skirt },
    { geo: () => new THREE.CapsuleGeometry(0.11, 0.32, 4, 8).translate(0, -0.2, 0), at: [0, 1.66, -0.08], only: (p) => p.longHair, color: (p) => p.c.hair },
    { geo: () => new THREE.CylinderGeometry(0.15, 0.15, 0.07, 12).translate(0, 0.035, 0), at: [0, 1.69, 0], only: (p) => p.cap, color: (p) => p.c.cap },
    { geo: () => new THREE.BoxGeometry(0.3, 0.4, 0.16).translate(0, -0.2, 0), at: [0, 1.36, -0.22], only: (p) => p.bag === "backpack", color: (p) => p.c.bag },
    { geo: () => new THREE.BoxGeometry(0.08, 0.32, 0.3).translate(0, -0.16, 0), at: [0.3, 0.86, 0], only: (p) => p.bag === "tote" && !p.umbrella, color: (p) => p.c.bag },
  ];
  const tmpM = new THREE.Matrix4(), tmpL = new THREE.Matrix4(), tmpR = new THREE.Matrix4(), tmpS = new THREE.Matrix4();
  function updatePeople() {
    if (!crowdParts) return;
    for (const { part, mesh: im, who } of crowdParts) {
      who.forEach((p, i) => {
        p.handle.updateWorldMatrix(true, false);
        const s = p.s, sc = part.unscaled ? 1 : s;
        tmpL.makeTranslation(part.at[0] * s, part.at[1] * s, part.at[2] * s);
        if (part.limb !== undefined) { tmpR.makeRotationX(p.swing[part.limb]); tmpL.multiply(tmpR); if (part.out) { tmpR.makeRotationZ(part.out * p.armOut); tmpL.multiply(tmpR); } }
        tmpS.makeScale(sc, sc, sc); tmpL.multiply(tmpS);
        tmpM.multiplyMatrices(p.handle.matrixWorld, tmpL);
        if (!p.handle.visible) tmpM.makeScale(0, 0, 0);
        im.setMatrixAt(i, tmpM);
      });
      im.instanceMatrix.needsUpdate = true;
    }
  }
  /** After build: create the crowd's instanced meshes. */
  function finishPeople() {
    if (!people.length || crowdParts) return;
    crowdParts = [];
    for (const part of PARTS) {
      const who = part.only ? people.filter(part.only) : people;
      if (!who.length) continue;
      const im = new THREE.InstancedMesh(part.geo(), surface({ color: "#ffffff" }), who.length);
      const col = new THREE.Color();
      who.forEach((p, i) => im.setColorAt(i, col.set(part.color(p))));
      im.instanceColor.needsUpdate = true;
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
      im.userData.dynamic = true; im.userData.ignoreBounds = true;
      scene.add(im); dynamic.push(im);
      crowdParts.push({ part, mesh: im, who });
    }
    updatePeople();
  }

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
    THREE, look, rnd, aspect, frame,
    isNight: look.windows > 0.5,

    // ---- primitives ----
    /** A box. With `sides`, the picture or colour `m` goes on the front face only (+z before turning) and `sides` on the other five. */
    box(w, h, d, m, [x, y, z], { ry = 0, rz = 0, rx = 0, glow = 0, sides = null } = {}) {
      if (sides == null) return place(mesh(new THREE.BoxGeometry(w, h, d), mat(m, glow)), [x, y + h / 2, z], ry, rz, rx);
      const g = new THREE.BoxGeometry(w, h, d), face = g.groups.find((q) => q.materialIndex === 4), idx = Array.from(g.index.array);
      const front = g.clone(); front.setIndex(idx.slice(face.start, face.start + face.count)); front.clearGroups();
      const rest = g.clone(); rest.setIndex([...idx.slice(0, face.start), ...idx.slice(face.start + face.count)]); rest.clearGroups();
      const holder = new THREE.Group(); holder.position.set(x, y + h / 2, z); holder.rotation.set(rx, ry, rz); parent.add(holder);
      for (const [geo, mm] of [[rest, mat(sides)], [front, mat(m, glow)]]) { const o = mesh(geo, mm); o.castShadow = o.receiveShadow = true; holder.add(o); }
      return holder;
    },
    cyl: (r, h, m, [x, y, z], { top = r, seg = 18, glow = 0, ry = 0 } = {}) => place(mesh(new THREE.CylinderGeometry(top, r, h, seg), mat(m, glow)), [x, y + h / 2, z], ry),
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
      if (poster) usesPoster = true;
      return surface({ map: canvasTexture(w, h, fn), repeat, lit: lit ? canvasTexture(w, h, lit) : null, glow: poster ? 0.6 : 0 });
    },
    /**
     * Any flat picture, written as SVG markup, as a material for any surface: posters, screens, labels, characters, logos, maps.
     * The picture keeps the shape of its viewBox. `screen: true` makes it self-lit with no ink (screens, light boxes); `lit: true` makes it glow after dark;
     * `poster: true` is a self-lit picture that is the poster itself, so the checks expect it to fill the flat frame.
     */
    svg(markup, { px = 1024, repeat = [1, 1], lit = false, poster = false, screen = false } = {}) {
      if (typeof markup !== "string" || !/<svg[\s>]/i.test(markup)) throw new Error("kit.svg: give SVG markup as a string, starting with <svg ...>.");
      if (/(href|src)\s*=\s*["'](?!#|data:)/i.test(markup)) throw new Error("kit.svg: the SVG links to an outside file. Scenes are self-contained: draw it, or embed it as a data: URL.");
      let svgText = markup.includes("xmlns=") ? markup : markup.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svgText);
      const ratio = vb ? +vb[2] / +vb[1] : 1, cw = Math.round(px), ch = Math.max(8, Math.round(px * ratio));
      if (!/\swidth\s*=/.test(svgText.slice(0, svgText.indexOf(">")))) svgText = svgText.replace(/<svg/i, `<svg width="${cw}" height="${ch}"`);
      const draw = (g) => { g.clearRect(0, 0, cw, ch); };
      const map = canvasTexture(cw, ch, draw), glowMap = lit ? canvasTexture(cw, ch, draw) : null;
      const sized = (text) => { let t = text.includes("xmlns=") ? text : text.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"'); if (!/\swidth\s*=/.test(t.slice(0, t.indexOf(">")))) t = t.replace(/<svg/i, `<svg width="${cw}" height="${ch}"`); return t; };
      const paintInto = (text, targets) => { const img = new Image(); pending.push(new Promise((resolve, reject) => {
        img.onload = () => { for (const t of targets) { const g = t.image.getContext("2d"); g.clearRect(0, 0, cw, ch); g.drawImage(img, 0, 0, cw, ch); t.needsUpdate = true; } resolve(); };
        img.onerror = () => reject(new Error("kit.svg: the SVG could not be drawn. Check that the markup is valid XML (close every tag, escape & as &amp;)."));
      })); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text); };
      if (typeof lit === "string") { if (!/<svg[\s>]/i.test(lit)) throw new Error("kit.svg: `lit` is either true or a second SVG picture of what glows after dark."); paintInto(svgText, [map]); paintInto(sized(lit), [glowMap]); }
      else paintInto(svgText, glowMap ? [map, glowMap] : [map]);
      if (poster) usesPoster = true;
      return surface({ map, repeat, lit: glowMap, glow: poster || screen ? 0.6 : 0 });
    },
    /**
     * A picture file (PNG, JPEG or WebP) from the scene's own folder, as a material: painted illustrations, product shots, logos the user supplied.
     * `screen`, `lit` and `poster` work as in svg(); `lit` may also name a second file of what glows after dark.
     */
    image(file, { repeat = [1, 1], lit = false, poster = false, screen = false } = {}) {
      if (typeof file !== "string" || !/\.(png|jpe?g|webp)$/i.test(file)) throw new Error("kit.image: give the name of a .png, .jpg or .webp file in the scene's folder, e.g. k.image(\"art/poster.png\").");
      if (/^[a-z]+:|^\/|\.\.(\/|\\)/i.test(file)) throw new Error(`kit.image: "${file}" must be a path inside the scene's folder. Scenes load nothing from the network.`);
      const load = (name, needsAlpha) => {
        const t = new THREE.Texture(); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 16; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping;
        const img = new Image(), src = globalThis.__DR_ASSETS__?.[name] ?? `/scene/${name.split("/").map(encodeURIComponent).join("/")}`;
        pending.push(new Promise((resolve, reject) => {
          img.onload = () => { t.image = img; t.needsUpdate = true; resolve(); };
          img.onerror = () => reject(new Error(`kit.image: could not load "${name}". Put the file in the scene's folder (next to scene.js) and check the name.`));
        }));
        img.src = src; return t;
      };
      const map = load(file), glowMap = lit ? load(typeof lit === "string" ? lit : file) : null;
      if (poster) usesPoster = true;
      return surface({ map, repeat, lit: glowMap, glow: poster || screen ? 0.6 : 0 });
    },
    /** A material of your own (not shared), for animating its colour or glow: `m.uniforms.uColor.value.set("#f00")`, `m.uniforms.uGlow.value = 1`. */
    mat(color = "#ffffff", { glow = 0 } = {}) { return surface({ color, glow }); },
    /** Runs fn(phase, wrapped, view) every frame, for changes that are not to an object (a material's colour or glow, a picture scrolling). */
    tick(fn) { if (typeof fn !== "function") throw new Error("kit.tick needs a function."); ticks.push(fn); },
    /** Scrolls a picture across its surface: `u` and `v` are whole turns per loop (tickers, conveyor belts, flowing water). */
    scroll(material, { u = 1, v = 0 } = {}) {
      if (!material?.uniforms?.uOffset) throw new Error("kit.scroll needs a material from k.svg, k.image, k.paint, k.sign or k.mat.");
      if (!Number.isInteger(u) || !Number.isInteger(v)) throw new Error("kit.scroll: u and v must be whole numbers of turns per loop, so the loop closes.");
      ticks.push((phase) => material.uniforms.uOffset.value.set((phase * u) % 1, (phase * v) % 1));
      return material;
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

    /** A solid cut-out from a THREE.Shape, standing on its base edge. */
    extrude(shape, depth, m, [x, y, z], { ry = 0, rz = 0, bevel = 0 } = {}) {
      const g = new THREE.ExtrudeGeometry(shape, bevel > 0 ? { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 24 } : { depth, bevelEnabled: false }); g.translate(0, 0, -depth / 2);
      return place(mesh(g, mat(m)), [x, y, z], ry, rz);
    },
    /**
     * One painting cut across many buildings at different depths, each piece pre-distorted so they join when flat.
     * Needs flatWidth to be a function of aspect, so the painting can be composed for each frame shape.
     * paint(g, { W, H, say }) draws in metres with y up, from (-W/2, 0) to (W/2, H).
     */
    mural({ paint, scale = 44, bleed = 6, columns = [3.4, 5.6], centre = -35, bands = [[18, -12], [-50, -20], [-100, -58]], tops, walls = ["#23262F", "#2E2A36", "#1E2A36"], lits = ["#FFC873"], trim = "#6B6F7E" }) {
      if (!frame) throw new Error("k.mural needs flatWidth to be a function of aspect, e.g. flatWidth: (a) => (a < 1 ? 30 : 64).");
      if (typeof paint !== "function") throw new Error("k.mural needs a paint function.");
      const W = frame.width, H = frame.height, cy = H / 2, camZ = centre + frame.distance;
      const xmin = -W / 2 - bleed, ymax = H + bleed, c = document.createElement("canvas");
      c.width = Math.round((W + 2 * bleed) * scale); c.height = Math.round((H + 2 * bleed) * scale);
      const g = c.getContext("2d");
      g.setTransform(scale, 0, 0, -scale, -xmin * scale, ymax * scale);
      const say = (text, x, y, size, { color = "#fff", font = '"Helvetica Neue", Helvetica, Arial, sans-serif', weight = 900, italic = false, align = "center" } = {}) => {
        g.save(); g.translate(x, y); g.scale(1, -1); g.font = `${italic ? "italic " : ""}${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = "alphabetic"; g.fillText(text, 0, 0); g.restore();
      };
      paint(g, { W, H, say });
      const cell = (xa, xb, top, z, depth) => {
        const f = (camZ - z) / (camZ - centre), mid = (xa + xb) / 2, w = (xb - xa) * f + 0.05, h = cy + (top - cy) * f, x = mid * f;
        const sx = (mid - w / f / 2 - xmin) * scale, sy = (ymax - top) * scale, sw = (w / f) * scale, sh = (top - (cy - cy / f)) * scale;
        const cw = Math.max(16, Math.round(sw)), ch = Math.max(16, Math.round(sh));
        kit.box(w, h, 0.3, kit.paint(cw, ch, (p) => p.drawImage(c, sx, sy, sw, sh, 0, 0, cw, ch), { poster: true }), [x, 0, z - 0.15]);
        kit.building(w - 0.42, Math.max(1.6, h - 1.9), depth, [x, z - 0.3 - depth / 2], { wall: rnd.pick(walls), trim, storey: 3.1, bay: 2.1, lit: rnd.pick(lits) });
      };
      const half = W / 2 + 1.5, edges = [-half];
      for (let e = -half; e < half;) { e = Math.min(half, e + rnd.range(columns[0], columns[1])); edges.push(e); }
      for (let i = 0; i + 1 < edges.length; i++) {
        const a = edges[i], b = edges[i + 1], m = (a + b) / 2;
        const list = (tops ?? ((mx) => { const u = Math.abs(mx) / half, low = H * (0.1 + 0.26 * u) + rnd.range(0, H * 0.04), mid_ = Math.max(low + H * 0.2, H * (0.42 + 0.1 * u) + rnd.range(0, H * 0.06)); return [low, mid_, H + 2.4]; }))(m, i, H);
        list.forEach((top, j) => { const band = bands[Math.min(j, bands.length - 1)]; cell(a, b, top, rnd.range(Math.min(...band), Math.max(...band)), rnd.range(4, 8)); });
      }
    },

    // ---- sculpted solids ----
    /** Any THREE geometry with a kit colour or material. Its origin sits at the position given. */
    mesh(geometry, m, [x, y, z] = [0, 0, 0], { ry = 0, rz = 0, rx = 0, glow = 0 } = {}) { return place(mesh(geometry, mat(m, glow)), [x, y, z], ry, rz, rx); },
    /**
     * A smooth skin stretched over cross-sections, for bodies no box can make: a shoe, a car, a bottle, a hull.
     * sections: [{ at, w, h, y, c, round }] sorted along the axis. w and h are the section's width and height,
     * y its underside, c a sideways shift. round is 2 for an ellipse, higher for boxier; [top, bottom] sets each half.
     */
    loft(sections, m, { axis = "x", seg = 32, smooth = 6, glow = 0, at = [0, 0, 0] } = {}) {
      if (!Array.isArray(sections) || sections.length < 2) throw new Error("kit.loft needs at least two sections: [{ at, w, h, y, c, round }, ...].");
      if (!["x", "y", "z"].includes(axis)) throw new Error('kit.loft: axis must be "x", "y" or "z".');
      const S = sections.map((s) => { const r = s.round ?? 2; return { at: s.at, w: s.w, h: s.h ?? s.w, y: s.y ?? 0, c: s.c ?? 0, rt: Array.isArray(r) ? r[0] : r, rb: Array.isArray(r) ? r[1] : r }; }).sort((a, b) => a.at - b.at);
      for (const s of S) if (![s.at, s.w, s.h, s.y, s.c, s.rt, s.rb].every(Number.isFinite)) throw new Error("kit.loft: every section needs numbers for at and w.");
      const ts = S.map((s) => s.at), f = {}; for (const key of ["w", "h", "y", "c", "rt", "rb"]) f[key] = curve(ts, S.map((s) => s[key]));
      const n = (S.length - 1) * smooth + 1, ring = seg + 1, pos = [], uv = [], idx = [];
      const put = (a, u, v) => (axis === "x" ? [a, v, u] : axis === "z" ? [u, v, a] : [u, a, v]);
      const pw = (v, e) => Math.sign(v) * Math.abs(v) ** e;
      for (let i = 0; i < n; i++) {
        const span = Math.min(S.length - 2, Math.floor(i / smooth)), t = lerp(ts[span], ts[span + 1], (i - span * smooth) / smooth);
        const w = Math.max(1e-3, f.w(t)), h = Math.max(1e-3, f.h(t)), base = axis === "y" ? 0 : f.y(t) + h / 2, c = f.c(t);
        for (let j = 0; j <= seg; j++) {
          const th = (j / seg) * Math.PI * 2, cx = Math.cos(th), sy = Math.sin(th), e = 2 / Math.max(0.5, sy >= 0 ? f.rt(t) : f.rb(t)), ex = 2 / Math.max(0.5, (f.rt(t) + f.rb(t)) / 2);
          pos.push(...put(t, c + pw(cx, ex) * w / 2, base + pw(sy, e) * h / 2)); uv.push(i / (n - 1), j / seg);
        }
      }
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = i * ring + j, b = a + 1, c = a + ring, d = c + 1; idx.push(a, c, b, b, c, d); }
      for (const [i, flip] of [[0, false], [n - 1, true]]) {
        const t = ts[i ? ts.length - 1 : 0], h = Math.max(1e-3, f.h(t)), centre = pos.length / 3;
        pos.push(...put(t, f.c(t), axis === "y" ? 0 : f.y(t) + h / 2)); uv.push(i ? 1 : 0, 0.5);
        for (let j = 0; j < seg; j++) { const a = i * ring + j, b = a + 1; if (flip) idx.push(centre, b, a); else idx.push(centre, a, b); }
      }
      const build = () => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; };
      let g = build();
      { const k0 = Math.floor(n / 2) * ring + Math.round(seg / 4), k1 = Math.floor(n / 2) * ring + Math.round((3 * seg) / 4), N = g.attributes.normal, P = g.attributes.position;   // skin must face outwards
        const out = (N.getX(k0) * (P.getX(k0) - P.getX(k1)) + N.getY(k0) * (P.getY(k0) - P.getY(k1)) + N.getZ(k0) * (P.getZ(k0) - P.getZ(k1)));
        if (out < 0) { for (let i = 0; i < idx.length; i += 3) { const s = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = s; } g = build(); } }
      { const N = g.attributes.normal; for (let i = 0; i < n; i++) { const a = i * ring, b = a + seg, x = N.getX(a) + N.getX(b), y = N.getY(a) + N.getY(b), z = N.getZ(a) + N.getZ(b), l = Math.hypot(x, y, z) || 1; N.setXYZ(a, x / l, y / l, z / l); N.setXYZ(b, x / l, y / l, z / l); } }
      return place(mesh(g, mat(m, glow)), at);
    },
    /** A turned solid from a side profile of [radius, height] points: bottles, cups, vases, lamps, wheels. */
    lathe(profile, m, [x, y, z] = [0, 0, 0], { seg = 48, smooth = 8, glow = 0 } = {}) {
      if (!Array.isArray(profile) || profile.length < 2) throw new Error("kit.lathe needs a profile of [radius, height] points.");
      const raw = profile.map(([r, h]) => new THREE.Vector2(Math.max(0, r), h));
      const pts = smooth > 0 && raw.length > 2 ? new THREE.SplineCurve(raw).getPoints(raw.length * smooth).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y)) : raw;
      return place(mesh(new THREE.LatheGeometry(pts, seg), mat(m, glow)), [x, y, z]);
    },
    /** A round cord through points: laces, cables, pipes, handles, stripes. */
    tube(points, r, m, { seg = 10, glow = 0, closed = false } = {}) {
      if (!Array.isArray(points) || points.length < 2) throw new Error("kit.tube needs at least two [x, y, z] points.");
      const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
      const o = mesh(new THREE.TubeGeometry(c, Math.max(12, points.length * 12), r, seg, closed), mat(m, glow));
      o.castShadow = o.receiveShadow = true; parent.add(o); return o;
    },

    // ---- motion ----
    /** 0 before a, 1 after b, a soft start and stop between. a and b are fractions of the loop. */
    ease(p, a, b) { const u = clamp((p - a) / (b - a), 0, 1); return u * u * u * (u * (6 * u - 15) + 10); },
    /** Rises over [a, b], holds, falls over [c, d]. The way anything appears, acts and leaves inside a loop. */
    during(p, [a, b, c, d]) { return kit.ease(p, a, b) * (1 - kit.ease(p, c, d)); },
    /** Moves, turns and grows an object for part of the loop, then puts it back. */
    move(object, { by = [0, 0, 0], turn = 0, scale = 1, during = [0.3, 0.42, 0.62, 0.74] } = {}) {
      const p0 = object.position.clone(), r0 = object.rotation.y, s0 = object.scale.clone();
      return kit.animate(object, (phase) => { const v = kit.during(phase, during); object.position.set(p0.x + by[0] * v, p0.y + by[1] * v, p0.z + by[2] * v); object.rotation.y = r0 + turn * v; object.scale.copy(s0).multiplyScalar(lerp(1, scale, v)); });
    },
    /** A gentle hover: whole cycles per loop, so it always returns. */
    float(object, { height = 0.12, cycles = 2, tilt = 0 } = {}) {
      const y0 = object.position.y, z0 = object.rotation.z;
      return kit.animate(object, (phase) => { const a = Math.sin(2 * Math.PI * cycles * phase); object.position.y = y0 + a * height; object.rotation.z = z0 + a * tilt; });
    },
    /** A caption on a leader line that grows out of a point, always turned to face the camera, then folds away. */
    label(text, from, to, { during = [0.34, 0.44, 0.6, 0.7], h = 0.5, w, bg = "#F7F5EF", fg = "#101014", line = bg, glow = 0.7, weight = 800 } = {}) {
      const width = w ?? Math.max(h * 1.8, [...text].length * h * 0.48);
      const screen = to.length === 2, side = screen && to[0] < 0 ? -1 : 1, up = new THREE.Vector3(0, 1, 0);   // [right, up] keeps the caption beside the point from any angle
      const A = new THREE.Vector3(...from), B = screen ? A.clone().add(new THREE.Vector3(to[0], to[1], 0)) : new THREE.Vector3(...to), len = Math.max(1e-3, A.distanceTo(B));
      const lead = new THREE.Group(); lead.position.copy(A); lead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); parent.add(lead);
      const rod = mesh(new THREE.CylinderGeometry(h * 0.035, h * 0.035, len, 6), mat(line, glow)); rod.position.y = len / 2; lead.add(rod);
      const dot = mesh(new THREE.SphereGeometry(h * 0.11, 12, 8), mat(line, glow)); lead.add(dot);
      const card = kit.group(() => kit.box(width, h, h * 0.08, kit.sign(text, width, h, { bg, fg, glow, weight }), [screen ? side * width / 2 : 0, -h / 2, 0]), [B.x, B.y, B.z]);
      for (const o of [lead, card]) { o.userData.dynamic = true; dynamic.push(o); o.traverse((q) => { q.userData.ignoreBounds = true; q.castShadow = false; }); }
      kit.animate(card, (phase, _wrapped, view) => {
        const v = kit.during(phase, during), grow = clamp(v * 2, 0, 1), open = clamp(v * 2 - 1, 0, 1);
        lead.visible = card.visible = v > 0.002; lead.scale.set(1, Math.max(grow, 1e-3), 1); dot.scale.set(1, 1 / Math.max(grow, 1e-3), 1);
        const o = ((view?.orbit ?? 0) * Math.PI) / 180;
        if (screen) { card.position.set(A.x + Math.cos(o) * to[0], A.y + to[1], A.z - Math.sin(o) * to[0]); lead.quaternion.setFromUnitVectors(up, card.position.clone().sub(A).normalize()); }
        card.scale.set(Math.max(open, 1e-3), 1, 1); card.rotation.y = o;
      });
      return card;
    },

    // ---- ground and light ----
    ground(w, d, m, [x, y, z] = [0, 0, 0]) {
      const o = mesh(new THREE.PlaneGeometry(w, d), mat(m)); o.rotation.x = -Math.PI / 2; o.position.set(x, y, z);
      o.receiveShadow = true; o.frustumCulled = false; o.userData.role = "ground"; parent.add(o); return o;
    },
    /** A cel-shaded pool of coloured light. Pools and lights share a budget of 32; extra ones are ignored with a warning. */
    /** A point light: lights every surface within radius, softly, brighter on faces turned towards it. Shares the 32-light budget with pools. */
    light([x, y, z], radius, color = "#FFD08A", strength = 1) {
      if (!(radius > 0)) throw new Error("kit.light needs a radius in metres.");
      if (pools.length >= 32) { warnings.push("more than 32 lights and pools: extras are ignored"); return; }
      pools.push({ x, y, z, radius: -radius, rgb: hexRgb(color).map((v) => v * strength) });
    },
    /**
     * Small things drifting through the air, drawn after the inked picture so they never get outlines: snow, embers, petals, dust, bubbles, confetti, sparks.
     * fall: whole cycles top to bottom per loop (negative rises, 0 floats). sway: whole side-to-side cycles per loop.
     */
    particles({ count = 2000, area = null, height = null, size = 0.06, color = "#FFFFFF", fall = 2, sway = 1, drift = 0.3, opacity = 0.9, glow = false } = {}) {
      if (!Number.isInteger(fall) || !Number.isInteger(sway)) throw new Error("kit.particles: fall and sway must be whole numbers of cycles per loop, so the loop closes.");
      if (!(count > 0 && count <= 40000)) throw new Error("kit.particles: count must be between 1 and 40000.");
      if (area && !(Array.isArray(area) && area.length === 4)) throw new Error("kit.particles: area is [xmin, xmax, zmin, zmax] in metres.");
      if (height && !(Array.isArray(height) && height.length === 2)) throw new Error("kit.particles: height is [bottom, top] in metres.");
      particles.push({ count, area, height, size, rgb: hexRgb(color), fall, sway, drift, opacity, glow, seed: 1 + particles.length * 7919 });
    },
    pool([x, y, z], radius, color, strength = 1) {
      if (pools.length >= 32) { warnings.push("more than 32 light pools: extras are ignored"); return; }
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
    /** Runs fn(phase, wrapped, view) every frame. Pass every object fn changes (one, or a list): anything not passed is merged into still geometry and frozen. */
    animate(object, fn) {
      const list = Array.isArray(object) ? object : [object];
      if (!list.length || list.some((o) => !o || !o.isObject3D)) throw new Error("kit.animate needs an object, or a list of objects, that the animation changes.");
      for (const o of list) { o.userData.dynamic = true; if (!dynamic.includes(o)) dynamic.push(o); }
      ticks.push(fn); return object;
    },

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
    /**
     * A person. Returns an invisible handle you can place, move, swap and animate like any object.
     * Every person in the scene is drawn together with a handful of instanced meshes, so crowds of hundreds stay fast.
     */
    person(opts = {}) {
      const { at = [0, 0], face = 0, walk = null, h = 1.7, shirt, pants, skin, hair, umbrella = null } = opts;
      const shirts = ["#D8452E", "#3A6EA5", "#E9C46A", "#6A994E", "#F4F1DE", "#7B5EA7", "#264653", "#E76F51"], bottoms = ["#2B2D42", "#4A4E69", "#6B705C", "#22333B", "#8D99AE"], skins = ["#F2C9A5", "#D9A77F", "#A9734E", "#7E5236"], hairs = ["#1E1B18", "#4A2F1D", "#8A5A2B", "#BDBDBD"];
      const c = { shirt: shirt ?? rnd.pick(shirts), pants: pants ?? rnd.pick(bottoms), skin: skin ?? rnd.pick(skins), hair: hair ?? rnd.pick(hairs) };
      const ground = typeof opts.ground === "function" ? opts.ground : null, baseY = opts.y ?? 0;
      const g = new THREE.Group(); g.position.set(at[0], ground ? ground(at[0], at[1]) : baseY, at[1]); g.rotation.y = face; parent.add(g);
      const coats = ["#2B2D42", "#5A4632", "#7A7F8C", "#C9B48A", "#3D2B3A", "#1F3A4A", "#8C3B3B"];
      const style = opts.style ?? rnd.pick(["casual", "casual", "coat", "coat", "skirt", "suit"]);
      const p = { handle: g, s: h / 1.7, c: { ...c, coat: opts.coat ?? rnd.pick(coats), skirt: rnd.pick(["#2B2D42", "#8C3B5A", "#C9B48A", "#3A6EA5"]), bag: rnd.pick(["#3A2A20", "#1E1E24", "#C9B48A", "#8C3B3B", "#2F6FD8"]), cap: rnd.pick(["#1E1E24", "#D8452E", "#F4F1DE", "#3A6EA5"]) },
        umbrella, swing: [0, 0, 0, 0], armOut: walk ? 0 : 0.05, style,
        longHair: opts.longHair ?? rnd() < 0.35, cap: opts.cap ?? (!umbrella && rnd() < 0.18), bag: opts.bag ?? rnd.pick([null, null, "backpack", "tote", "tote"]) };
      if (style === "suit") { p.c.shirt = rnd.pick(["#1E1E24", "#2B2D42", "#3A3F4A"]); p.c.pants = p.c.shirt; }
      people.push(p);
      if (walk) {
        const steps = walk.steps ?? 8, seedPhase = rnd();
        g.rotation.y = Math.atan2(walk.to[0] - at[0], walk.to[1] - at[1]);
        kit.animate(g, (phase, wrapped) => {
          g.position.x = lerp(at[0], walk.to[0], wrapped); g.position.z = lerp(at[1], walk.to[1], wrapped);
          const k2 = 2 * Math.PI * (steps * phase + Math.round(seedPhase * 4) / 4), a = Math.sin(k2);
          p.swing[0] = a * 0.5; p.swing[1] = -a * 0.5; p.swing[2] = -a * 0.4; p.swing[3] = a * 0.4;
          g.position.y = (ground ? ground(g.position.x, g.position.z) : baseY) + Math.abs(Math.cos(k2)) * 0.025;
        });
      }
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
    _pending: () => Promise.all(pending),
    _dynamic: () => dynamic,
    _ticks: () => ticks,
    _pools: () => pools,
    _particles: () => particles,
    _warnings: () => [...new Set(warnings)],
    _usesPoster: () => usesPoster,
    _runTicks(phase, wrapPhase, view) { const wrapped = fract(phase - wrapPhase); for (const t of ticks) t(phase, wrapped, view); updatePeople(); },
    _finish() { finishPeople(); },
  };
  return kit;
}
