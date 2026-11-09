// One painting, one town. A whale leaping across the moon is sliced across dozens of buildings more than 100 metres apart.
// Each slice is pre-distorted for its own distance, so from the far camera they join without a seam.
const FLAT_WIDTH = 60, FRAME_H = FLAT_WIDTH * 9 / 16, CY = FRAME_H / 2;
const Z_CENTRE = -38.7, CAMERA_Z = Z_CENTRE + FLAT_WIDTH / 2 / Math.tan((1.6 * Math.PI) / 360);
const MURAL = { xmin: -37, xmax: 37, ymin: -7, ymax: 42, scale: 44 };

function paintMural(rnd) {
  const c = document.createElement("canvas"), S = MURAL.scale;
  c.width = Math.round((MURAL.xmax - MURAL.xmin) * S); c.height = Math.round((MURAL.ymax - MURAL.ymin) * S);
  const g = c.getContext("2d");
  g.setTransform(S, 0, 0, -S, -MURAL.xmin * S, MURAL.ymax * S);                                  // draw in metres, y up
  const X = MURAL.xmin, W = MURAL.xmax - MURAL.xmin, disc = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const sky = g.createLinearGradient(0, 38, 0, 5);
  sky.addColorStop(0, "#080C33"); sky.addColorStop(0.42, "#1B2478"); sky.addColorStop(0.72, "#8A3488"); sky.addColorStop(1, "#FF8A5C");
  g.fillStyle = sky; g.fillRect(X, MURAL.ymin, W, MURAL.ymax - MURAL.ymin);
  // rays turning out from the moon
  for (let i = 0; i < 36; i += 2) { const a0 = (i * Math.PI) / 18, a1 = ((i + 1) * Math.PI) / 18; g.fillStyle = "rgba(255,214,150,.055)"; g.beginPath(); g.moveTo(16, 23); g.lineTo(16 + Math.cos(a0) * 70, 23 + Math.sin(a0) * 70); g.lineTo(16 + Math.cos(a1) * 70, 23 + Math.sin(a1) * 70); g.closePath(); g.fill(); }
  for (let i = 0; i < 620; i++) disc(X + rnd() * W, 11 + rnd() * 31, 0.03 + rnd() * rnd() * 0.14, `rgba(255,244,214,${0.35 + rnd() * 0.65})`);
  [[14.4, "rgba(255,226,170,.08)"], [12.5, "rgba(255,226,170,.13)"], [10.8, "rgba(255,226,170,.2)"]].forEach(([r, col]) => disc(16, 23, r, col));
  const moon = g.createRadialGradient(13, 26, 1, 16, 23, 10); moon.addColorStop(0, "#FFF8E2"); moon.addColorStop(1, "#F7BE74");
  g.fillStyle = moon; g.beginPath(); g.arc(16, 23, 9.4, 0, Math.PI * 2); g.fill();
  [[21.5, 27.5, 0.8], [21, 19.5, 1.5], [12.4, 17.8, 0.9]].forEach(([x, y, r]) => disc(x, y, r, "rgba(214,147,94,.32)"));

  // scalloped cloud banks in layers
  const cloud = (x0, y, n, r, fill, line) => { g.fillStyle = fill; g.strokeStyle = line; g.lineWidth = 0.11; for (let i = 0; i < n; i++) { const x = x0 + i * r * 1.45; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.arc(x, y, r * 0.58, 0, Math.PI * 2); g.stroke(); } };
  cloud(-35, 29.5, 8, 1.15, "#54318A", "#E66B73"); cloud(-37, 27.8, 7, 1.35, "#A23E82", "#FF9E7D"); cloud(-34, 25.8, 6, 1.5, "#E66B73", "#FFD7A1");
  cloud(23, 15.4, 8, 1.3, "#54318A", "#E66B73"); cloud(19, 13.4, 12, 1.5, "#A23E82", "#FF9E7D"); cloud(25, 11.4, 9, 1.7, "#E66B73", "#FFD7A1");
  cloud(-37, 13, 7, 1.5, "#54318A", "#E66B73"); cloud(-35, 11, 6, 1.8, "#A23E82", "#FF9E7D");

  // a lighthouse on a rock, and a little fleet
  g.fillStyle = "#2B245F"; g.beginPath(); g.moveTo(-31, 7); g.quadraticCurveTo(-27, 11, -22, 7); g.closePath(); g.fill();
  g.fillStyle = "#FFF0D2"; g.beginPath(); g.moveTo(-28.1, 9); g.lineTo(-25.9, 9); g.lineTo(-26.4, 17); g.lineTo(-27.6, 17); g.closePath(); g.fill();
  g.fillStyle = "#E4503F"; for (const y of [10.4, 13, 15.6]) g.fillRect(-28.2, y, 2.4, 1.15);
  disc(-27, 17.8, 0.72, "#FFE28A"); g.fillStyle = "rgba(255,226,138,.22)"; g.beginPath(); g.moveTo(-27, 17.8); g.lineTo(-5, 24); g.lineTo(-5, 20); g.closePath(); g.fill();
  const boat = (x, y, s, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(x - 1.6 * s, y + 0.7 * s); g.lineTo(x + 1.6 * s, y + 0.7 * s); g.lineTo(x + 0.9 * s, y); g.lineTo(x - 0.9 * s, y); g.closePath(); g.fill(); g.fillStyle = "#FFF4DC"; g.beginPath(); g.moveTo(x, y + 0.8 * s); g.lineTo(x, y + 3.4 * s); g.lineTo(x + 1.5 * s, y + 0.9 * s); g.closePath(); g.fill(); };
  boat(27, 8.4, 1.3, "#E4503F"); boat(21.4, 8.2, 0.9, "#FFC85C"); boat(-16, 8.2, 0.95, "#FFC85C"); boat(-20.5, 8.3, 0.75, "#E4503F");

  // the whale, its body a piece of the night sky, leaping with its tail across the moon
  g.save(); g.translate(1, 19); g.scale(0.82, 0.82); g.translate(-3, -20);
  const body = new Path2D();
  body.moveTo(-27, 14.5); body.bezierCurveTo(-24, 24, -7, 31.5, 8, 26.5);
  body.bezierCurveTo(14, 24.5, 18, 24.6, 21, 28.6);
  body.bezierCurveTo(19.7, 31, 17.8, 33, 14.4, 34.2); body.bezierCurveTo(19, 34.8, 23.4, 33.6, 24.6, 30.8);
  body.bezierCurveTo(27, 33, 30, 33.6, 33.4, 32.4); body.bezierCurveTo(30.8, 30.4, 27.6, 27.6, 25.6, 24.8);
  body.bezierCurveTo(21.8, 16, 13.5, 9.8, 2, 8.4); body.bezierCurveTo(-12, 7, -24.5, 8.6, -27, 14.5); body.closePath();
  g.save(); g.shadowColor = "rgba(3,6,30,.7)"; g.shadowBlur = 46; g.fillStyle = "#101C5C"; g.fill(body); g.restore();
  g.save(); g.clip(body);
  const hide = g.createLinearGradient(-20, 30, 12, 10); hide.addColorStop(0, "#2541A6"); hide.addColorStop(1, "#0B1450");
  g.fillStyle = hide; g.fillRect(-30, 6, 66, 30);
  for (let i = 0; i < 520; i++) disc(-28 + rnd() * 62, 8 + rnd() * 27, 0.03 + rnd() * rnd() * 0.18, `rgba(255,236,190,${0.4 + rnd() * 0.6})`);
  g.fillStyle = "#F9DDB5"; g.beginPath(); g.moveTo(-28, 14); g.bezierCurveTo(-20, 11.8, -6, 12.4, 8, 12.2); g.bezierCurveTo(14, 12.1, 18, 14.6, 22, 18); g.lineTo(23, 6); g.lineTo(-30, 6); g.closePath(); g.fill();
  g.strokeStyle = "#E08A64"; g.lineWidth = 0.19;
  for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(-27, 13.6 - i * 0.62); g.bezierCurveTo(-18, 11.6 - i * 0.62, -5, 12 - i * 0.68, 12, 11.6 - i * 0.8); g.stroke(); }
  g.restore();
  g.strokeStyle = "rgba(255,221,150,.92)"; g.lineWidth = 0.09;
  [[[-17, 21], [-13, 25], [-8.5, 24], [-5, 27.4], [0, 25.5], [4, 27.2]], [[-11, 18.5], [-6, 20.5], [-1, 18.8], [4.4, 21.4], [9.8, 19]], [[8.4, 24], [13.2, 21], [17, 20.8], [20.4, 24.4]]].forEach((pts) => {
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); pts.forEach(([x, y]) => disc(x, y, 0.28, "#FFE7AE"));
  });
  g.fillStyle = "#1D3192"; g.strokeStyle = "#FFD9A0"; g.lineWidth = 0.15; g.beginPath(); g.moveTo(-11, 12.2); g.bezierCurveTo(-8, 8, -2, 3.2, 3.6, 2.2); g.bezierCurveTo(1.8, 6.2, -1.8, 10.6, -4.6, 12.3); g.closePath(); g.fill(); g.stroke();
  g.lineWidth = 0.24; g.strokeStyle = "#0B1450"; g.beginPath(); g.moveTo(-27, 14); g.bezierCurveTo(-22, 13.8, -19, 13.4, -16.6, 14.8); g.stroke();
  disc(-18.6, 16.8, 1, "#FFF3D6"); disc(-18.4, 16.7, 0.6, "#091038"); disc(-18.65, 16.98, 0.19, "#FFFFFF");
  for (let i = 0; i < 110; i++) { const u = rnd(), side = rnd() < 0.5 ? -1 : 1; disc(-10 + side * u * u * 8 + rnd() * 0.4, 28.2 + u * 9.8 - u * u * 4, 0.1 + rnd() * 0.22, rnd() < 0.5 ? "#FFD77E" : "#FFF3D6"); }
  g.restore();

  // scale-pattern waves, drawn back to front
  const cols = ["#1B5C8A", "#147592", "#128C9A", "#1FA3A1", "#3CB8A8", "#74CDB0", "#B1E0BA", "#EFE5BF", "#EFE5BF", "#EFE5BF", "#EFE5BF"], R = 1.5;
  cols.forEach((col, j) => { const y = 7.2 - j * 1.1; for (let i = 0; i < 28; i++) { const x = -39 + i * R * 2 + (j % 2) * R; disc(x, y, R, col); g.strokeStyle = "#FFEFC8"; g.lineWidth = 0.1; for (const r of [R, R * 0.68, R * 0.36]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI, false); g.stroke(); } } });
  return c;
}

