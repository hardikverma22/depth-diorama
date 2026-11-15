// Camera choreography computed from a scene's size, so a new place needs no hand-tuned shots.
import { clamp, compileTimeline, shotDistance } from "./math.js";

export const CHOREOGRAPHIES = { reveal: 10, snap: 6, grand: 14, launch: 12, glide: 12, turntable: 12 };
export const FLAT_LENS = 1.6;
export const FLAT_LENS_LIMIT = 3;

const REFERENCE_ASPECT = 16 / 9;

/**
 * stage: { xmin, xmax, zmin, zmax, top }  zmax is nearest the viewer, the long axis runs towards -z.
 * flat:  result of fitFlatFrame.
 * hero:  { x, z } the middle of the swap objects, or a sensible default.
 * overrides: optional per-shot tweaks from the scene, e.g. { deep: { x: 2 } }.
 * basis: the 16:9 flat width in metres, so a shot means the same thing in every aspect ratio.
 */
export function buildShots(stage, flat, aspect, hero, overrides = {}, basis = flat.frame, corners = {}) {
  const width = basis;                                         // every shot scales from the flat view's width at 16:9
  const clear = stage.clearPitch ?? 0, canyon = clear > 25, c = corners;   // a street canyon needs a narrower, higher corner view
  const pitchA = c.pitch ?? (canyon ? 30 : Math.max(12, clear)), pitchB = c.pitch !== undefined ? c.pitch + 6 : (canyon ? 36 : Math.max(28, clear + 8));
  const orbitA = c.orbit ?? (canyon ? 12 : 26), orbitB = c.orbit !== undefined ? c.orbit * 1.2 : (canyon ? 15 : 34);
  const s = Math.sqrt(aspect / REFERENCE_ASPECT);             // equal-area reframing: the camera path stays, the crop changes
  const framed = (frame, lens) => ({ frame: frame * s, lens: (360 / Math.PI) * Math.atan(Math.tan((lens * Math.PI) / 360) * s) });
  const flatZ = (stage.zmin + stage.zmax) / 2;
  const away = hero.x >= 0 ? -1 : 1;                           // first corner view turns away from the hero object
  const heroZ = hero.z;

  // Every aspect ratio shoots from the same far distance, so a narrow frame is at least as flat as a wide one.
  const flatDistance = basis / 2 / Math.tan((FLAT_LENS * Math.PI) / 360);
  const flatShot = { x: flat.x, z: flatZ, y: flat.y, frame: flat.frame, lens: (360 / Math.PI) * Math.atan(flat.frame / 2 / flatDistance), horizon: 0 };
  const deepBase = framed(width * 0.82, 84);
  const deepD = shotDistance({ frame: width * 0.82, lens: 84 });
  const deepZ = Math.max(Math.min(heroZ, stage.zmax - deepD - 0.5), (stage.swapFront ?? -Infinity) + 2 - deepD);   // never park the low camera on the swap row

  const onStage = (frame, lens) => Math.min(heroZ, stage.zmax - shotDistance({ frame, lens }) - 0.5);
  const highZ = onStage(width * 0.86, 76), lowZ = onStage(width * 0.82, 66);
  const cornerFrame = width * 1.3;
  // A full walk round one object: the camera circles the hero and ends where it began, one turn later.
  const heroY = hero.y ?? flat.y, around = (orbit, pitch, lens, scale) => ({ x: hero.x, z: heroZ, y: heroY, lens: framed(1, lens).lens, frame: flat.frame * scale, horizon: 0, pitch, orbit });
  const shots = {
    flat: flatShot,
    flatIn: { ...flatShot, frame: flat.frame * 0.965 },
    flatAlt: { ...flatShot, frame: flat.frame * 0.985, swap: 1 },
    flatAltIn: { ...flatShot, frame: flat.frame * 0.96, swap: 1 },
    deep: { x: 0.25, z: deepZ, y: 0.85, ...deepBase, horizon: -0.68 },
    deepHold: { x: 0.45, z: deepZ + deepD - shotDistance({ frame: width * 0.78, lens: 84 }), y: 0.85, ...framed(width * 0.78, 84), horizon: -0.66 },
    cornerAFlat: { x: 0, z: heroZ, y: 2, ...framed(cornerFrame, 4.5), horizon: -0.1, pitch: pitchA, orbit: orbitA * away },
    cornerAHold: { x: 0, z: heroZ, y: 2, ...framed(cornerFrame * 0.96, 4.5), horizon: -0.1, pitch: pitchA, orbit: (orbitA + 2) * away },
    cornerAOpen: { x: 0, z: heroZ, y: 2, ...framed(cornerFrame * 0.8, 34), horizon: -0.1, pitch: pitchA, orbit: (orbitA + 2) * away },
    high: { x: 0.2, z: highZ, y: clamp(width * 0.36, 5, 26), ...framed(width * 0.86, 76), horizon: 0.62, swap: 1 },
    highHold: { x: 0.5, z: highZ, y: clamp(width * 0.36, 5, 26), ...framed(width * 0.8, 76), horizon: 0.6, swap: 1 },
    cornerBFlat: { x: 0, z: heroZ, y: 1, ...framed(cornerFrame * 1.2, 4.5), horizon: -0.2, pitch: pitchB, orbit: -orbitB * away, swap: 1 },
    cornerBHold: { x: 0, z: heroZ, y: 1, ...framed(cornerFrame * 1.15, 4.5), horizon: -0.2, pitch: pitchB, orbit: -(orbitB + 2) * away, swap: 1 },
    cornerBOpen: { x: 0, z: heroZ, y: 1, ...framed(cornerFrame, 46), horizon: -0.2, pitch: pitchB, orbit: -(orbitB + 2) * away, swap: 1 },
    low: { x: -0.2, z: lowZ, y: 3.2, ...framed(width * 0.82, 66), horizon: 0.12, swap: 1 },
    lowHold: { x: -0.5, z: lowZ, y: 3.2, ...framed(width * 0.76, 66), horizon: 0.12, swap: 1 },
    // Each angle is a whip in, then a slow drift and push while the viewer takes it in.
    turnA: around(38, 4, 30, 1.04), turnAHold: around(48, 6, 30, 0.97),
    turnB: around(124, 18, 38, 1.1), turnBHold: around(136, 21, 38, 1.03),
    turnC: around(206, 28, 40, 1.14), turnCHold: around(218, 30, 40, 1.07),
    turnD: around(290, 6, 30, 1.04), turnDHold: around(300, 8, 30, 0.97),
    turnE: around(336, 46, 50, 1.12), turnEHold: around(346, 50, 50, 1.05),
    // The turntable's flat shots pivot on the hero itself, so it stays put while the camera starts to walk.
    flatHero: { ...flatShot, z: heroZ, orbit: 0 }, flatHeroIn: { ...flatShot, z: heroZ, frame: flat.frame * 0.965, orbit: 0 },
    flatTurned: { ...flatShot, z: heroZ, orbit: 360 }, flatInTurned: { ...flatShot, z: heroZ, frame: flat.frame * 0.965, orbit: 360 },
  };
  // A scene may adjust a built-in shot, derive a new one from any shot with `from`, or define one outright.
  for (const [name, patch] of Object.entries(overrides)) {
    const { from, ...rest } = patch ?? {};
    if (from !== undefined && !shots[from]) throw new Error(`scene.shots.${name}: there is no shot called "${from}" to start from. Available: ${Object.keys(shots).join(", ")}`);
    const base = from !== undefined ? shots[from] : shots[name];
    if (!base) {
      const missing = ["x", "z", "y", "frame", "lens"].filter((k) => !(Number.isFinite(rest[k])));
      if (missing.length) throw new Error(`scene.shots.${name} is a new shot, so it needs ${missing.join(", ")} (or \`from: "flat"\` to start from an existing shot). Built-in shots: ${Object.keys(shots).join(", ")}`);
    }
    shots[name] = { horizon: 0, pitch: 0, orbit: 0, ...(base ?? {}), ...rest };
  }
  return shots;
}

