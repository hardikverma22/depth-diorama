// Camera choreography computed from a scene's size, so a new place needs no hand-tuned shots.
import { clamp, compileTimeline, shotDistance } from "./math.js";

export const CHOREOGRAPHIES = { reveal: 10, snap: 6, grand: 14 };
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
  const shots = {
    flat: flatShot,
    flatIn: { ...flatShot, frame: flat.frame * 0.965 },
    flatAlt: { ...flatShot, frame: flat.frame * 0.985, swap: 1 },
    flatAltIn: { ...flatShot, frame: flat.frame * 0.96, swap: 1 },
    deep: { x: 0.25, z: deepZ, y: 0.85, ...deepBase, horizon: -0.68 },
    deepHold: { x: 0.45, z: deepZ, y: 0.85, ...framed(width * 0.78, 84), horizon: -0.66 },
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
  };
  for (const [name, patch] of Object.entries(overrides)) {
    if (!shots[name]) throw new Error(`scene.shots: there is no shot called "${name}". Available: ${Object.keys(shots).join(", ")}`);
    shots[name] = { ...shots[name], ...patch };
  }
  return shots;
}

const SEQUENCES = {
  reveal: [[0, "flatIn", "flat"], [0.6, "flat", "flat"], [1.2, "deep", "reveal"], [1.9, "deepHold", "reveal"], [2.3, "cornerAFlat"], [2.75, "cornerAHold"], [3.35, "cornerAOpen", "reveal"],
    [3.8, "flat", "flat"], [4.35, "flatAlt", "flat"], [4.85, "flatAltIn", "flat"], [5.35, "high", "reveal"], [6.15, "highHold", "reveal"], [6.55, "cornerBFlat"], [7, "cornerBHold"], [7.7, "cornerBOpen", "reveal"],
    [8.15, "low", "reveal"], [9.1, "lowHold", "reveal"], [9.5, "flatAlt", "flat"], [9.85, "flat", "flat"], [10, "flatIn", "flat"]],
  snap: [[0, "flatIn", "flat"], [0.7, "flat", "flat"], [1.5, "deep", "reveal"], [2.2, "deepHold", "reveal"], [2.75, "flat", "flat"], [3.2, "flatAlt", "flat"], [4.05, "cornerBOpen", "reveal"], [4.75, "lowHold", "reveal"], [5.4, "flatAlt", "flat"], [5.8, "flat", "flat"], [6, "flatIn", "flat"]],
  grand: [[0, "flatIn", "flat"], [0.8, "flat", "flat"], [1.6, "deep", "reveal"], [2.6, "deepHold", "reveal"], [3.1, "cornerAFlat"], [3.8, "cornerAHold"], [4.7, "cornerAOpen", "reveal"], [5.3, "flat", "flat"], [6, "flatAlt", "flat"], [6.7, "flatAltIn", "flat"],
    [7.4, "high", "reveal"], [8.6, "highHold", "reveal"], [9.1, "cornerBFlat"], [9.8, "cornerBHold"], [10.8, "cornerBOpen", "reveal"], [11.4, "low", "reveal"], [12.8, "lowHold", "reveal"], [13.3, "flatAlt", "flat"], [13.8, "flat", "flat"], [14, "flatIn", "flat"]],
};

export function buildTimeline(shots, choreography = "reveal", duration) {
  const seq = SEQUENCES[choreography];
  if (!seq) throw new Error(`unknown choreography "${choreography}". Available: ${Object.keys(SEQUENCES).join(", ")}`);
  const base = CHOREOGRAPHIES[choreography], loop = duration ?? base, k = loop / base;
  const beats = seq.map(([t, name, role], i) => ({ t: i === seq.length - 1 ? loop : t * k, shot: shots[name], name, role }));
  return compileTimeline(beats, loop);
}
