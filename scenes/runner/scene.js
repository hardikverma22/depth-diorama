// A product film written from one sentence: "a running shoe that comes apart layer by layer".
// It opens as a flat poster, the camera walks a full circle round the shoe while it lifts apart, then it closes again.
const BRAND = "RUNNER / 01", NOTE = "A made-up shoe, modelled from a sentence.", TITLE = ["BUILT", "LAYER", "BY LAYER"];
const INK = "#101014", VOLT = "#D7FF3E", RED = "#E5330F", WHITE = "#F7F5EF";

const flatWidth = (a) => (a < 0.7 ? 9.6 : a < 1.2 ? 12 : 17);
/** Everything that depends on the frame shape, so the scene and the camera agree. */
const layout = (a) => {
  const W = flatWidth(a), H = W / a, plinth = Math.min(3.4, Math.max(1, H * 0.2)), base = plinth + 0.45;
  const lift = Math.min(7.5, Math.max(2.2, H * 0.9 - base - 3));
  return { W, H, plinth, base, lift, middle: base + (2.7 + lift) / 2 };
};

export default {
  name: "Runner",
  look: "studio",
  choreography: "turntable",
  flatWidth,
  hero: (a) => ({ x: 0, z: 0, y: layout(a).middle }),
  // By the overhead view the shoe is whole again, so aim at the shoe rather than the middle of the stack.
  shots: (a) => ({ turnE: { y: layout(a).base + 1.3 }, turnEHold: { y: layout(a).base + 1.3 } }),
  tune: { hazeAmount: 0.22, haze: "#3A0E10", sky: { zenith: "#0B0B10", mid: "#3A0D12", horizon: "#B8300F" } },
  build(k) {
    const T = k.THREE, { W, H, plinth, base, lift } = layout(k.aspect), cy = H / 2;

    k.ground(700, 900, "#17181F");
    k.pool([0, 0, 0], 13, RED, 0.9); k.pool([0, 0, 0], 5, "#FFB36B", 0.7);

    // ---- the wall behind: in the flat view it is the poster the shoe sits on ----
    const WALL_Z = -38, grow = (k.frame.distance - WALL_Z) / k.frame.distance, Wc = W * 3.4, S = 40, top = H + 4, low = -1;
    const wall = k.paint(Math.round(Wc * S), Math.round((top - low) * S), (g) => {
      g.setTransform(S, 0, 0, -S, (Wc / 2) * S, top * S);
      const bg = g.createLinearGradient(0, top, 0, low); bg.addColorStop(0, "#0B0B10"); bg.addColorStop(0.5, "#4A0D12"); bg.addColorStop(0.86, RED); bg.addColorStop(1, "#FF8A24");
      g.fillStyle = bg; g.fillRect(-Wc / 2, low, Wc, top - low);
      g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 0.04; for (let x = -Wc / 2; x < Wc / 2; x += 1.2) { g.beginPath(); g.moveTo(x, low); g.lineTo(x, top); g.stroke(); }
      const say = (text, x, y, size, color, { weight = 900, italic = true, align = "center" } = {}) => { g.save(); g.translate(x, y); g.scale(1, -1); g.font = `${italic ? "italic " : ""}${weight} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`; g.fillStyle = color; g.textAlign = align; g.textBaseline = "alphabetic"; g.fillText(text, 0, 0); g.restore(); };
      const size = Math.min(W * 0.165, H * 0.118);
      TITLE.forEach((line, i) => say(line, 0, H * 0.84 - i * size * 0.98, size, i === 1 ? VOLT : WHITE));
      say(BRAND, -W * 0.44, H * 0.955, W * 0.036, WHITE, { italic: false, weight: 800, align: "left" });
      say(NOTE, 0, H * 0.84 - 2.62 * size, W * 0.027, "rgba(247,245,239,.82)", { italic: false, weight: 500 });
    }, { poster: true });
    k.box(Wc * grow, (top - low) * grow, 0.4, wall, [0, cy + (low - cy) * grow, WALL_Z]);

    // ---- the stand ----
    k.cyl(4.3, 0.3, "#22242E", [0, 0, 0], { seg: 64 });
    k.cyl(3.5, plinth, "#1B1C24", [0, 0, 0], { seg: 64, top: 3.3 });
    k.mesh(new T.TorusGeometry(3.3, 0.06, 8, 96), VOLT, [0, plinth, 0], { rx: Math.PI / 2, glow: 1 });
    for (const r of [6.5, 10]) k.mesh(new T.TorusGeometry(r, 0.05, 6, 128), r > 7 ? RED : VOLT, [0, 0.04, 0], { rx: Math.PI / 2, glow: 1 }).userData.ignoreBounds = true;

    // ---- the shoe: every part is a skin over cross-sections, heel at -x, toe at +x ----
    const parts = {};
    const shoe = k.group(() => {
      const part = (name, fn) => { parts[name] = k.group(fn, [0, 0, 0]); };
      part("outsole", () => k.loft([{ at: -3.05, w: 0.5, y: 0.22 }, { at: -2.85, w: 1.75, y: 0.06 }, { at: -1.5, w: 1.95 }, { at: 0, w: 1.85 }, { at: 1.2, w: 2.25 }, { at: 2.3, w: 2.05, y: 0.1 }, { at: 2.95, w: 1.25, y: 0.34 }, { at: 3.12, w: 0.4, y: 0.46 }].map((s) => ({ h: 0.2, round: 3, ...s })), RED));
      part("cushion", () => { for (const x of [-2.25, -1.6, -0.95]) k.bar([x, 0.55, -0.99], [x, 0.55, 0.99], 0.21, VOLT, { seg: 20, glow: 0.9 }); });
      part("midsole", () => k.loft([{ at: -3.02, w: 0.45, h: 0.5, y: 0.3 }, { at: -2.82, w: 1.7, h: 0.8, y: 0.2 }, { at: -1.5, w: 1.9, h: 0.82, y: 0.14 }, { at: 0, w: 1.8, h: 0.62, y: 0.14 }, { at: 1.2, w: 2.2, h: 0.46, y: 0.14 }, { at: 2.3, w: 2, h: 0.36, y: 0.24 }, { at: 2.95, w: 1.2, h: 0.28, y: 0.46 }, { at: 3.1, w: 0.35, h: 0.2, y: 0.56 }].map((s) => ({ round: 3, ...s })), WHITE));
      part("insole", () => k.loft([{ at: -2.7, w: 1.3, y: 0.98 }, { at: -1.5, w: 1.5, y: 0.94 }, { at: 0, w: 1.45, y: 0.74 }, { at: 1.2, w: 1.8, y: 0.58 }, { at: 2.3, w: 1.6, y: 0.58 }, { at: 2.85, w: 0.9, y: 0.7 }].map((s) => ({ h: 0.12, round: 3, ...s })), VOLT));
      part("upper", () => {
        const body = [{ at: -2.98, w: 0.7, h: 1, y: 0.95 }, { at: -2.75, w: 1.5, h: 1.75, y: 0.92 }, { at: -1.9, w: 1.7, h: 1.7, y: 0.9 }, { at: -0.9, w: 1.7, h: 1.6, y: 0.78 }, { at: 0.2, w: 1.75, h: 1.15, y: 0.68 }, { at: 1.3, w: 2.05, h: 0.8, y: 0.55 }, { at: 2.3, w: 1.85, h: 0.56, y: 0.55 }, { at: 2.9, w: 1.1, h: 0.4, y: 0.66 }, { at: 3.06, w: 0.3, h: 0.2, y: 0.74 }];
        k.loft(body.map((s) => ({ round: [2.2, 3.5], ...s })), "#ECEAE3", { seg: 40, smooth: 8 });
        k.loft([{ at: 1.9, w: 1.99, h: 0.68, y: 0.54 }, { at: 2.3, w: 1.91, h: 0.6, y: 0.54 }, { at: 2.9, w: 1.15, h: 0.44, y: 0.65 }, { at: 3.09, w: 0.34, h: 0.24, y: 0.73 }].map((s) => ({ round: [2.2, 3.5], ...s })), INK);
        k.loft([{ at: -3.03, w: 0.76, h: 0.9, y: 0.93 }, { at: -2.75, w: 1.57, h: 1.3, y: 0.9 }, { at: -2.2, w: 1.73, h: 1.2, y: 0.88 }, { at: -1.6, w: 1.74, h: 0.8, y: 0.88 }].map((s) => ({ round: [2.2, 3.5], ...s })), VOLT);
        k.loft([{ at: -1.2, w: 0.85, h: 0.3, y: 2.48 }, { at: -0.7, w: 0.98, h: 0.3, y: 2.28 }, { at: 0.35, w: 0.9, h: 0.2, y: 1.7 }].map((s) => ({ round: 3, ...s })), RED);
        k.mesh(new T.SphereGeometry(1, 28, 16), "#15161C", [-1.82, 2.43, 0]).scale.set(0.82, 0.2, 0.58);
        k.mesh(new T.TorusGeometry(0.7, 0.13, 10, 48), "#D9D6CC", [-1.82, 2.5, 0], { rx: Math.PI / 2 }).scale.set(1.18, 0.86, 1);
        k.box(0.12, 0.55, 0.34, RED, [-3.02, 2.1, 0]);
        const topAt = (x) => (x < 0.2 ? 2.38 + ((x + 0.9) / 1.1) * (1.83 - 2.38) : 1.83 + ((x - 0.2) / 1.1) * (1.35 - 1.83));
        for (let i = 0; i < 5; i++) { const x = -0.5 + i * 0.4, s = i % 2 ? 1 : -1; k.tube([[x, topAt(x) - 0.3, -0.62 * s], [x + 0.2, topAt(x + 0.2) + 0.05, 0], [x + 0.4, topAt(x + 0.4) - 0.3, 0.62 * s]], 0.055, INK); }
        for (const side of [-1, 1]) for (const dy of [0, 0.32]) k.tube([[-2, 1.3 + dy, side * 0.85], [-0.9, 1.5 + dy, side * 0.86], [0.3, 1.22 + dy * 0.7, side * 0.88]], 0.1, RED);
      });
    }, [0, base, 0]);
    k.float(shoe, { height: 0.1, cycles: 2 });

    // It comes apart while the camera is on its way round, and is whole again before the poster closes.
    const APART = [0.2, 0.33, 0.6, 0.74], share = { outsole: 0, cushion: 0.22, midsole: 0.44, insole: 0.66, upper: 1 };
    for (const [name, f] of Object.entries(share)) if (f) k.move(parts[name], { by: [0, lift * f, 0], during: APART });

    const SAY = [0.38, 0.43, 0.55, 0.59], names = { outsole: ["GRIP", 0.2, 1.2], cushion: ["AIR", 0.6, -1.6], midsole: ["FOAM", 0.75, 0.6], insole: ["FOOTBED", 1.05, -0.6], upper: ["KNIT UPPER", 2.2, 0.4] };
    Object.entries(names).forEach(([name, [text, y, x]], i) => k.label(text, [x, base + y + lift * share[name], 0], [(i % 2 ? -1 : 1) * 2.3, 0.8], { during: SAY, h: 0.58, bg: i % 2 ? VOLT : WHITE }));

    // Light columns far out, so the room slides past as the camera walks round. None stand inside the flat frame.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.17, x = Math.cos(a) * 30, z = Math.sin(a) * 30;
      if (Math.abs(x) < W / 2 + 2) continue;
      const c = k.box(0.22, H * 1.5, 0.22, i % 3 ? RED : VOLT, [x, 0, z], { glow: 1 }); c.userData.ignoreBounds = true; c.castShadow = false;
      if (i % 2) k.pool([x, 0, z], 5, i % 3 ? RED : VOLT, 0.5);
    }

    // Sparks rising round the stand, each a whole number of climbs per loop.
    for (let i = 0; i < 40; i++) {
      const a = k.rnd() * Math.PI * 2, r = k.rnd.range(4.6, 9), start = k.rnd(), climbs = k.rnd.int(1, 2), tall = H * 0.9;
      const s = k.ball(k.rnd.range(0.03, 0.07), i % 3 ? "#FFB36B" : VOLT, [Math.cos(a) * r, 0, Math.sin(a) * r], { glow: 1, seg: 8 });
      s.userData.ignoreBounds = true; s.castShadow = false;
      k.animate(s, (phase) => { const u = (start + phase * climbs) % 1; s.position.y = u * tall; s.scale.setScalar(Math.sin(u * Math.PI)); });
    }
  },
};