const SEQUENCES = {
  // One unbroken flight: no stops between the flat views, each angle flows into the next.
  glide: [[0, "flatIn", "flat"], [0.9, "flat", "flat"], [2.4, "deep", "reveal"], [3.9, "cornerAOpen", "reveal"], [5.2, "flat", "flat"], [5.7, "flatAlt", "flat"],
    [7.1, "high", "reveal"], [8.5, "cornerBOpen", "reveal"], [9.9, "low", "reveal"], [11.1, "flatAlt", "flat"], [11.6, "flat", "flat"], [12, "flatIn", "flat"]],
  // For one object: the flat picture opens and the camera walks a full circle round it, rising and falling.
  // Fast whips between angles, each followed by a short drifting hold, the way the place films cut between views.
  turntable: [[0, "flatHeroIn", "flat"], [0.7, "flatHero", "flat"], [1.4, "turnA", "reveal"], [2.4, "turnAHold", "reveal"], [3, "turnB", "reveal"], [4.3, "turnBHold", "reveal"],
    [4.9, "turnC", "reveal"], [6.5, "turnCHold", "reveal"], [7.1, "turnD", "reveal"], [8.4, "turnDHold", "reveal"], [9, "turnE", "reveal"], [10, "turnEHold", "reveal"], [10.7, "flatTurned", "flat"], [12, "flatInTurned", "flat"]],
  // Holds the poster at both ends, so the message is the first and last thing seen.
  launch: [[0, "flatIn", "flat"], [1.8, "flat", "flat"], [2.8, "deep", "reveal"], [3.6, "deepHold", "reveal"], [4.1, "cornerAFlat"], [4.5, "cornerAHold"], [5.2, "cornerAOpen", "reveal"], [5.7, "flat", "flat"], [6.1, "flatAlt", "flat"],
    [7, "high", "reveal"], [7.8, "highHold", "reveal"], [8.6, "low", "reveal"], [9.4, "lowHold", "reveal"], [10.1, "flatAlt", "flat"], [11, "flat", "flat"], [12, "flatIn", "flat"]],
  reveal: [[0, "flatIn", "flat"], [0.6, "flat", "flat"], [1.2, "deep", "reveal"], [1.9, "deepHold", "reveal"], [2.3, "cornerAFlat"], [2.75, "cornerAHold"], [3.35, "cornerAOpen", "reveal"],
    [3.8, "flat", "flat"], [4.35, "flatAlt", "flat"], [4.85, "flatAltIn", "flat"], [5.35, "high", "reveal"], [6.15, "highHold", "reveal"], [6.55, "cornerBFlat"], [7, "cornerBHold"], [7.7, "cornerBOpen", "reveal"],
    [8.15, "low", "reveal"], [9.1, "lowHold", "reveal"], [9.5, "flatAlt", "flat"], [9.85, "flat", "flat"], [10, "flatIn", "flat"]],
  snap: [[0, "flatIn", "flat"], [0.7, "flat", "flat"], [1.5, "deep", "reveal"], [2.2, "deepHold", "reveal"], [2.75, "flat", "flat"], [3.2, "flatAlt", "flat"], [4.05, "cornerBOpen", "reveal"], [4.75, "lowHold", "reveal"], [5.4, "flatAlt", "flat"], [5.8, "flat", "flat"], [6, "flatIn", "flat"]],
  grand: [[0, "flatIn", "flat"], [0.8, "flat", "flat"], [1.6, "deep", "reveal"], [2.6, "deepHold", "reveal"], [3.1, "cornerAFlat"], [3.8, "cornerAHold"], [4.7, "cornerAOpen", "reveal"], [5.3, "flat", "flat"], [6, "flatAlt", "flat"], [6.7, "flatAltIn", "flat"],
    [7.4, "high", "reveal"], [8.6, "highHold", "reveal"], [9.1, "cornerBFlat"], [9.8, "cornerBHold"], [10.8, "cornerBOpen", "reveal"], [11.4, "low", "reveal"], [12.8, "lowHold", "reveal"], [13.3, "flatAlt", "flat"], [13.8, "flat", "flat"], [14, "flatIn", "flat"]],
};

