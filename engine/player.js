// The interactive player embedded in a shared HTML file. Drag the bar and the flat picture opens up in your hand.
import { boot } from "./stage.js";
import scene from "__scene__";

const ASPECTS = { "16:9": [1280, 720], "9:16": [608, 1080], "1:1": [864, 864] };
const params = new URLSearchParams(location.search);
const aspect = ASPECTS[params.get("aspect")] ? params.get("aspect") : "16:9";
const [width, height] = ASPECTS[aspect];
const $ = (id) => document.getElementById(id);
const canvas = $("view"), bar = $("bar"), playBtn = $("play"), errorBox = $("error");
canvas.width = width; canvas.height = height;
canvas.style.aspectRatio = `${width} / ${height}`;

try {
  const dr = boot(scene, { canvas, width, height, quality: "draft" });
  $("title").textContent = scene.name ?? "Depth Diorama";
  document.title = `${scene.name ?? "Depth Diorama"} | Depth Diorama`;
  bar.max = String(dr.loop); bar.step = "0.001";
  const marks = $("marks");
  for (const b of dr.timeline.beats) if (b.role === "flat") { const m = document.createElement("i"); m.style.left = `${(b.t / dr.loop) * 100}%`; marks.append(m); }
  document.querySelectorAll("[data-aspect]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.aspect === aspect));
    b.addEventListener("click", () => { const q = new URLSearchParams(location.search); q.set("aspect", b.dataset.aspect); location.search = q.toString(); });
  });
  let t = 0, playing = !matchMedia("(prefers-reduced-motion: reduce)").matches, last = performance.now(), dragging = false;
  const label = () => { playBtn.textContent = playing ? "Pause" : "Play"; playBtn.setAttribute("aria-label", playing ? "Pause" : "Play"); };
  const draw = () => { dr.frame(t, 60, 1); bar.value = String(t); bar.setAttribute("aria-valuetext", `${t.toFixed(1)} of ${dr.loop} seconds`); };
  const tick = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing && !dragging) { t = (t + dt) % dr.loop; draw(); }
    requestAnimationFrame(tick);
  };
  playBtn.addEventListener("click", () => { playing = !playing; label(); });
  bar.addEventListener("input", () => { t = Math.min(+bar.value, dr.loop - 1e-3); dragging = true; draw(); });
  bar.addEventListener("change", () => { dragging = false; });
  addEventListener("keydown", (e) => { if (e.code === "Space" && e.target.tagName !== "BUTTON") { e.preventDefault(); playing = !playing; label(); } });
  label(); draw(); dr.ready.then(draw); requestAnimationFrame(tick);
  window.DR = dr;
} catch (e) {
  errorBox.hidden = false;
  errorBox.textContent = /float textures|WebGL/.test(e.message) ? "This browser cannot run the 3D view. Try a recent Chrome, Edge, Firefox or Safari." : `This scene could not start: ${e.message}`;
}
