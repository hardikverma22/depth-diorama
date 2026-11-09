---
name: depth-diorama
description: Turn any place into a seamless illustrated video loop that first reads as a flat drawing, then opens into deep 3D with dolly zooms and objects that secretly rearrange. Works for streets, piers, stations, markets, shops, venues and campuses, in day, dusk, night or rain, at 16:9, 9:16, 1:1 or 4:5, and exports MP4, WebM or a single draggable HTML page. Use when asked for a flat-to-3D loop, a dolly zoom or perspective illusion video, an isometric-looking scene that turns out to be 3D, a scroll-stopping illustrated loop of a place, or an animated storefront, venue or location teaser.
---

# Depth Diorama

A very long lens flattens a deep place into something that looks like a poster. The camera then moves in while the lens widens, and the poster opens up. While the view is flat, objects change depth where nobody can see, so the scene is different when depth returns.

You write one small scene file. The engine handles the camera, framing, rendering, looks and checking. Never edit files in `engine/` to get a result for a scene.

Run every command from this skill's folder, as `node bin/depth-diorama.mjs <command>`.

## Workflow

1. **First use:** run `npm install`, then `setup`. If anything later reports a machine problem, run `doctor`.
2. **Pin down the brief.** Ask only what you cannot decide: the place, the look, the frame shape and any text or brand name it must show. Default to 16:9 and the look that suits the place. For Reels, TikTok or Shorts use 9:16.
3. **`new <name> --look <look>`**, then edit `scenes/<name>/scene.js`. Design the illusion first (see below).
4. **`stills <name>`**, and look at them. Name the three weakest areas of each picture and fix them. Repeat until it looks finished. First versions always look empty.
5. **`preview <name>`** for a fast video with checks. Takes seconds to a minute. Fix anything that fails.
6. **`render <name> --aspect ...`** only after the preview is right. It runs every check and writes a report and a contact sheet next to the video.
7. **`share <name>`** writes one HTML file with a draggable player. Offer it, as it is the best way to show someone the effect.

Show the user the stills or preview before starting a long final render. Report honestly: quote any check that failed.

## Design the illusion before the details

A place works if it has one long axis, and the scene needs these four things:

| Ingredient | How to make it | Rule |
|---|---|---|
| **A tile line** | `k.tile()` with `shape: "peak"` or `"vee"` | Set the count and `across` so items sit edge to edge. Width of each item = across span / (count - 1). This is the main reveal. |
| **A stack line** | Same x, many depths (lamps, columns) | Repeats collapse into one object when flat. |
| **A swap group** | 3 to 6 objects, `k.swap(obj, { row: [x, z1], alt: [x, z2] })` | Keep x identical in `row` and `alt`, or the swap shows. |
| **A backdrop** | A large object at the far end | It fills the top of the flat view. |

Lay the scene out along -z with the viewer at +z. Use true sizes in metres: a door is 2 m, a storey is 3 m, a person is 1.7 m. If the flat view feels too small or too wide, set `flatWidth` in metres to frame what matters.

## Scene file

```js
export default {
  name: "Display name",
  look: "day",            // day | dusk | night | rain
  flatWidth: 26,          // optional: width of the flat view in metres
  choreography: "reveal", // optional: reveal (10 s) | snap (6 s) | grand (14 s)
  corners: { pitch: 11, orbit: 11 }, // optional: lower corner views, for roofs or canopies
  shots: { high: { y: 5 } },         // optional: adjust a named shot
  build(k) { /* create everything here */ },
};
```

Shot names: `flat`, `flatIn`, `flatAlt`, `flatAltIn`, `deep`, `deepHold`, `cornerAFlat`, `cornerAHold`, `cornerAOpen`, `high`, `highHold`, `cornerBFlat`, `cornerBHold`, `cornerBOpen`, `low`, `lowHold`.

## Kit reference

Positions are `[x, y, z]` with y at the object's base (`ball` is centred). Floor positions are `[x, z]`. A colour argument `c` can also be a material from `k.paint` or `k.sign`.

**Shapes:** `k.box(w, h, d, c, pos, { ry, rx, rz, glow })`, `k.cyl(r, h, c, pos, { top, seg, glow })`, `k.cone(r, h, c, pos)`, `k.ball(r, c, pos, { glow })`, `k.dome(r, c, pos)`, `k.roof(w, rise, d, c, pos)`, `k.bar(a, b, r, c)`, `k.group(fn, pos, ry)`.

**Paint:** `k.paint(w, h, (g, w, h) => {...}, { repeat, lit })` paints with the canvas API; `lit` paints what glows after dark. `k.sign(text, w, h, { bg, fg, font, glow, border, vertical })` makes text that always fits. `k.board(text, w, h, pos, opts)` places a sign.

**World:** `k.ground(w, d, c, pos)`, `k.pool([x, y, z], radius, color, strength)` for coloured light (16 at most).

**Illusion:** `k.tile(count, { across: [x0, x1], depth: [z0, z1], shape }, ({ i, u, x, z }) => ...)` with shape `peak`, `vee`, `slope` or `zigzag`. `k.swap(obj, { row, alt })`. `k.animate(obj, (phase, wrapped) => ...)`, where phase runs 0 to 1 over the loop.

**Props:** `lamp`, `bench`, `rail`, `bin`, `bollard`, `tree`, `planter`, `crate`, `vending`, `awning`, `building(w, h, d, [x, z], { wall, trim, storey, bay, lit, shop })`, `garland(a, b, n, colors, { sag, r })`, `person({ at, face, walk: { to, steps }, umbrella })`, `crowd(n, { x, z, umbrellas, steps })`, `wheel(pos, radius)`, `birds(n, pos, spread)`.

Helpers: `k.rnd()` (seeded, with `.range`, `.int`, `.pick`), `k.isNight`.

## What makes it good

- Paint fine detail onto one surface rather than stacking thin objects. Surfaces a few centimetres apart flicker on a long lens.
- Fill the flat view edge to edge. Leave empty space only as a deliberate rest for the eye.
- Give every surface the camera lingers on something lived-in: a sign, a bench, a poster, a stain.
- Limit the palette to 6 to 10 colours plus one accent.
- Anything animated must be built from `phase`, using whole numbers of cycles. Never use `Math.random()` or the clock.
- Scenes are self-contained. They cannot load images or anything else from the network.

## When a check fails

| Check | Fix |
|---|---|
| Flat shot reads as flat | Remove anything very close to the viewer at the front, or override the `flat` lens lower. |
| Flat shot fills the frame / reaches the edges | Add a taller backdrop or more tile items, or lower `flatWidth`. |
| Every move opens real depth | Add objects along the long axis, or move the shot closer with `shots`. |
| Camera is never inside an object | Move the object or override that shot's `x` or `y`. |
| Objects swap only while flat | Only change `swap` between flat beats in a custom timeline. |
| Swap is invisible | Give `row` and `alt` the same x. |
| Same time renders the same image | Replace `Math.random()` or the clock with `k.rnd` and `phase`. |
| Scene returns to its start / Loop seam | Use whole numbers of cycles in `k.animate`. |
| Flicker | Merge close-together surfaces into one painted surface. Judge flicker on final renders only. |

Exit codes: 0 ok, 1 checks failed, 2 bad command, 3 machine not ready, 4 scene error.

## Originality

Build original places, characters and brand names. Use a real brand or name only if the user owns it or has asked for it for their own use. Never copy an existing artwork or imitate a named artist. Describe the effect in plain terms.
