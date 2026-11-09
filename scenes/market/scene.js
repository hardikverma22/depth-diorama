// A night market in the rain: neon signs at many depths fuse into one glowing wall, then pull apart.
export default {
  name: "Lucky Lane Night Market",
  look: "rain",
  flatWidth: 22,
  build(k) {
    const Z0 = 30, Z1 = -66;
    k.ground(500, 800, k.paint(256, 256, (g, w, h) => {
      g.fillStyle = "#3C3F55"; g.fillRect(0, 0, w, h); g.fillStyle = "#30334A";
      for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) g.fillRect(i * 43 + (j % 2) * 20, j * 43, 40, 2);
      for (let i = 0; i < 6; i++) g.fillRect(i * 43, 0, 2, h);
    }, { repeat: [90, 140] }));

    const neon = ["#FF4FA3", "#39E6D0", "#FFC93C", "#7C7CFF", "#FF7A3C", "#65E36B"];
    const words = ["NOODLES", "LUCKY", "TEA", "SPICE", "MANGO", "DUMPLING", "FORTUNE", "LATE", "GRILL", "FISH", "SWEET", "OPEN"];

    // towers both sides, then a wall of apartments behind
    const walls = ["#4A4D73", "#5A4C78", "#3F5474", "#634A6E"];
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
      const z = 20 - i * 16, h = 14 + ((i * 7 + (s > 0 ? 3 : 0)) % 4) * 4;
      k.building(11, h, 14.5, [s * 14.5, z], { wall: walls[(i + (s > 0 ? 1 : 0)) % 4], storey: 3, bay: 2.1, lit: i % 2 ? "#FFD98A" : "#FFC3A0", shop: "#2C3050" });
    }
    k.building(46, 30, 10, [0, Z1 - 8], { wall: "#3C3F6B", storey: 3, bay: 2.1 });

    // the illusion: tall neon signs tile side by side when flat, yet stand 60 metres apart
    k.tile(12, { across: [-8.25, 8.25], depth: [14, -56], shape: "peak" }, ({ i, x, z }) => {
      const tall = 5.6 + (i % 3) * 1.2, c = neon[i % neon.length];
      k.group(() => {
        k.box(1.34, tall, 0.2, k.sign(words[i], 1.34, tall, { bg: "#141628", fg: c, glow: 1, vertical: true, border: c }), [0, 4.1, 0]);
        k.box(0.08, 4.1, 0.08, "#23263A", [0, 0, 0]);
      }, [x, 0, z]);
    });

    // stalls line the lane
    const stall = (x, z, side, i) => k.group(() => {
      const c = neon[i % neon.length];
      k.box(3.2, 1, 1.6, k.paint(256, 128, (g, w, h) => { g.fillStyle = "#7A4A32"; g.fillRect(0, 0, w, h); g.fillStyle = "#5E3825"; for (let n = 0; n < 8; n++) g.fillRect(n * 32, 0, 3, h); }), [0, 0, 0]);
      for (let n = 0; n < 6; n++) k.ball(0.15, ["#FF7A3C", "#FFC93C", "#D8452E", "#65E36B"][n % 4], [-1.2 + n * 0.48, 1.13, 0.1], { seg: 10 });
      for (const dx of [-1.5, 1.5]) for (const dz of [-0.75, 0.75]) k.cyl(0.04, 3, "#23263A", [dx, 0, dz], { seg: 6 });
      k.box(3.6, 0.1, 2.3, k.paint(256, 64, (g, w, h) => { for (let n = 0; n < 8; n++) { g.fillStyle = n % 2 ? "#F6EBDD" : c; g.fillRect((n * w) / 8, 0, w / 8 + 1, h); } }), [0, 3, 0]);
      k.board(words[(i + 5) % words.length], 2.8, 0.55, [0, 3.1, 1.1], { bg: "#141628", fg: c, glow: 1 });
    }, [x, 0, z], side > 0 ? -Math.PI / 2 : Math.PI / 2);
    for (const s of [-1, 1]) for (let i = 0; i < 7; i++) stall(s * 7.3, 22 - i * 12, s, i + (s > 0 ? 3 : 0));

    // lantern strings criss-cross the lane, and pools of light land on the wet ground
    for (let i = 0; i < 7; i++) {
      const z = 24 - i * 13;
      k.garland([-8.6, 7, z], [8.6, 7, z - 6], 16, ["#FFB84D", "#FF5A5A", "#FFE08A"], { sag: 1.1, r: 0.17 });
      if (i < 7) k.pool([i % 2 ? -3 : 3, 3.4, z - 3], 9, i % 2 ? "#FF8A4D" : "#FF4FA3", 0.75);
    }
    k.pool([0, 3, 26], 14, "#39E6D0", 0.35);
    k.pool([0, 7, -40], 22, "#7C7CFF", 0.5);

    // swap objects: crates of fruit
    ["#FF7A3C", "#65E36B", "#FFC93C", "#D8452E", "#FF4FA3"].forEach((c, i) => {
      const x = -3.6 + i * 1.8;
      const crate = k.group(() => { k.crate([0, 0, 0], { s: 0.72 }); k.ball(0.28, c, [-0.12, 0.84, 0.05], { seg: 12 }); k.ball(0.24, c, [0.16, 0.82, -0.08], { seg: 12 }); }, [x, 0, 16]);
      k.swap(crate, { row: [x, 16], alt: [x, 15 - i * 2.8] });
    });
    k.crowd(26, { x: [-5.4, 5.4], z: [-30, 22], umbrellas: 0.6, steps: 8 });
  },
};