export default {
  name: "The Night Whale",
  look: "night",
  tune: { wet: 1, hazeAmount: 0.2, sky: { zenith: "#0B1040", mid: "#2C2C8C", horizon: "#D65F8E", cloud: "#6A469C", cloudShade: "#322670", clouds: 0.45, stars: 0.8 } },
  flatWidth: FLAT_WIDTH,
  shots: { high: { y: 12, frame: 44 }, highHold: { y: 12, frame: 41 } },
  build(k) {
    const mural = paintMural(k.rnd), S = MURAL.scale;
    k.ground(1000, 1400, k.paint(256, 256, (g, w, h) => { g.fillStyle = "#2B3A78"; g.fillRect(0, 0, w, h); g.fillStyle = "#3A4B8E"; for (let i = 0; i < 40; i++) g.fillRect(k.rnd() * w, k.rnd() * h, 34, 2); }, { repeat: [120, 160] }));

    const walls = ["#3A3F7C", "#4C3B7E", "#2F4C7E", "#5D3C74", "#2D5875"], lits = ["#FFC873", "#FFB27A", "#FFE0A0"];
    /** One piece of the painting, on its own building, at its own distance. */
    const cell = (xa, xb, top, z, depth) => {
      const f = (CAMERA_Z - z) / (CAMERA_Z - Z_CENTRE), mid = (xa + xb) / 2, w = (xb - xa) * f + 0.05, h = CY + (top - CY) * f, x = mid * f;
      const mx0 = mid - w / f / 2, mw = w / f, myTop = top, my0 = CY - CY / f;
      const sx = (mx0 - MURAL.xmin) * S, sy = (MURAL.ymax - myTop) * S, sw = mw * S, sh = (myTop - my0) * S;
      const cw = Math.max(16, Math.round(sw)), ch = Math.max(16, Math.round(sh));
      k.box(w, h, 0.3, k.paint(cw, ch, (g) => g.drawImage(mural, sx, sy, sw, sh, 0, 0, cw, ch), { poster: true }), [x, 0, z - 0.15]);
      const bodyH = Math.max(1.6, h - 1.9);
      k.building(w - 0.42, bodyH, depth, [x, z - 0.3 - depth / 2], { wall: k.rnd.pick(walls), trim: "#C9C2DE", storey: 3.1, bay: 2.1, lit: k.rnd.pick(lits) });
      for (let n = 0; n < 2; n++) k.box(0.5, Math.min(0.9, h * 0.1), 0.5, "#23284F", [x + (n ? 1 : -1) * w * 0.25, bodyH, z - 1.5 - depth * 0.4]);
    };

    // Cut the painting into columns of uneven width, then each column into three depths.
    let edge = -32;
    const edges = [edge]; while (edge < 32) { edge = Math.min(32, edge + k.rnd.range(3.8, 6.4)); edges.push(edge); }
    for (let i = 0; i + 1 < edges.length; i++) {
      const a = edges[i], b = edges[i + 1], m = Math.abs((a + b) / 2);
      const low = 3.2 + m * 0.58 + k.rnd.range(0, 1.2), mid = Math.max(low + 6.5, 12 + m * 0.3 + k.rnd.range(0, 2.4));
      cell(a, b, low, k.rnd.range(-12, 18), k.rnd.range(4, 7));
      cell(a, b, mid, k.rnd.range(-50, -20), k.rnd.range(5, 8));
      cell(a, b, FRAME_H + 2.4, k.rnd.range(-100, -58), k.rnd.range(6, 9));
    }

    // Lanterns rise from the mirror all through the town, and reset unseen during the fastest camera move.
    for (let i = 0; i < 64; i++) {
      const x = k.rnd.range(-34, 34), z = k.rnd.range(-78, 26), y0 = k.rnd.range(-2, 12), rise = k.rnd.range(12, 26), sway = k.rnd.range(0, 6.28), s = k.rnd.range(1.1, 2);
      const l = k.group(() => { k.cyl(0.26 * s, 0.56 * s, k.rnd.pick(["#FFC15E", "#FFA24D", "#FFD98A"]), [0, 0, 0], { top: 0.36 * s, glow: 1, seg: 12 }); }, [x, y0, z]);
      l.traverse((o) => { o.userData.ignoreBounds = true; });
      k.animate(l, (p, w) => { l.position.y = y0 + rise * w; l.position.x = x + Math.sin(2 * Math.PI * p * 2 + sway) * 0.35; });
    }

    // Hundreds of candles float on the mirror, so every angle is full of small lights and their reflections.
    for (let i = 0; i < 340; i++) {
      const x = k.rnd.range(-95, 95), z = k.rnd.range(-135, 62);
      const b = k.ball(k.rnd.range(0.16, 0.34), k.rnd.pick(["#FFD27A", "#FFB35E", "#FFF0B8", "#FF9E8A"]), [x, 0.2, z], { glow: 1, seg: 10 });
      b.userData.ignoreBounds = true;
    }

    // The swap: five floating lotus lamps go from a line to a long diagonal while the view is flat.
    ["#FF9CC0", "#FFD27A", "#9DE8DF", "#FFAA7F", "#D2B4FF"].forEach((c, i) => {
      const x = -6 + i * 3;
      const lamp = k.group(() => {
        for (let n = 0; n < 8; n++) { const a = (n * Math.PI) / 4, p = k.ball(0.42, c, [Math.cos(a) * 0.46, 0.34, Math.sin(a) * 0.46], { seg: 12 }); p.scale.set(0.55, 1, 0.34); p.rotation.y = -a + Math.PI / 2; p.rotation.z = 0; }
        k.ball(0.3, "#FFF3C9", [0, 0.5, 0], { glow: 1, seg: 12 }); k.cyl(0.92, 0.06, "#2E7E70", [0, 0, 0], { seg: 18 });
      }, [x, 0, 28]);
      k.swap(lamp, { row: [x, 28], alt: [x, 30 - i * 7] });
    });

    for (let i = 0; i < 14; i++) k.pool([k.rnd.range(-24, 24), 2.5, 14 - i * 8], 12, ["#FF9A5A", "#FF6FA8", "#62D9D0", "#FFC76B"][i % 4], 0.55);
    k.crowd(18, { x: [-12, 12], z: [-8, 26], steps: 8 });
    k.birds(9, [0, 24, -20], 24);
  },
};
