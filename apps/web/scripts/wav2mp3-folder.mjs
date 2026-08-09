#!/usr/bin/env node
/**
 * wav2mp3-folder.mjs
 *
 * Converts all .wav samples referenced in an instrument folder's index.json(s)
 * to .mp3 and updates the index.json files to point at the new filenames.
 *
 * Works with two folder layouts:
 *   Flat      – index.json maps  { note: filename.wav, … }   (e.g. salamander)
 *   Versioned – index.json has   { versions: […] }            (e.g. recorder)
 *               each version sub-folder has its own index.json
 *
 * Requires: ffmpeg on PATH.
 *
 * Usage (from the project root):
 *   node scripts/wav2mp3-folder.mjs public/samples/piano/salamander [options]
 *
 * Options:
 *   --bitrate <kbps>     CBR bitrate in kbps, e.g. 192              (default: 192)
 *   --quality <0-9>      VBR quality instead of CBR; 0 = best       (overrides --bitrate)
 *   --output-dir <path>  Write mp3s here                            (default: <folder>-mp3)
 *   --in-place           Convert and update index.json inside the source folder
 *   --delete-source      Remove original .wav after successful conversion
 *   --overwrite          Re-encode even if the .mp3 already exists
 *   --versions <v1,v2>   Only process these versions                (versioned folders only)
 *   --dry-run            Preview without writing any files
 */

import { spawnSync } from "child_process";
import fsp from "fs/promises";
import fs from "fs";
import path from "path";

// ─── ANSI colours ─────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  grey: "\x1b[90m",
};
const col = (c, s) => `${c}${s}${C.reset}`;

// ─── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    folderPath: null,
    bitrate: 192, // CBR kbps — used when quality is null
    quality: null, // VBR q (0–9); overrides bitrate when set
    outputDir: null, // null → <folder>-mp3
    inPlace: false,
    deleteSource: false,
    overwrite: false,
    versions: null, // null → all versions
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--bitrate":
        opts.bitrate = parseInt(args[++i], 10);
        break;
      case "--quality":
        opts.quality = parseInt(args[++i], 10);
        break;
      case "--output-dir":
        opts.outputDir = args[++i];
        break;
      case "--in-place":
        opts.inPlace = true;
        break;
      case "--delete-source":
        opts.deleteSource = true;
        break;
      case "--overwrite":
        opts.overwrite = true;
        break;
      case "--versions":
        opts.versions = args[++i].split(",").map((v) => v.trim());
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      default:
        if (!a.startsWith("--")) opts.folderPath = a;
    }
  }

  return opts;
}

function printUsage() {
  console.error(
    [
      "",
      col(C.bold, "Usage:"),
      "  node scripts/wav2mp3-folder.mjs <samples-folder> [options]",
      "",
      col(C.bold, "Arguments:"),
      "  <samples-folder>          Path to a flat or versioned sample folder",
      "                            (must contain an index.json)",
      "",
      col(C.bold, "Options:"),
      "  --bitrate <kbps>          CBR bitrate in kbps                              (default: 192)",
      "  --quality <0-9>           VBR quality; 0 = best / largest  (overrides --bitrate)",
      "  --output-dir <path>       Write converted files here                       (default: <folder>-mp3)",
      "  --in-place                Convert inside the source folder, update index.json in-place",
      "  --delete-source           Remove original .wav after successful conversion",
      "  --overwrite               Re-encode even if the .mp3 already exists",
      "  --versions <v1,v2,...>    Only process these versions  (versioned folders only)",
      "  --dry-run                 Preview actions without writing any files",
      "",
      col(C.bold, "Examples:"),
      "  # Preview what would happen:",
      "  node scripts/wav2mp3-folder.mjs public/samples/piano/salamander --dry-run",
      "",
      "  # Convert to a new folder (safe default):",
      "  node scripts/wav2mp3-folder.mjs public/samples/piano/salamander",
      "",
      "  # Convert in-place with VBR quality 3, then remove the source wavs:",
      "  node scripts/wav2mp3-folder.mjs public/samples/piano/salamander --in-place --quality 3 --delete-source",
      "",
    ].join("\n"),
  );
}

// ─── Pre-flight ───────────────────────────────────────────────────────────────

