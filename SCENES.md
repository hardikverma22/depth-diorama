# Building scenes

The reference for writing a scene file. Read SKILL.md first for the workflow.

A very long lens flattens a deep place into something that looks like a poster. The camera then moves in while the lens widens, and the poster opens up. While the view is flat, objects change depth where nobody can see, so the scene is different when depth returns.

You write one small scene file. The engine handles the camera, framing, rendering, looks and checking. Never edit files in `engine/` to get a result for a scene.

Run every command from this skill's folder, as `node bin/depth-diorama.mjs <command>`.

## Workflow

1. **First use:** nothing to install; the first command sets itself up (about a minute, once). If anything reports a machine problem, run `doctor`.
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
  look: "day",            // day | dusk | night | rain | studio (a dark room for one object)
  flatWidth: 26,          // optional: width of the flat view in metres
  choreography: "reveal", // optional: see the table below
  hero: { x: 0, z: 0, y: 3 },        // optional: the point the camera circles, or a function of aspect
  tune: { haze: "#3A0E10" },         // optional: override any value of the look
  corners: { pitch: 11, orbit: 11 }, // optional: lower corner views, for roofs or canopies
  shots: { high: { y: 5 } },         // optional: adjust a named shot, or a function of aspect
  build(k) { /* create everything here */ },
};
```

| Choreography | Length | What the camera does |
|---|---|---|
| `reveal` | 10 s | Poster, opens deep, two corner views, a high view, back to the poster. Pauses at each view. |
| `snap` | 6 s | One fast open and close. |
| `grand` | 14 s | `reveal` with every view held longer. |
| `launch` | 12 s | Holds the poster at both ends, for titles. |
| `glide` | 12 s | One unbroken flight through every view with no pauses. Use it when the film should feel fluid. |
| `turntable` | 12 s | Poster, then fast whips round `hero` to five angles, low to overhead, each with a short drifting hold, and back to the poster. Use it for one object. |

**Your own camera path.** When no preset suits the subject, write the path. Define shots in `shots`, then list beats in `camera` as `[seconds, shot, role]`. A shot is the point the camera looks at (`x`, `y`, `z`), how wide the view is there in metres (`frame`), the horizontal field of view in degrees (`lens`: small is flat and far, 60 to 90 is wide and close), how high the camera sits above that point in degrees (`pitch`), which way round it stands in degrees (`orbit`: 0 looks down -z, 90 looks from +x) and a vertical shift of the picture (`horizon`). `horizon` is measured in half frame heights: -0.9 shows almost a full half frame more above the target (looking up), positive values look down. Start a new shot from a built-in one with `from`. Any shot may set `swap: 0` or `1` (see Swaps in SKILL.md).

```js
shots: {
  dive: { from: "deep", y: 1.4, lens: 82 },                              // down at street level
  perch: { x: 0, z: -30, y: 6, frame: 30, lens: 55, pitch: 30, orbit: 35 },
},
camera: [[0, "flatIn", "flat"], [0.8, "flat", "flat"], [2.4, "dive", "reveal"], [3.4, "dive", "reveal"],
  [5, "perch", "reveal"], [6.5, "flat", "flat"], [7, "flatIn", "flat"]],
```

The path must start on a flat beat at 0 and end on the shot it started with, so it loops. Between beats every value is eased separately, so the camera's position curves and can swing through a building on a big turn; the checks follow the camera along the whole path and name the second it passes through something. Fix it with an extra beat that lifts or widens the path. Mark beats `"flat"` when the view should read as the poster and `"reveal"` when it should show depth; the checks hold you to both. Two beats close together on similar shots make a hold; far apart shots with little time between make a whip. `--choreo` on the command line overrides the path.

Shot names: `flat`, `flatIn`, `flatAlt`, `flatAltIn`, `deep`, `deepHold`, `cornerAFlat`, `cornerAHold`, `cornerAOpen`, `high`, `highHold`, `cornerBFlat`, `cornerBHold`, `cornerBOpen`, `low`, `lowHold`.

## Kit reference

Positions are `[x, y, z]` with y at the object's base (`ball` is centred). Floor positions are `[x, z]`. A colour argument `c` can also be a material from `k.paint` or `k.sign`.

**Pictures:** `k.svg(markup, { px, screen, lit, poster, repeat })` turns SVG markup into a material for any surface. Use it for every picture in a scene: screens, posters, billboards, packaging, labels, book covers, paintings, logos, maps, menus, faces on a robot. The picture keeps its viewBox's shape, so size the box to match (`viewBox="0 0 400 300"` on a 8 × 6 m box). `screen: true` makes it self-lit like a screen or light box; `lit: true` makes it glow after dark; `poster: true` is only for a picture that is itself the poster and fills the flat frame (the checks hold it to that). `px` is the texture width (1024 by default; use 2048 for a picture that fills the frame). Draw with gradients, paths, text and groups. Do not link to outside files.

```js
const ad = k.svg(`<svg viewBox="0 0 400 300">
  <defs><linearGradient id="bg" x2="0" y2="1"><stop offset="0" stop-color="#FF4FA3"/><stop offset="1" stop-color="#7C3CFF"/></linearGradient></defs>
  <rect width="400" height="300" fill="url(#bg)"/>
  <text x="24" y="80" font-family="Helvetica" font-weight="900" font-style="italic" font-size="60" fill="#fff">SUMMER</text></svg>`, { screen: true });
