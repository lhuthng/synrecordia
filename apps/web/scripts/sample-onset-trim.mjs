#!/usr/bin/env node
/**
 * sample-onset-trim.mjs
 *
 * Detects and trims leading silence from sampler audio files so every
 * note reaches its sustained tone at a consistent onset point.
 *
 * Accepts either a directory containing index.json or a single audio file.
 * When a directory is given, reads index.json to discover the note → file map.
 * When a single file is given, processes just that file.
 *
 * Onset can be auto-detected via ffmpeg silencedetect, or set manually
 * with --trim-ms for cases where auto-detection is not accurate enough.
 *
 * Requires: ffmpeg installed and on PATH  (brew install ffmpeg)
 *
 * Usage:
 *   node scripts/sample-onset-trim.mjs <dir-or-file>  [options]
 *
 * Options:
 *   --trim-ms       FLOAT  Skip detection; trim exactly this many ms from
 *                          the start of every file  (overrides all detection
 *                          options; pre-roll is also skipped)
 *   --threshold-db  FLOAT  Silence threshold in dBFS  (default: -50)
 *   --pre-roll-ms   FLOAT  Milliseconds to keep before onset  (default: 5)
 *   --min-trim-ms   FLOAT  Skip files whose onset is below this  (default: 10)
 *   --output-dir    PATH   Where to write trimmed files
 *                            directory input → default: <dir>/_trimmed/
 *                            file input      → default: <same-dir>/<stem>_trimmed.<ext>
 *   --in-place             Overwrite original file(s)
 *   --dry-run              Report detected onsets without writing any files
 *
 * Examples:
 *   # Inspect all samples in a directory — safe, writes nothing
 *   node scripts/sample-onset-trim.mjs \
 *     public/samples/recorder/philharmonia-flute --dry-run
 *
 *   # Auto-detect and trim to _trimmed/ subfolder (safe default)
 *   node scripts/sample-onset-trim.mjs \
 *     public/samples/recorder/philharmonia-flute
 *
 *   # Auto-detect a single file, write adjacent _trimmed copy
 *   node scripts/sample-onset-trim.mjs \
 *     public/samples/recorder/philharmonia-flute/flute_E4_1_forte_normal.mp3
 *
 *   # Manually trim exactly 25 ms from every file in a directory, in-place
 *   node scripts/sample-onset-trim.mjs \
 *     public/samples/recorder/philharmonia-flute \
 *     --trim-ms 25 --in-place
 *
 *   # Manually trim a single file by 30 ms, in-place
 *   node scripts/sample-onset-trim.mjs \
 *     public/samples/recorder/philharmonia-flute/flute_A6_1_forte_normal.mp3 \
 *     --trim-ms 30 --in-place
 *
 *   # Tighter auto-detect threshold, directory mode
 *   node scripts/sample-onset-trim.mjs \
 *     public/samples/recorder/philharmonia-flute \
 *     --in-place --threshold-db -55 --pre-roll-ms 3
 */

import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// ── ANSI colours (same palette as audio-loudness-helper.mjs) ─────────────────
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

// ── CLI argument parsing ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    input: null, // file or directory path (positional)
    trimMs: null, // manual trim amount; null = auto-detect
    thresholdDb: -50,
    preRollMs: 5,
    minTrimMs: 10,
    outputDir: null,
    inPlace: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--in-place") opts.inPlace = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--trim-ms") opts.trimMs = parseFloat(args[++i]);
    else if (a === "--threshold-db") opts.thresholdDb = parseFloat(args[++i]);
    else if (a === "--pre-roll-ms") opts.preRollMs = parseFloat(args[++i]);
    else if (a === "--min-trim-ms") opts.minTrimMs = parseFloat(args[++i]);
    else if (a === "--output-dir") opts.outputDir = args[++i];
    else if (!a.startsWith("--")) opts.input = a;
  }
  return opts;
}

