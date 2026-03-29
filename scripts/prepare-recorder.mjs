#!/usr/bin/env node
/**
 * synrecordia/scripts/prepare-recorder.mjs
 *
 * This script extracts `public/samples/recorder/flute.zip` (if present),
 * or scans loose audio files in `public/samples/recorder/`, and only keeps
 * files whose filename contains a numeric index equal to 1 (e.g. `_1_` or `_01_`).
 *
 * Rules:
 * - A file must contain an underscore-delimited numeric index segment: /_(\d+)_/
 * - Only files where Number(index) === 1 are kept.
 * - Kept files are moved into a dynamic folder under `public/samples/recorder/<dynamic>/`
 *   where <dynamic> is one of: forte, mezzo-forte, mezzo-piano, pianissimo, piano
 * - Files without an index, or with an index != 1, are deleted.
 * - Files that cannot be classified to a dynamic are deleted.
 *
 * Safety:
 * - The script deletes discarded files. Make a backup of your recorder folder if you want to preserve originals.
 *
 * Usage (from project root):
 *   node synrecordia/scripts/prepare-recorder.mjs
 *
 * Requirements:
 * - Node 14+ (ESM support)
 * - `unzip` CLI is preferred for extraction; if not available the script will try the `unzipper` package if installed.
 */

import { spawnSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";

const DYNAMICS = ["forte", "mezzo-forte", "mezzo-piano", "pianissimo", "piano"];
const REPO_ROOT = process.cwd();
const RECORDER_DIR = path.join(REPO_ROOT, "public", "samples", "recorder");
const ZIP_NAME = "flute.zip";
const ZIP_PATH = path.join(RECORDER_DIR, ZIP_NAME);
const REFERENCES_DIR_NAME = "references";
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a"]);

/* Helpers */

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function isAudioFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return AUDIO_EXTS.has(ext);
}

async function mkdirp(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function rmSafe(p) {
  try {
    await fsp.unlink(p);
  } catch {
    // ignore
  }
}

async function moveFileSafe(src, dest) {
  await mkdirp(path.dirname(dest));
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    // cross-device fallback
    if (err.code === "EXDEV" || err.code === "EPERM") {
      await fsp.copyFile(src, dest);
      try {
        await fsp.unlink(src);
      } catch {
        // ignore
      }
    } else {
      throw err;
    }
  }
}

async function listFilesRecursive(dir) {
  const out = [];
  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

/* Unzip helpers */

function unzipCli(zipPath, dest) {
  try {
    const res = spawnSync("unzip", ["-o", zipPath, "-d", dest], {
      stdio: "inherit",
    });
    return res && res.status === 0;
  } catch {
    return false;
  }
}

async function unzipWithPackage(zipPath, dest) {
  try {
    const unzipper = await import("unzipper");
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(zipPath);
      rs.pipe(unzipper.Extract({ path: dest }))
        .on("close", resolve)
        .on("finish", resolve)
        .on("error", reject);
    });
    return true;
  } catch {
    return false;
  }
}

/* Core logic:
 * - extract zip if present
 * - gather candidate audio files
 * - for each file:
 *    - skip references/hidden
 *    - require an underscore-delimited numeric index segment: /_(\d+)_/
 *    - keep only if Number(index) === 1
 *    - detect dynamic token in filename; if present, move into dynamic folder
 *    - otherwise delete file
 */

function findIndexInBasename(basename) {
  // match underscore-digit(s)-underscore, e.g. _1_ or _01_ or _05_
  const m = basename.match(/_(\d+)_/);
  if (!m) return null;
  return Number(m[1]);
}

function detectDynamic(basenameLower) {
  // Prefer longer tokens first (e.g. 'mezzo-forte' before 'forte') so we avoid
  // accidental short-token matches when a longer token exists.
  const tokens = [...DYNAMICS].sort((a, b) => b.length - a.length);
  for (const dyn of tokens) {
    if (basenameLower.includes(dyn)) return dyn;
  }
  return null;
}

