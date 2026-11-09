// New scene. The long axis runs towards -z. Replace the blocks below with your place.
export default {
  name: "__NAME__",
  look: "__LOOK__",
  build(k) {
    k.ground(400, 500, "#8F93A3");

    // Things that tile edge to edge when flat, then spread out in depth.
    k.tile(8, { across: [-10, 10], depth: [10, -50], shape: "peak" }, ({ x, z, i }) => {
      k.building(2.6, 4 + (i % 3) * 1.5, 5, [x, z], { wall: i % 2 ? "#D8A47F" : "#7FB7BE", storey: 2.2, bay: 1.3 });
    });

    // A tall backdrop so the flat view fills the frame.
    k.building(26, 16, 8, [0, -58], { wall: "#83849A" });

    // Objects that rearrange while the view is flat.
    for (let i = 0; i < 5; i++) {
      const x = -4 + i * 2;
      const item = k.group(() => k.cyl(0.4, 1, "#D8452E", [0, 0, 0]), [x, 0, 16]);
      k.swap(item, { row: [x, 16], alt: [x, 18 - i * 3] });
    }
  },
};
