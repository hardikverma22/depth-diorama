// A seaside pier: eight beach huts read as one row, then open into a V.
export default {
  name: "Saltwater Pier",
  look: "day",
  flatWidth: 26,
  build(k) {
    const Z0 = 36, Z1 = -76, HW = 13, iron = "#2F4858", white = "#F3EEDF", red = "#D8452E", teal = "#3D8F8A";
    k.ground(1600, 2000, k.paint(512, 512, (g, w, h) => {
      g.fillStyle = "#2BA3B5"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#49BCC8"; for (let i = 0; i < 90; i++) g.fillRect(k.rnd() * w, k.rnd() * h, 24 + k.rnd() * 60, 4);
    }, { repeat: [90, 110] }), [0, -3.5, 0]);

    const planks = k.paint(256, 256, (g, w, h) => {
      g.fillStyle = "#D3AE78"; g.fillRect(0, 0, w, h); g.fillStyle = "#A98552";
      for (let i = 0; i < 8; i++) g.fillRect(0, i * 32, w, 3);
      for (let i = 0; i < 26; i++) { g.fillStyle = "rgba(120,85,40,.35)"; g.fillRect(k.rnd() * w, k.rnd() * h, 40, 2); }
    }, { repeat: [5, 26] });
    k.box(HW * 2, 0.4, Z0 - Z1, planks, [0, -0.4, (Z0 + Z1) / 2]);
    for (let z = Z0 - 4; z > Z1; z -= 8) for (const x of [-11, -4, 4, 11]) k.cyl(0.32, 3.2, iron, [x, -3.5, z], { seg: 10 });

    for (const s of [-1, 1]) {
      k.rail(s * 12.7, [Z0, Z1], { color: white });
      for (let z = 28; z > Z1 + 12; z -= 10) k.lamp([s * 12, z], { side: s, h: 5.4, color: iron });
      for (let z = 24; z > -6; z -= 9.5) k.bench([s * 10.4, z], { ry: -s * Math.PI / 2 });
      for (let z = 19; z > -8; z -= 9.5) k.bin([s * 11, z], s > 0 ? "#3D6B4F" : "#2F4858");
      k.garland([s * 12, 5.3, 28], [s * 12, 5.3, 18], 11, ["#D8452E", "#FFC914", "#17BEBB", "#F3EEDF"], { sag: 0.7, r: 0.11 });
      k.garland([s * 12, 5.3, 18], [s * 12, 5.3, 8], 11, ["#D8452E", "#FFC914", "#17BEBB", "#F3EEDF"], { sag: 0.7, r: 0.11 });
    }

    // the illusion: two lines of huts converge to the centre, yet sit edge to edge when flat
    const palette = ["#E4572E", "#17BEBB", "#FFC914", "#76B041", "#6C5CE7"];
    const face = (c) => k.paint(256, 256, (g, w, h) => {
      g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = "#FFF7E6"; for (let i = 0; i < 6; i += 2) g.fillRect(i * 43, 0, 43, h);
      g.fillStyle = "#374E63"; g.fillRect(90, 96, 76, 160); g.fillStyle = "#FFD36B"; g.fillRect(104, 116, 48, 40); g.fillStyle = "#FFF7E6"; g.fillRect(150, 180, 8, 8);
    });
    k.tile(10, { across: [-11.25, 11.25], depth: [14, -58], shape: "peak" }, ({ i, x, z }) => {
      k.group(() => {
        k.box(2.3, 2.8, 2.6, face(palette[i % palette.length]), [0, 0, 0]);
        k.roof(2.3, 1.05, 2.6, "#7B3F2E", [0, 2.8, 0]);
        k.box(2.5, 0.16, 0.8, "#E9DFC9", [0, 0, 1.55]);
        k.cyl(0.03, 1.1, iron, [0, 3.85, 0], { seg: 6 });
        k.box(0.5, 0.3, 0.02, palette[(i + 2) % palette.length], [0.27, 4.6, 0]);
      }, [x, 0, z]);
    });

    // the far pavilion fills the top of the flat view
    const hall = k.paint(1024, 512, (g, w, h) => {
      g.fillStyle = "#F4E7CC"; g.fillRect(0, 0, w, h); g.fillStyle = "#2F4858"; for (let i = 0; i < 9; i++) g.fillRect(40 + i * 108, 150, 70, 210);
      g.fillStyle = "#F4E7CC"; for (let i = 0; i < 9; i++) g.fillRect(40 + i * 108 + 32, 150, 5, 210);
      g.fillStyle = red; g.fillRect(0, 430, w, 22);
    });
    k.box(24, 9, 14, hall, [0, 0, -68]);
    k.box(24.8, 0.6, 14.8, red, [0, 9, -68]);
    k.dome(4.6, teal, [0, 9.6, -68]); k.cyl(0.08, 2.2, iron, [0, 14, -68], { seg: 6 });
    for (const s of [-1, 1]) { k.cyl(1.5, 12, white, [s * 11.2, 0, -60.5], { seg: 28 }); k.cone(2, 3.2, red, [s * 11.2, 12, -60.5]); }
    k.board("SALTWATER PIER", 15, 2.2, [0, 6.5, -60.8], { font: "Georgia, serif" });
    k.wheel([-14.5, 11.5, -86], 9.5);
    k.wheel([14.5, 11.5, -86], 9.5);
    // a second, taller tile line: banners that fill the middle of the flat view
    k.tile(9, { across: [-12, 12], depth: [-44, 6], shape: "vee" }, ({ i, x, z }) => {
      k.cyl(0.05, 5.9, iron, [x, 0, z], { seg: 8 });
      k.box(1.5, 1.05, 0.04, palette[(i + 1) % palette.length], [x + 0.8, 4.75, z]);
    });
    k.birds(7, [0, 18, -30], 16);

    // swap objects: five striped buoys that go from a row to a diagonal while nobody can tell
    ["#D8452E", "#FFC914", "#17BEBB", "#E4572E", "#76B041"].forEach((c, i) => {
      const x = -4.4 + i * 2.2;
      const buoy = k.group(() => { k.cyl(0.52, 0.9, c, [0, 0, 0], { top: 0.34 }); k.cyl(0.42, 0.16, "#F3EEDF", [0, 0.42, 0]); k.ball(0.27, "#F3EEDF", [0, 1.1, 0]); }, [x, 0, 10]);
      k.swap(buoy, { row: [x, 10], alt: [x, 7.2 - i * 2.6] });
    });
    for (let i = 0; i < 5; i++) k.person({ at: [-8 + i * 4, 3 - i * 2] , face: i * 1.2 });
    k.crowd(14, { x: [-9, 9], z: [-6, 20], steps: 8 });
  },
};
