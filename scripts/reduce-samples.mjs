#!/usr/bin/env node
/**
 * reduce-samples.mjs
 *
 * Re-encodes audio samples to reduce file size for web delivery.
 *
 * Works with two folder layouts:
 *   Flat      – index.json maps  { note: filename, … }  (e.g. salamander)
 *   Versioned – index.json has   { versions: […] }       (e.g. recorder)
 *               each version sub-folder has its own index.json
 *
 * Default settings are tuned for piano / instrument web samples:
 *   • MP3 VBR q = 5  (≈ 130 kbps stereo avg, ≈ 65 kbps mono avg)
 *   • Mono downmix   (halves size; left/right are identical for single notes)
 *   • 44 100 Hz sample rate kept
 *
 * Typical result on a 192 kbps stereo MP3 folder: ≈ 70 – 75 % smaller.
 *
 * Requires: ffmpeg (+ ffprobe) on PATH.
 *
 * Usage (from the project root):
 *   node scripts/reduce-samples.mjs public/samples/piano/salamander [options]
 *
 * Options:
 *   --quality <0-9>      MP3 VBR quality; lower = better / larger    (default: 5)
 *   --mono               Downmix to mono                              [default]
 *   --stereo             Keep stereo
 *   --sample-rate <hz>   Resample, e.g. 22050                        (default: keep)
 *   --format <ext>       Output format: mp3 | ogg | wav              (default: keep)
 *   --output-dir <path>  Write reduced files here                    (default: <folder>-reduced)
 *   --in-place           Overwrite originals                          ⚠ use with caution
 *   --versions <v1,v2>   Only process these versions                 (versioned folders only)
 *   --dry-run            Preview actions without writing any audio
 */

import { spawnSync } from "child_process";
import fsp from "fs/promises";
import fs from "fs";
import path from "path";
import os from "os";

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
    quality: 5,       // libmp3lame VBR q (0 = best, 9 = worst)
    mono: true,       // downmix to single channel
    sampleRate: null, // null → keep source rate
    format: null,     // null → keep source format/extension
    outputDir: null,  // null → <folder>-reduced
    inPlace: false,
    versions: null,   // null → all versions
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--quality":      opts.quality = parseInt(args[++i], 10); break;
      case "--mono":         opts.mono = true;                        break;
      case "--stereo":       opts.mono = false;                       break;
      case "--sample-rate":  opts.sampleRate = parseInt(args[++i], 10); break;
      case "--format":       opts.format = args[++i].replace(/^\./, "").toLowerCase(); break;
      case "--output-dir":   opts.outputDir = args[++i];             break;
      case "--in-place":     opts.inPlace = true;                    break;
      case "--versions":     opts.versions = args[++i].split(",").map((v) => v.trim()); break;
      case "--dry-run":      opts.dryRun = true;                     break;
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
      "  node scripts/reduce-samples.mjs <samples-folder> [options]",
      "",
      col(C.bold, "Arguments:"),
      "  <samples-folder>        Path to a flat or versioned sample folder",
      "                          (must contain an index.json)",
      "",
      col(C.bold, "Options:"),
      "  --quality <0-9>         MP3 VBR quality; 0 = best/largest, 9 = worst/smallest   (default: 5)",
      "  --mono                  Downmix to mono  [default — halves file size]",
      "  --stereo                Keep stereo channels",
      "  --sample-rate <hz>      Resample output, e.g. 22050                              (default: keep)",
      "  --format <ext>          Re-encode to a different format: mp3 | ogg | wav         (default: keep)",
      "  --output-dir <path>     Write reduced files here                                 (default: <folder>-reduced)",
      "  --in-place              Overwrite original files  ⚠ use with caution",
      "  --versions <v1,v2,...>  Only process these versions  (versioned folders only)",
      "  --dry-run               Preview estimated savings without writing any audio",
      "",
      col(C.bold, "Examples:"),
      "  # Reduce salamander piano (flat folder) with defaults:",
      "  node scripts/reduce-samples.mjs public/samples/piano/salamander",
      "",
      "  # Aggressive mono + high compression, preview first:",
      "  node scripts/reduce-samples.mjs public/samples/piano/salamander --quality 7 --dry-run",
      "",
      "  # Versioned recorder folder, overwrite originals:",
      "  node scripts/reduce-samples.mjs public/samples/recorder --in-place --quality 5",
      "",
    ].join("\n"),
  );
}

// ─── Pre-flight ───────────────────────────────────────────────────────────────