// ── Usage ─────────────────────────────────────────────────────────────────────
function printUsage() {
  console.error(
    [
      "",
      col(C.bold, "Usage:"),
      "  node scripts/sample-onset-trim.mjs <dir-or-file>  [options]",
      "",
      col(C.bold, "Input:"),
      "  <dir>   Directory containing index.json — processes all mapped samples",
      "  <file>  Single audio file — processes just that file",
      "",
      col(C.bold, "Options:"),
      "  --trim-ms       FLOAT  Trim exactly this many ms (skips auto-detection)",
      "  --threshold-db  FLOAT  Silence threshold in dBFS      (default: -50)",
      "  --pre-roll-ms   FLOAT  Ms of audio kept before onset  (default: 5)",
      "  --min-trim-ms   FLOAT  Skip if onset < this ms        (default: 10)",
      "  --output-dir    PATH   Output path",
      "  --in-place             Overwrite original file(s)",
      "  --dry-run              Print report only, no files written",
      "",
      col(C.bold, "Examples:"),
      "  # Inspect directory",
      "  node scripts/sample-onset-trim.mjs public/samples/recorder/philharmonia-flute --dry-run",
      "",
      "  # Auto-trim directory to _trimmed/ subfolder",
      "  node scripts/sample-onset-trim.mjs public/samples/recorder/philharmonia-flute",
      "",
      "  # Auto-trim single file",
      "  node scripts/sample-onset-trim.mjs public/samples/recorder/philharmonia-flute/flute_E4_1_forte_normal.mp3",
      "",
      "  # Manual trim — single file, in-place",
      "  node scripts/sample-onset-trim.mjs public/samples/recorder/philharmonia-flute/flute_A6_1_forte_normal.mp3 --trim-ms 30 --in-place",
      "",
      "  # Manual trim — whole directory, in-place",
      "  node scripts/sample-onset-trim.mjs public/samples/recorder/philharmonia-flute --trim-ms 20 --in-place",
      "",
    ].join("\n"),
  );
}

// ── Pre-flight: verify ffmpeg is available ────────────────────────────────────
function requireFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (r.error) {
    console.error(
      col(C.red, "✖  ffmpeg not found. Install with: brew install ffmpeg"),
    );
    process.exit(1);
  }
}

// ── Note label inference from filename ───────────────────────────────────────
/**
 * Try to extract a note name from a filename using common sampler conventions.
 * Philharmonia uses "As4" for A#4, "Cs5" for C#5, etc.
 * Falls back to the bare filename stem if no match is found.
 *
 * @param {string} filename  e.g. "flute_E4_1_forte_normal.mp3"
 * @returns {string}         e.g. "E4"
 */
function noteFromFilename(filename) {
  const stem = path.basename(filename, path.extname(filename));
  // Match _<Note><octave>_ pattern  (As4, E4, Cs7, etc.)
  const m = stem.match(/_([A-G]s?\d)(?:_|$)/i);
  if (m) {
    // Convert Philharmonia "s" suffix to sharp "#"
    return m[1].replace(
      /([A-G])s(\d)/i,
      (_, n, o) => `${n.toUpperCase()}#${o}`,
    );
  }
  // Fallback: return the whole stem (better than nothing)
  return stem;
}

// ── Onset detection via silencedetect ────────────────────────────────────────
/**
 * Run ffmpeg silencedetect on a file and return the duration of leading
 * silence in milliseconds.  Returns 0 if the file does not start with silence.
 *
 * The silencedetect filter emits events to stderr in the form:
 *   [silencedetect] silence_start: 0
 *   [silencedetect] silence_end: 0.1423 | silence_duration: 0.1423
 *
 * We look for a silence_start at or very near time 0 (within 10 ms to
 * account for encoder padding), then read the corresponding silence_end.
 *
 * @param {string} filePath
 * @param {number} thresholdDb      e.g. -50  (quieter = silence)
 * @param {number} minDurationS     minimum silence duration to count
 * @returns {number}                leading silence in ms, or 0
 */
