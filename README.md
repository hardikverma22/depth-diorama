# Depth Diorama

Describe a place. Get a seamless illustrated loop that looks like a flat poster, then opens into deep 3D.

It's a Claude Code skill. There's no 3D software to learn, no timeline to edit and no footage to shoot.

> *"Make a depth diorama of a rainy night market. Vertical, for Reels."*

## Install

Needs Node 20+ and ffmpeg.

```bash
git clone https://github.com/hardikverma22/depth-diorama ~/.claude/skills/depth-diorama
cd ~/.claude/skills/depth-diorama && npm install && node bin/depth-diorama.mjs setup
```

Then ask Claude Code for one.

## Try a built-in scene

```bash
node bin/depth-diorama.mjs share market
```

That writes one HTML file you can open with a double click. Drag the bar slowly and watch a wall of neon signs pull apart.

| Scene | Look | The trick |
|---|---|---|
| `pier` | Day | Ten beach huts in one row turn out to be two lines 70 metres long |
| `station` | Dusk | Eight kiosks in one storefront stretch away down the platform |
| `market` | Rain | A wall of neon signs splits into a street 60 metres deep |

## What you get

- **Any frame shape.** 16:9, 9:16, 1:1 and 4:5 from the same scene, each framed automatically.
- **One-word looks.** `day`, `dusk`, `night`, `rain`.
- **Three camera routines.** `reveal`, `snap` and `grand`, computed from the size of your scene.
- **MP4, WebM, or a page people can drag.**
- **Checked output.** Every render is measured for a flat flat-shot, real depth, hidden swaps, an invisible loop seam, pops, freezes and flicker. You get a pass or fail report and a contact sheet.

## Commands

```
setup      install the render browser          stills    a picture of each key moment
doctor     check this machine can render       preview   fast half-size video, with checks
list       show the built-in scenes            render    full-quality video, with all checks
new        start a scene from the template     verify    check a scene or any video
share      write a draggable HTML player
```

Run the tests with `npm test`.

MIT licensed.