function requireTool(name) {
  const r = spawnSync(name, ["-version"], { encoding: "utf8" });
  if (r.error) {
    console.error(col(C.red, `✖  ${name} not found on PATH. Please install ffmpeg.`));
    process.exit(1);
  }
}

// ─── Audio helpers ────────────────────────────────────────────────────────────

/**
 * Returns { duration, bitrate, channels, sampleRate } for an audio file, or null.
 */
function probeFile(filePath) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { encoding: "utf8" },
  );
  if (r.error || r.status !== 0) return null;
  try {
    const info = JSON.parse(r.stdout);
    const fmt = info?.format ?? {};
    const stream = (info?.streams ?? []).find((s) => s.codec_type === "audio") ?? {};
    return {
      duration: parseFloat(fmt.duration) || null,
      bitrate: parseInt(fmt.bit_rate, 10) || null,
      channels: parseInt(stream.channels, 10) || null,
      sampleRate: parseInt(stream.sample_rate, 10) || null,
      codec: stream.codec_name ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Size / formatting helpers ────────────────────────────────────────────────

function getFileSize(filePath) {
  try { return fs.statSync(filePath).size; } catch { return null; }
}

function fmtSize(bytes) {
  if (bytes == null) return "?";
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtPct(before, after) {
  if (!before || !after) return "";
  const pct = ((1 - after / before) * 100).toFixed(1);
  const saved = fmtSize(before - after);
  return col(C.green, `−${pct}%`) + col(C.grey, ` (saved ${saved})`);
}

// ─── Codec / output filename helpers ─────────────────────────────────────────

/**
 * Returns FFmpeg codec args for the given file extension.
 * @param {string} ext  e.g. ".mp3"
 * @param {number} quality  0-9 (our unified scale)
 */
function codecArgs(ext, quality) {
  const q = Math.max(0, Math.min(9, quality));
  switch (ext.toLowerCase()) {
    case ".mp3":
      return ["-codec:a", "libmp3lame", "-q:a", String(q)];
    case ".ogg":
      // libvorbis uses an inverted scale: 10 = best. Map our q so that q=5 → vorbis q=4.
      return ["-codec:a", "libvorbis", "-q:a", String(Math.max(0, Math.round(9 - q)))];
    case ".flac":
      return ["-codec:a", "flac"];
    case ".m4a":
      // AAC CBR – quality maps to ~64–256 kbps range
      const aacBr = [256, 224, 192, 160, 128, 112, 96, 80, 64, 48][q];
      return ["-codec:a", "aac", "-b:a", `${aacBr}k`];
    case ".wav":
    default:
      return ["-codec:a", "pcm_s16le"];
  }
}

/**
 * Returns an estimated output size in bytes for dry-run reporting.
 * Uses rough average kbps values for libmp3lame VBR levels.
 */
function estimateOutputBytes(probe, opts, outExt) {
  if (!probe?.duration) return null;

  // Rough average kbps by VBR q level (stereo); halve for mono.
  const mp3AvgKbps = [245, 225, 190, 175, 165, 130, 115, 100, 85, 65];
  const q = Math.max(0, Math.min(9, opts.quality));
  let kbps;

  switch (outExt.toLowerCase()) {
    case ".mp3": {
      kbps = mp3AvgKbps[q];
      if (opts.mono && probe.channels && probe.channels > 1) kbps = Math.round(kbps / 2);
      break;
    }
    case ".ogg": {
      // libvorbis rough averages at comparable quality levels
      const oggAvgKbps = [320, 256, 224, 192, 160, 130, 112, 96, 80, 64];
      kbps = oggAvgKbps[q];
      if (opts.mono && probe.channels && probe.channels > 1) kbps = Math.round(kbps / 2);
      break;
    }
    case ".flac": {
      // FLAC is lossless; rough estimate at 50% compression of PCM
      const sr = opts.sampleRate ?? probe.sampleRate ?? 44100;
      const ch = opts.mono ? 1 : (probe.channels ?? 2);
      return Math.round((sr * ch * 16 * probe.duration) / 8 * 0.5);
    }
    case ".wav": {
      const sr = opts.sampleRate ?? probe.sampleRate ?? 44100;
      const ch = opts.mono ? 1 : (probe.channels ?? 2);
      return Math.round((sr * ch * 16 * probe.duration) / 8);
    }
    default:
      return null;
  }

  return Math.round((kbps * 1000 * probe.duration) / 8);
}

/**
 * Derives the output filename, replacing the extension if --format was given.
 */
function deriveOutputFilename(inputFilename, opts) {
  if (!opts.format) return inputFilename;
  const ext = `.${opts.format}`;
  const base = inputFilename.replace(/\.[^.]+$/, "");
  return base + ext;
}

// ─── Folder structure detection ───────────────────────────────────────────────

/**
 * Reads and interprets the root index.json.
 *
 * Returns one of:
 *   { type: "flat",      index: { note: filename, … } }
 *   { type: "versioned", rootIndex: { versions: […], … }, versions: […] }
 */
async function loadStructure(folderPath, versionFilter) {
  const indexPath = path.join(folderPath, "index.json");
  let root;

  try {
    root = JSON.parse(await fsp.readFile(indexPath, "utf8"));
  } catch (err) {
    throw new Error(`Cannot read ${indexPath}: ${err.message}`);
  }

  if (Array.isArray(root.versions)) {
    // ── Versioned layout ──────────────────────────────────────────────────
    const all = root.versions;
    const wanted = versionFilter
      ? versionFilter.filter((v) => {
          if (!all.includes(v)) {
            console.warn(col(C.yellow, `  ⚠  Unknown version "${v}" – skipping`));
            return false;
          }
          return true;
        })
      : all;

    // Load each version's index
    const versions = [];
    for (const version of wanted) {
      const dir = path.join(folderPath, version);
      const vIndexPath = path.join(dir, "index.json");
      let vIndex;
      try {
        vIndex = JSON.parse(await fsp.readFile(vIndexPath, "utf8"));
      } catch (err) {
        console.warn(col(C.yellow, `  ⚠  Skipping version "${version}": ${err.message}`));
        continue;
      }
      versions.push({ version, dir, index: vIndex });
    }

    return { type: "versioned", rootIndex: root, versions };
  }

  // ── Flat layout ───────────────────────────────────────────────────────────
  return { type: "flat", index: root };
}

// ─── Core: re-encode one file ─────────────────────────────────────────────────

/**
 * Re-encodes `inputPath` → `outputPath` with the given options.
 *
 * @returns {{ status: "ok"|"dry-run"|"error", beforeBytes, afterBytes, reason? }}
 */
async function reduceFile(inputPath, outputPath, opts) {
  if (!fs.existsSync(inputPath)) {
    return { status: "error", reason: "file not found" };
  }

  const beforeBytes = getFileSize(inputPath);

  // ── Dry run ──────────────────────────────────────────────────────────────
  if (opts.dryRun) {
    const probe = probeFile(inputPath);
    const outExt = path.extname(outputPath);
    const afterBytes = estimateOutputBytes(probe, opts, outExt);
    return { status: "dry-run", beforeBytes, afterBytes };
  }

  // ── Build FFmpeg args ────────────────────────────────────────────────────
  const ffArgs = ["-y", "-i", inputPath];

  if (opts.mono)       ffArgs.push("-ac", "1");
  if (opts.sampleRate) ffArgs.push("-ar", String(opts.sampleRate));

  const outExt = path.extname(outputPath).toLowerCase() || path.extname(inputPath).toLowerCase();
  ffArgs.push(...codecArgs(outExt, opts.quality));

  // When writing in-place, stage to a temp file first so the original is
  // never left in a truncated state if ffmpeg fails mid-write.
  const writingInPlace = path.resolve(outputPath) === path.resolve(inputPath);
  const tmpPath = writingInPlace
    ? path.join(os.tmpdir(), `reduce-sample-${Date.now()}${outExt}`)
    : null;

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  ffArgs.push(tmpPath ?? outputPath);

  const r = spawnSync("ffmpeg", ffArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (r.status !== 0) {
    if (tmpPath) await fsp.rm(tmpPath, { force: true }).catch(() => {});
    const snippet = (r.stderr ?? "").split("\n").slice(-10).join("\n");
    return { status: "error", reason: "FFmpeg encoding failed", ffmpegErr: snippet };
  }

  if (writingInPlace && tmpPath) {
    await fsp.copyFile(tmpPath, outputPath);
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
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

    case "dry-run":
      process.stdout.write(
        `${CLEAR}  ${col(C.cyan, "~")}  ${lbl} ` +
        `${col(C.grey, filename)}  ` +
        `${col(C.grey, fmtSize(result.beforeBytes))} → ` +
        (result.afterBytes
          ? `${col(C.cyan, fmtSize(result.afterBytes))} ${col(C.grey, "(est)")}`
          : col(C.grey, "? (unknown duration)")) +
        (result.afterBytes ? `  ${fmtPct(result.beforeBytes, result.afterBytes)}` : "") +
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
        process.stderr.write(col(C.grey, result.ffmpegErr.split("\n").map((l) => `      ${l}`).join("\n")) + "\n");
      }
      break;
  }
}

// ─── Process one set of files (flat or a single version) ─────────────────────

/**
 * Processes a { note → filename } index map.
 *
 * @param {Object}  index       { note: inputFilename, … }
 * @param {string}  inputDir    directory containing the input files
 * @param {string}  outputDir   directory for output files
 * @param {Object}  opts
 * @returns {{ ok, errors, skipped, beforeTotal, afterTotal, updatedIndex }}
 */
async function processIndexMap(index, inputDir, outputDir, opts) {
  let ok = 0, errors = 0;
  let beforeTotal = 0, afterTotal = 0;
  const updatedIndex = {};  // rebuilt in case filenames change (format switch)

  for (const [note, inputFilename] of Object.entries(index)) {
    const inputPath = path.join(inputDir, inputFilename);

    if (!fs.existsSync(inputPath)) {
      console.log(`  ${col(C.yellow, "?")}  ${note.padEnd(8)} ${col(C.grey, inputFilename + "  (not found, skipping)")}`);
      errors++;
      updatedIndex[note] = inputFilename; // preserve original entry
      continue;
    }

    const outputFilename = deriveOutputFilename(inputFilename, opts);
    const outputPath = opts.inPlace
      ? path.join(inputDir, inputFilename)   // always overwrite the original
      : path.join(outputDir, outputFilename);

    updatedIndex[note] = outputFilename;

    // Show spinner
    process.stdout.write(`  ${col(C.grey, "…")}  ${note.padEnd(8)} ${col(C.grey, inputFilename)}`);

    const result = await reduceFile(inputPath, outputPath, opts);

    reportResult(note, inputFilename, result);

    if (result.status === "ok" || result.status === "dry-run") {
      ok++;
      if (result.beforeBytes) beforeTotal += result.beforeBytes;
      if (result.afterBytes)  afterTotal  += result.afterBytes;
    } else {
      errors++;
    }
  }

  return { ok, errors, beforeTotal, afterTotal, updatedIndex };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.folderPath) {
    printUsage();
    process.exit(1);
  }

  // Validate options
  if (!Number.isInteger(opts.quality) || opts.quality < 0 || opts.quality > 9) {
    console.error(col(C.red, "✖  --quality must be an integer 0–9"));
    process.exit(1);
  }
  if (opts.sampleRate !== null && (opts.sampleRate < 8000 || opts.sampleRate > 192000)) {
    console.error(col(C.red, "✖  --sample-rate must be between 8000 and 192000"));
    process.exit(1);
  }
  if (opts.format && !["mp3", "ogg", "wav", "flac", "m4a"].includes(opts.format)) {
    console.error(col(C.red, `✖  --format must be one of: mp3 ogg wav flac m4a`));
    process.exit(1);
  }

  requireTool("ffmpeg");
  requireTool("ffprobe");

  const folderPath = path.resolve(opts.folderPath);

  if (!fs.existsSync(folderPath)) {
    console.error(col(C.red, `✖  Folder not found: ${folderPath}`));
    process.exit(1);
  }

  // Determine output base directory
  let outputBase;
  if (opts.inPlace) {
    outputBase = folderPath; // unused for flat; versioned uses sub-dirs
  } else if (opts.outputDir) {
    outputBase = path.resolve(opts.outputDir);
  } else {
    outputBase = folderPath.replace(/\/+$/, "") + "-reduced";
  }

  // Load folder structure
  let structure;
  try {
    structure = await loadStructure(folderPath, opts.versions);
  } catch (err) {
    console.error(col(C.red, `✖  ${err.message}`));
    process.exit(1);
  }

  // ── Print summary header ─────────────────────────────────────────────────
  const monoLabel  = opts.mono       ? "mono"           : "stereo";
  const srLabel    = opts.sampleRate ? `${opts.sampleRate} Hz` : "keep rate";
  const fmtLabel   = opts.format     ? `.${opts.format}` : "keep format";

  console.log("");
  console.log(col(C.bold, "reduce-samples") + col(C.grey, " – sample size reducer"));
  console.log(col(C.grey, "─".repeat(62)));
  console.log(`  Folder:      ${folderPath}`);
  console.log(`  Structure:   ${structure.type}`);
  console.log(`  Re-encode:   MP3 VBR q=${opts.quality}  ${monoLabel}  ${srLabel}  ${fmtLabel}`);
  if (opts.inPlace) {
    console.log(col(C.yellow, "  Mode:        IN-PLACE  (originals will be overwritten)"));
  } else {
    console.log(`  Output dir:  ${outputBase}`);
  }
  if (opts.dryRun) {
    console.log(col(C.yellow, "  ⚠  DRY RUN – no files will be written (sizes are estimates)"));
  }
  console.log(col(C.grey, "─".repeat(62)));

  let grandOk = 0, grandErrors = 0;
  let grandBefore = 0, grandAfter = 0;

  // ── Process flat folder ──────────────────────────────────────────────────
  if (structure.type === "flat") {
    const outputDir = opts.inPlace ? folderPath : outputBase;

    const { ok, errors, beforeTotal, afterTotal, updatedIndex } =
      await processIndexMap(structure.index, folderPath, outputDir, opts);

    grandOk     += ok;
    grandErrors += errors;
    grandBefore += beforeTotal;
    grandAfter  += afterTotal;

    // Write updated index.json to the output dir (if format changed filenames)
    const indexChanged = Object.entries(updatedIndex).some(
      ([note, fn]) => fn !== structure.index[note],
    );
    if (!opts.inPlace && !opts.dryRun) {
      await fsp.mkdir(outputDir, { recursive: true });
      await fsp.writeFile(
        path.join(outputDir, "index.json"),
        JSON.stringify(updatedIndex, null, 2),
        "utf8",
      );
      if (indexChanged) {
        console.log(col(C.grey, "  ↳ index.json updated (filenames changed due to --format)"));
      }
    } else if (opts.inPlace && !opts.dryRun && indexChanged) {
      await fsp.writeFile(
        path.join(folderPath, "index.json"),
        JSON.stringify(updatedIndex, null, 2),
        "utf8",
      );
      console.log(col(C.grey, "  ↳ index.json updated in-place (filenames changed due to --format)"));
    }
  }

  // ── Process versioned folder ─────────────────────────────────────────────
  else {
    for (const { version, dir, index } of structure.versions) {
      console.log("");
      console.log(col(C.bold, `Version: ${version}`));

      const outputVersionDir = opts.inPlace ? dir : path.join(outputBase, version);

      const { ok, errors, beforeTotal, afterTotal, updatedIndex } =
        await processIndexMap(index, dir, outputVersionDir, opts);

      grandOk     += ok;
      grandErrors += errors;
      grandBefore += beforeTotal;
      grandAfter  += afterTotal;

      // Write version index.json
      if (!opts.inPlace && !opts.dryRun) {
        await fsp.mkdir(outputVersionDir, { recursive: true });
        await fsp.writeFile(
          path.join(outputVersionDir, "index.json"),
          JSON.stringify(updatedIndex, null, 2),
          "utf8",
        );
      } else if (opts.inPlace && !opts.dryRun) {
        const indexChanged = Object.entries(updatedIndex).some(
          ([note, fn]) => fn !== index[note],
        );
        if (indexChanged) {
          await fsp.writeFile(
            path.join(dir, "index.json"),
            JSON.stringify(updatedIndex, null, 2),
            "utf8",
          );
        }
      }
    }

    // Copy root index.json when writing to a new output dir
    if (!opts.inPlace && !opts.dryRun) {
      await fsp.mkdir(outputBase, { recursive: true });
      await fsp.copyFile(
        path.join(folderPath, "index.json"),
        path.join(outputBase, "index.json"),
      );
    }
  }

  // ── Final summary ────────────────────────────────────────────────────────
  console.log("");
  console.log(col(C.grey, "─".repeat(62)));

  if (grandBefore > 0) {
    const suffix = opts.dryRun ? col(C.grey, " (estimated)") : "";
    console.log(
      `  Total:  ${col(C.grey, fmtSize(grandBefore))} → ${col(C.cyan, fmtSize(grandAfter))}  ` +
      fmtPct(grandBefore, grandAfter) +
      suffix,
    );
  }

  console.log(
    `  ${col(C.green, `✔  ${grandOk} file${grandOk !== 1 ? "s" : ""} ${opts.dryRun ? "previewed" : "reduced"}`)}` +
    (grandErrors > 0 ? `  ${col(C.red, `✖  ${grandErrors} error${grandErrors !== 1 ? "s" : ""}`)}` : ""),
  );

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