function detectLeadingSilenceMs(filePath, thresholdDb, minDurationS = 0.005) {
  const filter = `silencedetect=noise=${thresholdDb}dB:d=${minDurationS}`;

  const result = spawnSync(
    "ffmpeg",
    ["-i", filePath, "-af", filter, "-f", "null", "-"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  const stderr = result.stderr ?? "";

  const starts = [...stderr.matchAll(/silence_start:\s*([\d.eE+\-]+)/g)].map(
    (m) => parseFloat(m[1]),
  );
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.eE+\-]+)/g)].map((m) =>
    parseFloat(m[1]),
  );

  if (starts.length === 0 || ends.length === 0) return 0;

  // Only count leading silence — block must start at the very beginning of the
  // file (≤ 10 ms; covers encoder / container padding).
  if (starts[0] > 0.01) return 0;

  const endSec = ends[0];
  if (!Number.isFinite(endSec) || endSec <= 0) return 0;

  return endSec * 1000;
}

// ── Trimming via ffmpeg atrim ─────────────────────────────────────────────────
/**
 * Trim srcPath, discarding everything before startSec, and write to dstPath.
 *
 * Uses the atrim audio filter for sample-accurate trimming regardless of
 * MP3 frame boundaries.  asetpts resets stream timestamps to start at 0.
 *
 * @param {string} srcPath
 * @param {number} startSec    seconds to skip from the start
 * @param {string} dstPath
 * @returns {boolean}          true on success
 */