function requireTool(name) {
  const r = spawnSync(name, ["-version"], { encoding: "utf8" });
  if (r.error) {
    console.error(
      col(C.red, `✖  ${name} not found on PATH. Please install ffmpeg.`),
    );
    process.exit(1);
  }
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function fmtSize(bytes) {
  if (bytes == null) return "?";
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtPct(before, after) {
  if (!before || !after) return "";
  const pct = ((1 - after / before) * 100).toFixed(1);
  return (
    col(C.green, `−${pct}%`) +
    col(C.grey, ` (saved ${fmtSize(before - after)})`)
  );
}

/** Replaces the .wav extension with .mp3 (case-insensitive). */
function toMp3Name(wavFilename) {
  return wavFilename.replace(/\.wav$/i, ".mp3");
}

// ─── Folder structure detection ───────────────────────────────────────────────

/**
 * Reads and interprets the root index.json.
 *
 * Returns one of:
 *   { type: "flat",      index, indexPath }
 *   { type: "versioned", rootIndex, versions: [{ version, dir, index, indexPath }] }
 */
async function loadStructure(folderPath, versionFilter) {
  const rootIndexPath = path.join(folderPath, "index.json");
  let root;

  try {
    root = JSON.parse(await fsp.readFile(rootIndexPath, "utf8"));
  } catch (err) {
    throw new Error(`Cannot read ${rootIndexPath}: ${err.message}`);
  }

  if (Array.isArray(root.versions)) {
    // ── Versioned layout ─────────────────────────────────────────────────
    const all = root.versions;
    const wanted = versionFilter
      ? versionFilter.filter((v) => {
          if (!all.includes(v)) {
            console.warn(
              col(C.yellow, `  ⚠  Unknown version "${v}" – skipping`),
            );
            return false;
          }
          return true;
        })
      : all;

    const versions = [];
    for (const version of wanted) {
      const dir = path.join(folderPath, version);
      const indexPath = path.join(dir, "index.json");
      let index;
      try {
        index = JSON.parse(await fsp.readFile(indexPath, "utf8"));
      } catch (err) {
        console.warn(
          col(C.yellow, `  ⚠  Skipping version "${version}": ${err.message}`),
        );
        continue;
      }
      versions.push({ version, dir, index, indexPath });
    }

    return { type: "versioned", rootIndex: root, rootIndexPath, versions };
  }

  // ── Flat layout ──────────────────────────────────────────────────────────
  return { type: "flat", index: root, indexPath: rootIndexPath };
}

// ─── Core: convert one file ───────────────────────────────────────────────────

/**
 * Converts a single .wav to .mp3 using ffmpeg (spawnSync).
 *
 * @returns {{ status: "ok"|"skipped"|"dry-run"|"error", beforeBytes, afterBytes, reason? }}
 */
async function convertFile(inputPath, outputPath, opts) {
  if (!fs.existsSync(inputPath)) {
    return { status: "error", reason: "source .wav not found" };
  }

  const beforeBytes = getFileSize(inputPath);

  // Skip if the .mp3 already exists and --overwrite was not given
  if (!opts.overwrite && fs.existsSync(outputPath)) {
    return {
      status: "skipped",
      reason: "mp3 already exists (use --overwrite to re-encode)",
      beforeBytes,
      afterBytes: getFileSize(outputPath),
    };
  }

  if (opts.dryRun) {
    return { status: "dry-run", beforeBytes, afterBytes: null };
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  // Build ffmpeg args
  const ffArgs = ["-y", "-hide_banner", "-loglevel", "error", "-i", inputPath];

  if (opts.quality != null) {
    ffArgs.push("-codec:a", "libmp3lame", "-q:a", String(opts.quality));
  } else {
    ffArgs.push("-codec:a", "libmp3lame", "-b:a", `${opts.bitrate}k`);
  }

  ffArgs.push(outputPath);

  const r = spawnSync("ffmpeg", ffArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (r.status !== 0) {
    const snippet = (r.stderr ?? "").split("\n").slice(-8).join("\n");
    return {
      status: "error",
      reason: "FFmpeg encoding failed",
      ffmpegErr: snippet,
      beforeBytes,
    };
  }

  // Optionally remove the source .wav (non-fatal if it fails)
  if (opts.deleteSource) {
    try {
      await fsp.rm(inputPath);
    } catch (err) {
      process.stderr.write(
        col(C.yellow, `  ⚠  Could not delete source: ${err.message}\n`),
      );
    }
  }

  const afterBytes = getFileSize(outputPath);
  return { status: "ok", beforeBytes, afterBytes };
}

// ─── Progress reporter ────────────────────────────────────────────────────────

function reportResult(label, filename, result) {
  const CLEAR = "\r" + " ".repeat(90) + "\r";
  const lbl = label.padEnd(8);

  switch (result.status) {
    case "ok":
      process.stdout.write(
        `${CLEAR}  ${col(C.green, "✔")}  ${lbl} ` +
          `${col(C.grey, filename)}  ` +
          `${col(C.grey, fmtSize(result.beforeBytes))} → ${col(C.cyan, fmtSize(result.afterBytes))}  ` +
          fmtPct(result.beforeBytes, result.afterBytes) +
          "\n",
      );
      break;

    case "skipped":
      process.stdout.write(
        `${CLEAR}  ${col(C.grey, "–")}  ${lbl} ` +
          `${col(C.grey, filename + "  " + result.reason)}\n`,
      );
      break;

    case "dry-run":
      process.stdout.write(
        `${CLEAR}  ${col(C.cyan, "~")}  ${lbl} ` +
          `${col(C.grey, filename)}  ` +
          col(
            C.grey,
            `${fmtSize(result.beforeBytes)} → would convert to ${toMp3Name(filename)}`,
          ) +
          "\n",
      );
      break;

    case "error":
      process.stdout.write(
        `${CLEAR}  ${col(C.red, "✖")}  ${lbl} ` +
          `${col(C.grey, filename)}  ` +
          col(C.red, result.reason) +
          "\n",
      );
      if (result.ffmpegErr) {
        process.stderr.write(
          col(
            C.grey,
            result.ffmpegErr
              .split("\n")
              .map((l) => `      ${l}`)
              .join("\n"),
          ) + "\n",
        );
      }
      break;
  }
}

// ─── Process one { note → wavFilename } index map ────────────────────────────

/**
 * @param {Object}  index      { note: wavFilename, … }
 * @param {string}  inputDir   directory containing the source .wav files
 * @param {string}  outputDir  directory where .mp3 files will be written
 * @param {Object}  opts
 * @returns {{ ok, skipped, errors, beforeTotal, afterTotal, updatedIndex }}
 */
async function processIndexMap(index, inputDir, outputDir, opts) {
  let ok = 0,
    skipped = 0,
    errors = 0;
  let beforeTotal = 0,
    afterTotal = 0;
  const updatedIndex = {};

  for (const [note, filename] of Object.entries(index)) {
    // Pass through entries that aren't .wav files unchanged
    if (!filename.toLowerCase().endsWith(".wav")) {
      updatedIndex[note] = filename;
      process.stdout.write(
        `  ${col(C.grey, "–")}  ${note.padEnd(8)} ${col(C.grey, `${filename}  (not a .wav, skipped)`)}\n`,
      );
      skipped++;
      continue;
    }

    const inputPath = path.join(inputDir, filename);
    const mp3Name = toMp3Name(filename);
    const outputPath = path.join(outputDir, mp3Name);

    // Show in-progress spinner
    process.stdout.write(
      `  ${col(C.grey, "…")}  ${note.padEnd(8)} ${col(C.grey, filename)}`,
    );

    const result = await convertFile(inputPath, outputPath, opts);

    reportResult(note, filename, result);

    switch (result.status) {
      case "ok":
        updatedIndex[note] = mp3Name; // point index at the new .mp3
        ok++;
        if (result.beforeBytes) beforeTotal += result.beforeBytes;
        if (result.afterBytes) afterTotal += result.afterBytes;
        break;

      case "skipped":
        // .mp3 already existed — still update the index ref so it's correct
        updatedIndex[note] = mp3Name;
        skipped++;
        if (result.beforeBytes) beforeTotal += result.beforeBytes;
        if (result.afterBytes) afterTotal += result.afterBytes;
        break;

      case "dry-run":
        updatedIndex[note] = mp3Name; // show what the index would look like
        ok++;
        if (result.beforeBytes) beforeTotal += result.beforeBytes;
        break;

      case "error":
        updatedIndex[note] = filename; // preserve original ref on failure
        errors++;
        break;
    }
  }

  return { ok, skipped, errors, beforeTotal, afterTotal, updatedIndex };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.folderPath) {
    printUsage();
    process.exit(1);
  }

  if (opts.quality != null && (opts.quality < 0 || opts.quality > 9)) {
    console.error(col(C.red, "✖  --quality must be 0–9"));
    process.exit(1);
  }
  if (opts.bitrate != null && opts.bitrate <= 0) {
    console.error(col(C.red, "✖  --bitrate must be a positive number (kbps)"));
    process.exit(1);
  }

  requireTool("ffmpeg");

  const folderPath = path.resolve(opts.folderPath);

  if (!fs.existsSync(folderPath)) {
    console.error(col(C.red, `✖  Folder not found: ${folderPath}`));
    process.exit(1);
  }

  // Determine output base directory
  let outputBase;
  if (opts.inPlace) {
    outputBase = folderPath;
  } else if (opts.outputDir) {
    outputBase = path.resolve(opts.outputDir);
  } else {
    outputBase = folderPath.replace(/\/+$/, "") + "-mp3";
  }

  // Load folder structure (flat or versioned)
  let structure;
  try {
    structure = await loadStructure(folderPath, opts.versions);
  } catch (err) {
    console.error(col(C.red, `✖  ${err.message}`));
    process.exit(1);
  }

  // ── Print header ───────────────────────────────────────────────────────────
  const encodeLabel =
    opts.quality != null ? `VBR q=${opts.quality}` : `CBR ${opts.bitrate} kbps`;

  console.log("");
  console.log(
    col(C.bold, "wav2mp3-folder") + col(C.grey, " – WAV → MP3 converter"),
  );
  console.log(col(C.grey, "─".repeat(62)));
  console.log(`  Folder:      ${folderPath}`);
  console.log(`  Structure:   ${structure.type}`);
  console.log(`  Encode:      ${encodeLabel}`);
  if (opts.deleteSource) {
    console.log(
      col(C.yellow, "  ⚠  Source .wav files will be deleted after conversion"),
    );
  }
  if (opts.inPlace) {
    console.log(
      col(
        C.yellow,
        "  Mode:        IN-PLACE  (source folder will be modified)",
      ),
    );
  } else {
    console.log(`  Output dir:  ${outputBase}`);
  }
  if (opts.dryRun) {
    console.log(col(C.yellow, "  ⚠  DRY RUN – no files will be written"));
  }
  console.log(col(C.grey, "─".repeat(62)));

  let grandOk = 0,
    grandSkipped = 0,
    grandErrors = 0;
  let grandBefore = 0,
    grandAfter = 0;

  // ── Flat folder ────────────────────────────────────────────────────────────
  if (structure.type === "flat") {
    const outputDir = opts.inPlace ? folderPath : outputBase;

    if (!opts.inPlace && !opts.dryRun) {
      await fsp.mkdir(outputDir, { recursive: true });
    }

    const { ok, skipped, errors, beforeTotal, afterTotal, updatedIndex } =
      await processIndexMap(structure.index, folderPath, outputDir, opts);

    grandOk += ok;
    grandSkipped += skipped;
    grandErrors += errors;
    grandBefore += beforeTotal;
    grandAfter += afterTotal;

    // Write updated index.json
    if (!opts.dryRun) {
      const targetIndexPath = opts.inPlace
        ? structure.indexPath
        : path.join(outputDir, "index.json");
      await fsp.writeFile(
        targetIndexPath,
        JSON.stringify(updatedIndex, null, 2) + "\n",
        "utf8",
      );
      console.log(col(C.grey, `  ↳ index.json updated`));
    } else {
      console.log(col(C.grey, `  ↳ [dry-run] would update index.json`));
    }
  }

  // ── Versioned folder ───────────────────────────────────────────────────────
  else {
    for (const { version, dir, index, indexPath } of structure.versions) {
      console.log("");
      console.log(col(C.bold, `Version: ${version}`));

      const outputVersionDir = opts.inPlace
        ? dir
        : path.join(outputBase, version);

      if (!opts.inPlace && !opts.dryRun) {
        await fsp.mkdir(outputVersionDir, { recursive: true });
      }

      const { ok, skipped, errors, beforeTotal, afterTotal, updatedIndex } =
        await processIndexMap(index, dir, outputVersionDir, opts);

      grandOk += ok;
      grandSkipped += skipped;
      grandErrors += errors;
      grandBefore += beforeTotal;
      grandAfter += afterTotal;

      // Write updated version index.json
      if (!opts.dryRun) {
        const targetIndexPath = opts.inPlace
          ? indexPath
          : path.join(outputVersionDir, "index.json");
        await fsp.writeFile(
          targetIndexPath,
          JSON.stringify(updatedIndex, null, 2) + "\n",
          "utf8",
        );
        console.log(col(C.grey, `  ↳ index.json updated`));
      } else {
        console.log(col(C.grey, `  ↳ [dry-run] would update index.json`));
      }
    }

    // Copy the root index.json to the output dir when not in-place
    if (!opts.inPlace && !opts.dryRun) {
      await fsp.mkdir(outputBase, { recursive: true });
      await fsp.copyFile(
        structure.rootIndexPath,
        path.join(outputBase, "index.json"),
      );
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("");
  console.log(col(C.grey, "─".repeat(62)));

  if (grandBefore > 0) {
    const sizeStr =
      grandAfter > 0
        ? `${col(C.grey, fmtSize(grandBefore))} → ${col(C.cyan, fmtSize(grandAfter))}  ${fmtPct(grandBefore, grandAfter)}`
        : col(C.grey, fmtSize(grandBefore));
    const suffix = opts.dryRun ? col(C.grey, " (estimated)") : "";
    console.log(`  Total:  ${sizeStr}${suffix}`);
  }

  const parts = [
    grandOk > 0 ? col(C.green, `✔  ${grandOk} converted`) : "",
    grandSkipped > 0 ? col(C.grey, `–  ${grandSkipped} skipped`) : "",
    grandErrors > 0
      ? col(C.red, `✖  ${grandErrors} error${grandErrors !== 1 ? "s" : ""}`)
      : "",
  ].filter(Boolean);
  console.log("  " + parts.join("  "));

  if (!opts.inPlace && !opts.dryRun && grandOk > 0) {
    console.log(`  Output: ${outputBase}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(col(C.red, `✖  Unexpected error: ${err.message}`));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
