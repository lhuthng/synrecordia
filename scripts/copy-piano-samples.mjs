#!/usr/bin/env node
/**
 * copy-piano-samples.mjs
 *
 * Copies piano sample WAV files from src/assets/samples/piano into
 * public/samples/piano, organized into per-velocity-layer subdirectories
 * (v1–v16). Each subdirectory gets its own index.json listing the files.
 *
 * Filenames containing "#" are renamed so the sharp is represented as "s"
 * (e.g. "C#4v1.wav" → "Cs4v1.wav") for filesystem compatibility.
 *
 * Usage:
 *   node scripts/copy-piano-samples.mjs
 */

import fs from "fs";
import path from "path";

// ── Constants ─────────────────────────────────────────────────────────────────

const SRC = "src/assets/samples/piano";
const DEST_BASE = "public/samples/piano";
const VELOCITY_LAYERS = 16;

// ── Entry point ───────────────────────────────────────────────────────────────

function main() {
  const files = fs.readdirSync(SRC);

  for (let v = 1; v <= VELOCITY_LAYERS; v++) {
    const dest = path.join(DEST_BASE, `v${v}`);
    fs.mkdirSync(dest, { recursive: true });

    const pattern = new RegExp(`^[A-G]#?\\d+v${v}\\.wav$`);
    const picked = files.filter((file) => pattern.test(file));

    const renamed = picked.map((file) => {
      const target = file.replace("#", "s");
      fs.copyFileSync(path.join(SRC, file), path.join(dest, target));
      return target;
    });

    fs.writeFileSync(
      path.join(dest, "index.json"),
      JSON.stringify(renamed.sort(), null, 2),
    );

    console.log(`v${v}: ${renamed.length} samples`);
  }
}

main();
