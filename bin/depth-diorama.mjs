#!/usr/bin/env node
// depth-diorama: type a sentence, get a looping illustrated film with a real moving camera.
// This starter only uses Node's built-in modules: it installs what the CLI needs on first run, then hands over to it.
import { ensureBrowser, ensureDeps } from "../lib/deps.mjs";

const cmd = process.argv[2];
const NEEDS_NOTHING = new Set([undefined, "help", "--help", "-h"]);
const NEEDS_NO_BROWSER = new Set(["list", "moves", "new", "doctor", "setup"]);

// DEPTH_DIORAMA_NO_INSTALL=1 turns the automatic setup off, for offline machines and CI that should fail clearly instead.
if (!NEEDS_NOTHING.has(cmd) && !process.env.DEPTH_DIORAMA_NO_INSTALL) {
  ensureDeps();
  if (!NEEDS_NO_BROWSER.has(cmd)) await ensureBrowser();
}
await import("../lib/cli.mjs");