k.box(8, 6, 0.2, ad, [0, 10, -20]);
```

`lit` may also be a second SVG picture of only what glows after dark, which is how a facade lights its windows without lighting its walls: `k.svg(wallSvg, { lit: windowsSvg })`.

**Picture files:** `k.image("art/logo.png", { screen, lit, poster, repeat })` places a PNG, JPEG or WebP from the scene's own folder. Use it only for pictures the user supplies; draw everything else with `k.svg`.

**Sculpted shapes, for anything that is not a box:**

- `k.loft(sections, c, { axis, seg, smooth, glow })` stretches a smooth skin over cross-sections. Each section is `{ at, w, h, y, c, round }`: position along the axis, width, height, height of its underside, sideways shift, and roundness (2 is an ellipse, 4 is a soft box; `[top, bottom]` sets them apart). Shoes, bottles, cars, boats, furniture, animals and hills are all lofts.
- `k.lathe([[radius, height], ...], c, pos)` spins a profile: bottles, vases, cups, lamps, towers.
- `k.tube(points, radius, c, { closed, glow })` runs a pipe through points: laces, cables, handles, neon.
- `k.mesh(geometry, c, pos, { rx, ry, rz, glow })` places any `k.THREE` geometry.

**Shapes:** `k.box(w, h, d, c, pos, { ry, rx, rz, glow, sides })`, `k.cyl(r, h, c, pos, { top, seg, glow, ry })`, `k.cone(r, h, c, pos)`, `k.ball(r, c, pos, { glow })`, `k.dome(r, c, pos)`, `k.roof(w, rise, d, c, pos)`, `k.bar(a, b, r, c)`, `k.group(fn, pos, ry)`.

A picture on `k.box` covers all six faces, stretched to each. For a facade, sign or screen pass `sides: "#2A2C40"`: the picture goes on the front (+z before turning) and the colour on the other faces. A picture on `k.cyl` wraps once around it with its seam facing +z; turn the cylinder with `ry` to place the seam at the back.

**Paint:** `k.paint(w, h, (g, w, h) => {...}, { repeat, lit })` paints with the canvas API; `lit` paints what glows after dark. `poster: true` makes self-lit paint with no ink or shadow, for one image split across many objects. Anything drawn in a `lit` picture is shown unshaded after dark, dark shapes included, so draw only what emits light in it. `k.sign(text, w, h, { bg, fg, font, glow, border, vertical })` makes text that always fits. `k.board(text, w, h, pos, opts)` places a sign.

**One image, many buildings:** `k.mural({ paint: (g, { W, H, say }) => {...} })` cuts one painting across buildings at different depths so they join when flat. It needs `flatWidth: (aspect) => metres`, and `paint` should compose for `k.aspect`. `k.extrude(shape, depth, c, pos)` makes solid cut-outs.

**World:** `k.ground(w, d, c, pos)`, `k.light([x, y, z], radius, color, strength)` for a soft point light that lights every surface around it, `k.pool([x, y, z], radius, color, strength)` for a crisp coloured pool (lights and pools share a budget of 32). `k.particles({ count, area: [x0, x1, z0, z1], height: [y0, y1], size, color, fall, sway, drift, opacity, glow })` for snow, embers, petals, dust and the like: `fall` and `sway` are whole cycles per loop (negative `fall` rises, 0 floats), they are never inked, and they cost almost nothing. Each particle moves at one or two times `fall` and `sway`, so a layer never looks uniform. Smoke from a chimney: a small `area` and `height` above it, `fall: -1`, large `size` (0.3 to 0.6), low `opacity` (0.15 to 0.3). Scene option `motionBlur` (0 to 2, default 1) sets how much fast moves blur. Wet looks reflect only surfaces lower than 0.12 m, so keep kerbs and paving at 0.1 m or less where you want reflections. With `flatWidth` set, the poster is centred on the middle of everything in the scene, so balance the layout left and right or the poster shifts.

**Illusion:** `k.tile(count, { across: [x0, x1], depth: [z0, z1], shape }, ({ i, u, x, z }) => ...)` with shape `peak`, `vee`, `slope` or `zigzag`. `k.swap(obj, { row, alt })`. 

**Motion.** Everything is driven by `phase`, which runs 0 to 1 over the loop.

- `k.move(obj, { by: [dx, dy, dz], turn, scale, during: [a, b, c, d] })` eases the object out between phases a and b, holds it, and eases it home between c and d. Use it to open, lift, explode and reassemble things.
- `k.float(obj, { height, cycles, tilt })` makes it hover.
- `k.label(text, from, [right, up], { during, h, bg, fg })` draws a line out from a point to a caption that turns to face the camera, shown only during its window.
- `k.mat(color, { glow })` makes a material of your own whose `uniforms.uColor` and `uniforms.uGlow` you can change; `k.tick((phase) => ...)` runs every frame without an object, for blinking lights and colour changes; `k.scroll(material, { u, v })` scrolls a picture across its surface a whole number of times per loop (tickers, conveyor belts, water).
- `k.animate(obj, (phase, wrapped, view) => ...)` for anything else. Pass every object the function changes, as a list if there are several (`k.animate([a, b, c], ...)`). Anything not passed is merged into still geometry when the scene is built, and changes to it are silently ignored: two screens swapped by hiding one will both stay visible and flicker. For anything that switches in steps (a screen changing picture, a light changing colour), put the switches half a step away from the loop point, e.g. `Math.floor(phase * 4 + 0.5) % 2`, so the last frame and the first show the same thing. `k.ease(p, a, b)` and `k.during(p, [a, b, c, d])` give smooth 0 to 1 ramps.

**People:** `k.person({ at, face, walk: { to, steps }, umbrella, shirt, pants, h, style, coat, longHair, cap, bag })` (`style` is `casual`, `coat`, `skirt` or `suit`; `bag` is `backpack`, `tote` or null; all are varied at random when left out) and `k.crowd(n, { x, z, umbrellas, steps })`. Everyone is drawn together, so hundreds of people cost little: fill a crossing with 300 and a market with 150. A person is a handle you can move, swap and animate. On uneven ground pass `ground: (x, z) => height` (or a fixed `y`) and the person stands and walks on it. A walker covers `at` to `to` exactly once per loop and then steps back to `at` at the film's wrap point, a moment of fast camera motion where motion blur hides it; for a natural pace make the walk about 1.3 m × the loop length in seconds (16 m for a 12 s film).

**Props:** `lamp`, `bench`, `rail`, `bin`, `bollard`, `tree`, `planter`, `crate`, `vending`, `awning`, `building(w, h, d, [x, z], { wall, trim, storey, bay, lit, shop })`, `garland(a, b, n, colors, { sag, r })`, `wheel(pos, radius)`, `birds(n, pos, spread)`.

Helpers: `k.rnd()` (seeded, with `.range`, `.int`, `.pick`), `k.isNight`.

## Films about one object

For a product, a character or a machine, read `scenes/runner/scene.js` first: it is the pattern.

1. Build the object from lofts, lathes and tubes, in named groups, one per part.
2. Stand it on a plinth with `look: "studio"`, `choreography: "turntable"` and `hero` at its middle.
3. Put a wall far behind it (at least twice `flatWidth`), painted with `poster: true`, carrying the title. In the flat view the object sits on that poster. Scale the wall by `(k.frame.distance - wallZ) / k.frame.distance` so it lines up.
4. Give the object something to do while the camera circles: parts that lift apart with `k.move`, captions with `k.label`, sparks, light columns far out so the room slides past.
5. Keep anything decorative out of the flat frame (`|x| > flatWidth / 2`), and mark it `userData.ignoreBounds = true`.

## What makes it good

- Something must move in every second: the camera, the object, or both. A camera circling a still object is a slideshow.

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
| Poster fills the whole frame | Paint for each frame shape with `k.mural`, or the image stops short of an edge. |
| Scene returns to its start / Loop seam | Use whole numbers of cycles in `k.animate`. |
| Flicker | Merge close-together surfaces into one painted surface. Judge flicker on final renders only. |

Exit codes: 0 ok, 1 checks failed, 2 bad command, 3 machine not ready, 4 scene error.

## Originality

Build original places, characters and brand names. Use a real brand or name only if the user owns it or has asked for it for their own use. Never copy an existing artwork or imitate a named artist. Describe the effect in plain terms.