export function buildTimeline(shots, choreography = "reveal", duration) {
  // A scene's own camera path is a list of [seconds, shot name, role]; it must start at 0 and end on the shot it began with.
  const custom = Array.isArray(choreography);
  const seq = custom ? choreography : SEQUENCES[choreography];
  if (!seq) throw new Error(`unknown choreography "${choreography}". Available: ${Object.keys(SEQUENCES).join(", ")}`);
  if (custom) {
    if (seq.length < 3) throw new Error("scene.camera needs at least three beats: [[0, \"flat\", \"flat\"], ..., [end, \"flat\", \"flat\"]].");
    seq.forEach(([t, name, role], i) => {
      if (!Number.isFinite(t) || (i && t <= seq[i - 1][0])) throw new Error(`scene.camera beat ${i}: times must be numbers that increase (got ${t}).`);
      if (!shots[name]) throw new Error(`scene.camera beat ${i}: there is no shot called "${name}". Define it in scene.shots. Available: ${Object.keys(shots).join(", ")}`);
      if (role !== undefined && role !== "flat" && role !== "reveal") throw new Error(`scene.camera beat ${i}: the role must be "flat", "reveal" or left out (got "${role}").`);
    });
    if (seq[0][0] !== 0) throw new Error("scene.camera must start at time 0.");
    if (seq[0][2] !== "flat") throw new Error("scene.camera must start on a flat beat, so the film opens on the poster.");
  }
  const base = custom ? seq.at(-1)[0] : CHOREOGRAPHIES[choreography], loop = duration ?? base, k = loop / base;
  const beats = seq.map(([t, name, role], i) => ({ t: i === seq.length - 1 ? loop : t * k, shot: shots[name], name, role }));
  return compileTimeline(beats, loop);
}
