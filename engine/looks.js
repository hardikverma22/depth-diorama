// A look is one setting. Each owns its sky, shading, glow and grade, so nothing is edited by hand.
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export const LOOKS = {
  day: {
    sky: { zenith: "#2F7FD6", mid: "#7CC0EE", horizon: "#FBE6C4", cloud: "#FFFAF0", cloudShade: "#D7E3F2", clouds: 0.5, stars: 0 },
    sun: [0.62, 0.5, 0.6], shade: "#AAB4DA", ink: "#191824", hatch: 0.72,
    haze: "#E8EDF2", hazeAmount: 0.2, windows: 0, bloom: 0, wet: 0, rain: 0,
    saturation: 1.06, contrast: 1.03, vignette: 0.08,
  },
  dusk: {
    sky: { zenith: "#2B3F8F", mid: "#B4619A", horizon: "#FFB36B", cloud: "#FF8F70", cloudShade: "#6E4A8E", clouds: 0.55, stars: 0.15 },
    sun: [-0.72, 0.26, 0.5], shade: "#7D7CC2", ink: "#17122A", hatch: 0.7, tint: "#FFE0C2",
    haze: "#E8A48C", hazeAmount: 0.3, windows: 0.75, bloom: 0.6, wet: 0, rain: 0,
    saturation: 1.12, contrast: 1.05, vignette: 0.16,
  },
  night: {
    sky: { zenith: "#070B26", mid: "#141A4A", horizon: "#54305F", cloud: "#2C2A5C", cloudShade: "#141536", clouds: 0.4, stars: 0.5 },
    sun: [0.5, 0.55, 0.55], shade: "#4B4F93", ink: "#090A18", hatch: 0.75, tint: "#7A84C8",
    haze: "#241F4A", hazeAmount: 0.42, windows: 1, bloom: 1, wet: 0.35, rain: 0,
    saturation: 1.16, contrast: 1.07, vignette: 0.24,
  },
  rain: {
    sky: { zenith: "#0B1030", mid: "#1D2150", horizon: "#6B3A68", cloud: "#34305F", cloudShade: "#191A3C", clouds: 0.75, stars: 0 },
    sun: [0.45, 0.6, 0.55], shade: "#484C8E", ink: "#090A18", hatch: 0.75, tint: "#6F79BE",
    haze: "#28224F", hazeAmount: 0.46, windows: 1, bloom: 1, wet: 1, rain: 1,
    saturation: 1.16, contrast: 1.07, vignette: 0.26,
  },
  // A dark, clean room for one object: no clouds or stars, a glossy floor and soft glow.
  studio: {
    sky: { zenith: "#0E0F14", mid: "#1B1D26", horizon: "#3A3D4C", cloud: "#1B1D26", cloudShade: "#0E0F14", clouds: 0, stars: 0 },
    sun: [0.45, 0.7, 0.6], shade: "#5A5F8C", ink: "#07080E", hatch: 0.6, tint: "#C9CEE8",
    haze: "#1B1D26", hazeAmount: 0.3, windows: 1, bloom: 0.9, wet: 0.6, rain: 0,
    saturation: 1.12, contrast: 1.06, vignette: 0.26,
  },
};

/** Resolves a look name plus optional scene overrides into plain numbers for the shader. */
export function resolveLook(name = "day", tune = {}) {
  const base = LOOKS[name];
  if (!base) throw new Error(`unknown look "${name}". Available: ${Object.keys(LOOKS).join(", ")}`);
  const merged = { ...base, ...tune, sky: { ...base.sky, ...(tune.sky || {}) } };
  const out = { ...merged, name };
  for (const k of ["shade", "ink", "haze"]) out[k] = hex(merged[k]);
  out.tint = hex(merged.tint || "#FFFFFF");
  out.sky = { ...merged.sky };
  for (const k of ["zenith", "mid", "horizon", "cloud", "cloudShade"]) out.sky[k] = hex(merged.sky[k]);
  return out;
}