async function processCandidateFiles(files, recorderDir) {
  let kept = 0;
  let discarded = 0;

  // Ensure dynamic dirs exist
  for (const dyn of DYNAMICS) {
    await mkdirp(path.join(recorderDir, dyn));
  }

  for (const f of files) {
    const rel = path.relative(recorderDir, f);
    // Skip references folder
    if (
      rel
        .split(path.sep)
        .some((seg) => seg.toLowerCase() === REFERENCES_DIR_NAME)
    ) {
      // delete any extracted references (we keep repo's references)
      await rmSafe(f);
      discarded++;
      continue;
    }

    if (!isAudioFile(f)) {
      await rmSafe(f);
      discarded++;
      continue;
    }

    const basename = path.basename(f);
    const index = findIndexInBasename(basename);
    if (index !== 1) {
      // either null (no index) or not equal to 1 -> discard
      await rmSafe(f);
      discarded++;
      continue;
    }

    // index === 1: detect dynamic
    const dyn = detectDynamic(basename.toLowerCase());
    if (!dyn) {
      // no dynamic token -> discard per spec
      await rmSafe(f);
      discarded++;
      continue;
    }

    // move file into dynamic folder and keep original name
    const dest = path.join(recorderDir, dyn, basename);
    // If dest exists already, we will discard this incoming file (do not overwrite).
    if (await exists(dest)) {
      await rmSafe(f);
      discarded++;
      continue;
    }

    try {
      await moveFileSafe(f, dest);
      kept++;
      console.log(`Kept: ${path.join(dyn, basename)}`);
    } catch (err) {
      console.error(`Failed to move ${rel} -> ${dest}:`, err);
      // on error, delete source to avoid leftover
      await rmSafe(f);
      discarded++;
    }
  }

  return { kept, discarded };
}

async function main() {
  console.log("prepare-recorder: starting");

  // verify recorder dir
  if (!(await exists(RECORDER_DIR))) {
    console.error("Recorder directory not found:", RECORDER_DIR);
    process.exit(2);
  }

  // First, if flute.zip exists we extract to a temp dir and process extracted files
  let tempDir = null;
  if (await exists(ZIP_PATH)) {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "recorder-extract-"));
    console.log(`Found ${ZIP_NAME}; extracting into ${tempDir}`);

    let extracted = false;
    if (unzipCli(ZIP_PATH, tempDir)) {
      extracted = true;
    } else if (await unzipWithPackage(ZIP_PATH, tempDir)) {
      extracted = true;
    }

    if (!extracted) {
      console.error(
        "Failed to extract zip. Please install `unzip` or the `unzipper` package.",
      );
      try {
        await fsp.rm(tempDir, { recursive: true, force: true });
      } catch {}
      process.exit(1);
    }

    const extractedFiles = await listFilesRecursive(tempDir);
    console.log(`Processing ${extractedFiles.length} extracted files...`);
    const res = await processCandidateFiles(extractedFiles, RECORDER_DIR);
    console.log(`Extraction pass: kept=${res.kept} discarded=${res.discarded}`);

    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }

  // Then handle any loose audio files directly under recorder dir (not in dynamics, not references)
  const entries = await fsp.readdir(RECORDER_DIR, { withFileTypes: true });
  const loose = [];
  for (const e of entries) {
    const p = path.join(RECORDER_DIR, e.name);
    // skip directories (dynamics and references)
    if (e.isFile() && isAudioFile(p)) {
      loose.push(p);
    }
  }

  if (loose.length) {
    console.log(`Processing ${loose.length} loose files in recorder dir...`);
    const res2 = await processCandidateFiles(loose, RECORDER_DIR);
    console.log(
      `Loose-file pass: kept=${res2.kept} discarded=${res2.discarded}`,
    );
  }

  // Reclassification pass: sometimes files may have been placed into the wrong
  // dynamic folder (or a filename indicates a different dynamic). Run a
  // sanity-pass that scans each dynamic folder and moves any files whose
  // detected dynamic (using the same detection logic above) differs from the
  // current folder name. Prefer the longer token matches already implemented.
  console.log("Running reclassification pass to move misfiled samples...");
  let reclassified = 0;
  for (const dyn of DYNAMICS) {
    const folder = path.join(RECORDER_DIR, dyn);
    if (!(await exists(folder))) continue;
    const filesInFolder = await listFilesRecursive(folder);
    for (const f of filesInFolder) {
      const base = path.basename(f);
      const baseLower = base.toLowerCase();
      const correct = detectDynamic(baseLower);
      // If we cannot detect a dynamic or it's already the correct one, skip
      if (!correct || correct === dyn) continue;
      const destDir = path.join(RECORDER_DIR, correct);
      await mkdirp(destDir);
      const destPath = path.join(destDir, base);
      if (await exists(destPath)) {
        // Destination already exists — remove the duplicate source to keep first-come file
        await rmSafe(f);
        continue;
      }
      try {
        await moveFileSafe(f, destPath);
        reclassified++;
        console.log(
          `Reclassified: ${path.relative(RECORDER_DIR, f)} -> ${path.join(correct, base)}`,
        );
      } catch (err) {
        console.error(
          `Failed to reclassify ${path.relative(RECORDER_DIR, f)} -> ${path.join(correct, base)}:`,
          err,
        );
      }
    }
  }
  console.log(`Reclassification complete. Moved ${reclassified} files.`);
  console.log("prepare-recorder: completed.");
}

if (
  process.argv &&
  process.argv[1] &&
  path.basename(process.argv[1]).startsWith("prepare-recorder")
) {
  main().catch((err) => {
    console.error("prepare-recorder: fatal error:", err);
    process.exit(1);
  });
}
