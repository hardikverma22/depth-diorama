// A railway platform at dusk: a line of kiosks collapses into one storefront, and the columns stack into one.
export default {
  name: "Lantern Street Station",
  look: "dusk",
  flatWidth: 30,
  corners: { pitch: 11, orbit: 11 },
  shots: { high: { y: 5.3, horizon: 0.5 }, highHold: { y: 5.3, horizon: 0.48 } },
  build(k) {
    const Z0 = 32, Z1 = -72, steel = "#39476B", cream = "#F1E5CF", yellow = "#F2C230", brick = "#A65A45";
    const TRACK = -1.2;
    k.ground(600, 900, k.paint(256, 256, (g, w, h) => {
      g.fillStyle = "#6E6A72"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) { g.fillStyle = k.rnd() < 0.5 ? "#5C5962" : "#7F7B83"; g.fillRect(k.rnd() * w, k.rnd() * h, 5, 4); }
    }, { repeat: [60, 90] }), [0, TRACK, -20]);

    const tiles = k.paint(256, 256, (g, w, h) => {
      g.fillStyle = "#BDB7AE"; g.fillRect(0, 0, w, h); g.fillStyle = "#A29C94";
      for (let i = 0; i <= 4; i++) { g.fillRect(i * 64, 0, 3, h); g.fillRect(0, i * 64, w, 3); }
    }, { repeat: [7, 52] });
    k.box(16, -TRACK, Z0 - Z1, tiles, [0, TRACK, (Z0 + Z1) / 2]);
    for (const s of [-1, 1]) k.box(0.5, 0.02, Z0 - Z1, yellow, [s * 7.4, 0, (Z0 + Z1) / 2]);

    // trains waiting either side
    const carriage = (c) => k.paint(1024, 256, (g, w, h) => {
      g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = cream; g.fillRect(0, h * 0.62, w, 14);
      g.fillStyle = "#26304A"; for (let i = 0; i < 8; i++) g.fillRect(36 + i * 124, 54, 88, 76);
      g.fillStyle = "#20283F"; g.fillRect(220, 44, 58, 180); g.fillRect(740, 44, 58, 180);
    }, { lit: (g, w) => { g.clearRect(0, 0, w, 256); g.fillStyle = "#FFE3A1"; for (let i = 0; i < 8; i++) g.fillRect(36 + i * 124, 54, 88, 76); } });
    for (const s of [-1, 1]) {
      for (const x of [s * 9.8]) for (let j = -1; j <= 3; j++) {
        const z = 18 - j * 21;
        k.group(() => { k.box(3.1, 3.9, 20, carriage(s > 0 ? "#C8452F" : "#2F6D8C"), [0, 0.2, 0]); k.box(3.2, 0.25, 20, "#2A2C3B", [0, 4.1, 0]); k.box(2.6, 0.5, 18, "#23242F", [0, -0.3, 0]); }, [x, TRACK, z], 0);
      }
      for (const x of [s * 9.05, s * 10.55]) k.box(0.1, 0.12, 400, "#3A3A44", [x, TRACK, -20]);
      for (let z = 30; z > Z1; z -= 10) {
        k.cyl(0.18, 6.6, steel, [s * 4, 0, z], { top: 0.14, seg: 12 });
        k.box(1.6, 0.3, 0.3, steel, [s * 3.3, 6.2, z]);
        k.lamp([s * 6.8, z - 5], { h: 4.2, side: s, color: steel, bulb: "#FFE4A0" });
        k.bench([s * 3.2, z - 5], { ry: s > 0 ? -Math.PI / 2 : Math.PI / 2, wood: "#9C6A3E", iron: steel });
      }
      k.building(16, 19, 30, [s * 27, -12], { wall: s > 0 ? "#6B5A7A" : "#7C5A63", storey: 3.3, bay: 2.3 });
      k.building(18, 28, 30, [s * 26, -58], { wall: s > 0 ? "#57557A" : "#70607E", storey: 3.3, bay: 2.3 });
      for (let z = 30; z > Z1; z -= 20) { k.cyl(0.13, 9, steel, [s * 13.4, TRACK, z], { seg: 8 }); k.box(5.2, 0.14, 0.14, steel, [s * 11.4, 7.6, z]); }
      k.bar([s * 9.8, 7.1, 30], [s * 9.8, 7.1, Z1], 0.025, "#23242F");
    }

    // platform roof, painted once so nothing can flicker
    const roofPaint = k.paint(512, 512, (g, w, h) => { g.fillStyle = "#4A5780"; g.fillRect(0, 0, w, h); g.fillStyle = "#3C4769"; for (let i = 0; i < 8; i++) g.fillRect(0, i * 64, w, 8); }, { repeat: [1, 6] });
    k.box(11, 0.26, Z0 - Z1, roofPaint, [0, 6.6, (Z0 + Z1) / 2]);
    k.box(11.4, 0.5, Z0 - Z1, "#79809F", [0, 6.86, (Z0 + Z1) / 2]);

    // hanging signs: each sits at its own depth, together they read as one wide board
    const names = ["NORTH", "SOUTH", "HARBOUR", "MARKET", "PLATFORM 2"];
    k.tile(5, { across: [-4.4, 4.4], depth: [24, -30], shape: "zigzag" }, ({ i, x, z }) => {
      k.box(2.1, 0.62, 0.1, k.sign(names[i], 2.1, 0.62, { bg: "#22345C", fg: "#FFE9B8", glow: 1 }), [x, 5.4, z]);
      for (const dx of [-0.8, 0.8]) k.box(0.04, 0.6, 0.04, steel, [x + dx, 6, z]);
    });

    // the illusion: kiosks form one row when flat, and a deep V when opened
    const shops = [["COFFEE", "#C8452F"], ["TICKETS", "#2F6D8C"], ["FLOWERS", "#5B8C5A"], ["BOOKS", "#7B5EA7"], ["NEWS", "#E09F3E"], ["BAKERY", "#B5533C"], ["TEA", "#3D8F8A"], ["SNACKS", "#D8452E"]];
    k.tile(8, { across: [-6.3, 6.3], depth: [12, -52], shape: "peak" }, ({ i, x, z }) => {
      const [label, c] = shops[i];
      k.group(() => {
        k.box(1.72, 2.5, 1.7, k.paint(256, 256, (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = "#1E2740"; g.fillRect(30, 70, w - 60, 120); g.fillStyle = cream; g.fillRect(20, 196, w - 40, 12); }, { lit: (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = "#FFDf9E"; g.fillRect(30, 70, w - 60, 120); } }), [0, 0, 0]);
        k.board(label, 1.7, 0.5, [0, 2.55, 0.8], { bg: cream, fg: c, glow: k.isNight ? 0.7 : 0 });
        k.awning(1.72, 0.55, [0, 2.3, 0.86], { a: c, b: cream });
      }, [x, 0, z]);
    });

    // the great hall closes the view
    const hall = k.paint(1024, 512, (g, w, h) => {
      g.fillStyle = brick; g.fillRect(0, 0, w, h); g.fillStyle = "#8D4A38"; for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) if ((i + j) % 2) g.fillRect(i * 26 + (j % 2) * 12, j * 13, 22, 2);
      g.fillStyle = "#1F2A44"; g.beginPath(); g.arc(w / 2, 340, 210, Math.PI, 0); g.fill(); g.fillRect(w / 2 - 210, 340, 420, h);
      for (const x of [110, 914]) { g.fillStyle = "#1F2A44"; g.fillRect(x - 58, 180, 116, 330); }
    }, { lit: (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = "#FFD98F"; g.beginPath(); g.arc(w / 2, 340, 200, Math.PI, 0); g.fill(); g.fillRect(w / 2 - 200, 340, 400, h); for (const x of [110, 914]) g.fillRect(x - 52, 186, 104, 320); } });
    k.box(34, 15, 12, hall, [0, TRACK, Z1 - 4]);
    k.roof(34, 5.5, 12, "#46506E", [0, 15 + TRACK, Z1 - 4], { ry: 0 });
    k.board("LANTERN STREET", 16, 2, [0, 10.4, Z1 + 2.3], { bg: cream, fg: "#22345C", font: "Georgia, serif", glow: 0.8 });
    k.cyl(1.6, 0.2, cream, [0, 14.6, Z1 + 2.3], { seg: 32 });
    k.birds(6, [0, 21, -36], 15);

    // swap objects: stacks of luggage
    ["#C8452F", "#E09F3E", "#2F6D8C", "#5B8C5A", "#7B5EA7"].forEach((c, i) => {
      const x = -3.2 + i * 1.6;
      const stack = k.group(() => { k.box(0.8, 0.5, 0.55, c, [0, 0, 0]); k.box(0.62, 0.4, 0.45, cream, [0, 0.5, 0]); k.box(0.36, 0.08, 0.1, "#2A2C3B", [0, 0.9, 0]); }, [x, 0, 18]);
      k.swap(stack, { row: [x, 18], alt: [x, 16 - i * 2.4] });
    });
    k.crowd(16, { x: [-6, 6], z: [-18, 24], steps: 9 });
    for (let i = 0; i < 6; i++) k.person({ at: [-5 + i * 2, 8 - i * 7], face: i * 0.9 });
  },
};