function trimFile(srcPath, startSec, dstPath) {
  const ext = path.extname(srcPath).toLowerCase();
  const tmpPath = path.join(os.tmpdir(), `onset_trim_${Date.now()}${ext}`);
  const filter = `atrim=start=${startSec.toFixed(6)},asetpts=PTS-STARTPTS`;

  const result = spawnSync(
    "ffmpeg",
    ["-y", "-i", srcPath, "-af", filter, ...codecArgsFor(ext), tmpPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  if (result.status !== 0) {
    console.error(
      col(C.red, `\n  ✖  Encode failed: ${path.basename(srcPath)}`),
    );
    console.error(col(C.grey, (result.stderr ?? "").slice(-400)));
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    return false;
  }

  try {
    fs.copyFileSync(tmpPath, dstPath);
    fs.unlinkSync(tmpPath);
  } catch (err) {
    console.error(col(C.red, `\n  ✖  Could not write output: ${err.message}`));
    return false;
  }

  return true;
}

/** Returns ffmpeg codec/quality args for the given file extension. */
function codecArgsFor(ext) {
  switch (ext) {
    case ".mp3":
      return ["-codec:a", "libmp3lame", "-q:a", "2"];
    case ".ogg":
      return ["-codec:a", "libvorbis", "-q:a", "5"];
    case ".flac":
      return ["-codec:a", "flac"];
    case ".m4a":
      return ["-codec:a", "aac", "-b:a", "192k"];
    case ".aiff":
      return ["-codec:a", "pcm_s16be"];
    case ".wav":
    default:
      return ["-codec:a", "pcm_s16le"];
  }
}

// ── Table rendering ───────────────────────────────────────────────────────────
function onsetLabel(ms) {
  const s = `${ms.toFixed(1).padStart(6)} ms`;
  if (ms < 10) return col(C.green, s);
  if (ms < 50) return col(C.yellow, s);
  return col(C.red, s);
}

function printTable(rows) {
  const NOTE_W = 5;
  const FILE_W = Math.min(
    52,
    Math.max(...rows.map((r) => r.filename.length), 4),
  );

  console.log(
    col(C.bold, "NOTE".padEnd(NOTE_W)) +
      "  " +
      col(C.bold, "FILE".padEnd(FILE_W)) +
      "  " +
      col(C.bold, "  ONSET") +
      "  " +
      col(C.bold, "STATUS"),
  );
  console.log(col(C.grey, "─".repeat(NOTE_W + 2 + FILE_W + 2 + 9 + 2 + 20)));

  for (const { note, filename, silenceMs, willTrim, missing, manual } of rows) {
    const noteCol = note.padEnd(NOTE_W);
    const fileCol =
      filename.length > FILE_W
        ? "…" + filename.slice(-(FILE_W - 1))
        : filename.padEnd(FILE_W);

    if (missing) {
      console.log(`${noteCol}  ${fileCol}  ${col(C.red, "file not found")}`);
      continue;
    }

    const onset = onsetLabel(silenceMs);
    const tag = manual ? col(C.cyan, "manual") : "";
    const status = willTrim
      ? col(C.yellow, `→ trim ${silenceMs.toFixed(1)} ms`) +
        (tag ? `  ${tag}` : "")
      : col(C.green, "OK");

    console.log(`${noteCol}  ${fileCol}  ${onset}  ${status}`);
  }
}

// ── Shared trim + copy logic ───────────────────────────────────────────────────
/**
 * Apply trims for all rows that need it, then (in directory mode) copy
 * unchanged files and write index.json to the output dir.
 *
 * @param {object[]} rows
 * @param {object}   opts
 * @param {string}   outputDir
 * @param {object|null} index       null in single-file mode
 * @param {boolean}  isSingleFile
 */
function applyTrims(rows, opts, outputDir, index, isSingleFile) {
  const toTrim = rows.filter((r) => r.willTrim && !r.missing);

  if (toTrim.length === 0) {
    console.log(
      col(C.green, "\nAll samples already start cleanly — nothing to trim."),
    );
    return;
  }

  if (!opts.inPlace) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\nTrimming ${col(C.bold, String(toTrim.length))} file(s)…\n`);

  let ok = 0,
    fail = 0;

  for (const { note, filename, filePath, silenceMs, dstPath } of toTrim) {
    const startSec = silenceMs / 1000;
    const label = `${note.padEnd(4)}  ${filename}`;
    const detail = col(C.grey, `(−${silenceMs.toFixed(1)} ms)`);

    process.stdout.write(`  ${col(C.grey, "…")}  ${label}  ${detail}`);

    const success = trimFile(filePath, startSec, dstPath);

    if (success) {
      process.stdout.write(`\r  ${col(C.green, "✔")}  ${label}  ${detail}\n`);
      ok++;
    } else {
      process.stdout.write(`\r  ${col(C.red, "✖")}  ${label}\n`);
      fail++;
    }
  }

  // In directory mode: copy untrimmed files and write index.json so the
  // output dir is a self-contained, complete sample set.
  if (!opts.inPlace && !isSingleFile) {
    const untrimmed = rows.filter((r) => !r.willTrim && !r.missing);

    if (untrimmed.length > 0) {
      console.log(
        `\nCopying ${col(C.bold, String(untrimmed.length))} unchanged file(s) to output dir…`,
      );
      for (const { note, filename, filePath, dstPath } of untrimmed) {
        try {
          fs.copyFileSync(filePath, dstPath);
          console.log(`  ${col(C.grey, "·")}  ${note.padEnd(4)}  ${filename}`);
        } catch (err) {
          console.error(
            `  ${col(C.red, "✖")}  ${note.padEnd(4)}  ${err.message}`,
          );
        }
      }
    }

    if (index) {
      const outIndexPath = path.join(outputDir, "index.json");
      fs.writeFileSync(outIndexPath, JSON.stringify(index, null, 2) + "\n");
      console.log(`\n${col(C.grey, "Wrote")} index.json → ${outIndexPath}`);
    }
  }

  console.log(
    `\n${col(C.green, `✔ ${ok} trimmed`)}` +
      (fail > 0 ? `  ${col(C.red, `✖ ${fail} failed`)}` : "") +
      "\n",
  );

  if (!opts.inPlace) {
    if (isSingleFile) {
      const firstDst = toTrim[0]?.dstPath;
      if (firstDst) console.log(col(C.cyan, `Output: ${firstDst}\n`));
    } else {
      console.log(
        col(C.cyan, `Output: ${outputDir}`) +
          "\n" +
          col(
            C.grey,
            "Tip: inspect the _trimmed/ folder before replacing the originals.\n" +
              "     Rerun with --in-place once you are happy with the results.",
          ) +
          "\n",
      );
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv);

  if (!opts.input) {
    printUsage();
    process.exit(1);
  }

  requireFfmpeg();

  const inputResolved = path.resolve(opts.input);

  if (!fs.existsSync(inputResolved)) {
    console.error(col(C.red, `Not found: ${inputResolved}`));
    process.exit(1);
  }

  const stat = fs.statSync(inputResolved);

  // ── Determine mode: single file or directory ─────────────────────────────
  const isSingleFile = stat.isFile();

  // ── Build entries list ───────────────────────────────────────────────────
  let entries; // [{ note, filename, filePath }]
  let index = null;
  let sampleDir;

  if (isSingleFile) {
    // Single-file mode: derive note label from the filename
    sampleDir = path.dirname(inputResolved);
    const filename = path.basename(inputResolved);
    const note = noteFromFilename(filename);
    entries = [{ note, filename, filePath: inputResolved }];
  } else {
    // Directory mode: read index.json
    sampleDir = inputResolved;
    const indexPath = path.join(sampleDir, "index.json");

    if (!fs.existsSync(indexPath)) {
      console.error(col(C.red, `index.json not found in: ${sampleDir}`));
      console.error(
        col(C.grey, 'Expected format: { "C4": "filename.mp3", ... }'),
      );
      process.exit(1);
    }

    try {
      index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    } catch (err) {
      console.error(col(C.red, `Failed to parse index.json: ${err.message}`));
      process.exit(1);
    }

    const pairs = Object.entries(index);
    if (pairs.length === 0) {
      console.log(col(C.yellow, "index.json is empty — nothing to do."));
      return;
    }

    entries = pairs.map(([note, filename]) => ({
      note,
      filename,
      filePath: path.join(sampleDir, filename),
    }));
  }

  // ── Resolve output directory / paths ─────────────────────────────────────
  let outputDir;

  if (opts.inPlace) {
    outputDir = sampleDir;
  } else if (opts.outputDir) {
    outputDir = path.resolve(opts.outputDir);
  } else if (isSingleFile) {
    // Adjacent sibling file — output dir is the same directory
    outputDir = sampleDir;
  } else {
    outputDir = path.join(sampleDir, "_trimmed");
  }

  // Compute the destination path for each entry.
  // Single-file non-in-place → <stem>_trimmed.<ext>
  // Everything else         → <outputDir>/<filename>  (same name)
  const dstFor = (filename) => {
    if (isSingleFile && !opts.inPlace && !opts.outputDir) {
      const ext = path.extname(filename);
      const stem = path.basename(filename, ext);
      return path.join(outputDir, `${stem}_trimmed${ext}`);
    }
    return path.join(outputDir, filename);
  };

  // ── Configuration banner ─────────────────────────────────────────────────
  console.log();

  if (isSingleFile) {
    console.log(col(C.cyan, `File        : ${inputResolved}`));
  } else {
    console.log(col(C.cyan, `Sample dir  : ${sampleDir}`));
    console.log(`Samples     : ${entries.length}`);
  }

  if (opts.trimMs !== null) {
    console.log(col(C.cyan, `Trim mode   : manual — ${opts.trimMs} ms`));
  } else {
    console.log(`Trim mode   : auto-detect`);
    console.log(`Threshold   : ${opts.thresholdDb} dBFS`);
    console.log(
      `Pre-roll    : ${opts.preRollMs} ms  (kept before detected onset)`,
    );
    console.log(
      `Min trim    : ${opts.minTrimMs} ms  (files with less onset are skipped)`,
    );
  }

  if (opts.dryRun) {
    console.log(
      col(C.yellow, "Mode        : DRY RUN — no files will be written"),
    );
  } else if (opts.inPlace) {
    console.log(
      col(C.red, "Mode        : IN-PLACE — originals will be overwritten"),
    );
  } else {
    if (isSingleFile && !opts.outputDir) {
      console.log(`Output      : <same dir>/<stem>_trimmed.<ext>`);
    } else {
      console.log(`Output dir  : ${outputDir}`);
    }
  }

  // ── Analyse each file ────────────────────────────────────────────────────
  const isManual = opts.trimMs !== null;
  const showProgress = entries.length > 1;

  if (!isManual) {
    console.log(
      `\nAnalysing ${col(C.bold, String(entries.length))} sample(s)…\n`,
    );
  } else {
    console.log();
  }

  const rows = [];

  for (let i = 0; i < entries.length; i++) {
    const { note, filename, filePath } = entries[i];

    if (showProgress && !isManual) {
      process.stdout.write(
        `\r${col(C.grey, `[${i + 1}/${entries.length}]`)} ${note.padEnd(4)} ${filename}${"  ".repeat(5)}`,
      );
    }

    if (!fs.existsSync(filePath)) {
      rows.push({
        note,
        filename,
        filePath,
        dstPath: dstFor(filename),
        silenceMs: 0,
        rawSilenceMs: 0,
        willTrim: false,
        missing: true,
        manual: false,
      });
      continue;
    }

    let silenceMs;
    let rawSilenceMs;

    if (isManual) {
      // Manual mode: use the exact value the user specified, no pre-roll deduction
      silenceMs = opts.trimMs;
      rawSilenceMs = opts.trimMs;
    } else {
      // Auto-detect
      rawSilenceMs = detectLeadingSilenceMs(filePath, opts.thresholdDb, 0.005);
      silenceMs = Math.max(0, rawSilenceMs - opts.preRollMs);
    }

    const willTrim = silenceMs >= opts.minTrimMs;

    rows.push({
      note,
      filename,
      filePath,
      dstPath: dstFor(filename),
      silenceMs,
      rawSilenceMs,
      willTrim,
      missing: false,
      manual: isManual,
    });
  }

  if (showProgress && !isManual) {
    process.stdout.write("\r" + " ".repeat(80) + "\r");
  }

  // ── Results table ────────────────────────────────────────────────────────
  printTable(rows);
  console.log();

  // ── Summary stats (directory mode only) ─────────────────────────────────
  if (!isSingleFile) {
    const toTrim = rows.filter((r) => r.willTrim && !r.missing);
    const clean = rows.filter((r) => !r.willTrim && !r.missing);
    const missing = rows.filter((r) => r.missing);

    if (!isManual) {
      const validMs = rows.filter((r) => !r.missing).map((r) => r.rawSilenceMs);
      const avgMs = validMs.length
        ? validMs.reduce((a, b) => a + b, 0) / validMs.length
        : 0;
      const maxMs = validMs.length ? Math.max(...validMs) : 0;
      const minMs = validMs.length ? Math.min(...validMs) : 0;

      console.log(
        `Onset range : ${minMs.toFixed(1)} ms – ${maxMs.toFixed(1)} ms` +
          `  (avg ${avgMs.toFixed(1)} ms)`,
      );
    }

    console.log(
      `Files       : ` +
        col(C.yellow, `${toTrim.length} to trim`) +
        `  ·  ` +
        col(C.green, `${clean.length} already clean`) +
        (missing.length
          ? `  ·  ` + col(C.red, `${missing.length} missing`)
          : ""),
    );

    if (missing.length) {
      console.log(col(C.red, "\nMissing files:"));
      for (const r of missing) {
        console.log(col(C.red, `  ${r.note.padEnd(4)}  ${r.filename}`));
      }
    }
  }

  if (opts.dryRun) {
    console.log(
      col(C.yellow, "\nDry run complete — rerun without --dry-run to apply."),
    );
    return;
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  applyTrims(rows, opts, outputDir, index, isSingleFile);
}

main();
