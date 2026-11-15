// Runs the depth model in its own process: node depth-worker.mjs <image> <out.f32> <modelsDir> <model>
// Prints one line of JSON. Kept separate because the model library can crash a process as it exits.
import fs from "node:fs";
import path from "node:path";

const [image, out, modelsDir, model] = process.argv.slice(2);
const say = (o) => fs.writeSync(1, `${JSON.stringify(o)}\n`);
try {
  let tf;
  try { tf = await import("@huggingface/transformers"); } catch { say({ error: "missing" }); process.exit(0); }
  tf.env.cacheDir = modelsDir;
  if (!fs.existsSync(path.join(modelsDir, model))) say({ note: "downloading" });
  const estimator = await tf.pipeline("depth-estimation", model, { dtype: "fp32" });
  const t = (await estimator(await tf.RawImage.read(image))).predicted_depth, [dh, dw] = t.dims.slice(-2);
  fs.writeFileSync(out, Buffer.from(new Float32Array(t.data).buffer));
  say({ dw, dh });
} catch (e) { say({ error: "failed", message: String(e?.message ?? e).split("\n")[0] }); }
