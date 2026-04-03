#!/usr/bin/env node
/**
 * audio-loudness-helper.mjs
 *
 * Scans a directory tree for audio files (.mp3, .wav, .ogg, .flac, .aiff, .m4a)
 * and measures / normalises their peak loudness using ffmpeg.
 *
 * Measures TRUE PEAK (dBFS) — the loudest moment in the file — which is the
 * correct metric for instrument samples and short clips. Integrated LUFS
 * (time-averaged) is useless for samples because silence padding drags the
 * average down to nonsense values like −70.
 *
 * Requires: ffmpeg installed and on PATH.
 *
 * Usage:
 *   node audio-loudness-helper.mjs <path> --list
 *   node audio-loudness-helper.mjs <path> --list --above -1
 *   node audio-loudness-helper.mjs <path> --fix  --above -1
 *   node audio-loudness-helper.mjs <path> --fix  --above -1  --target -3
 *
 * Flags:
 *   --list             Print peak level of every discovered audio file.
 *   --above <dBFS>     Filter: only act on files whose true peak exceeds this value.
 *                      (e.g. --above -1 catches files that are clipping or near-clipping)
 *   --fix              Re-encode files that exceed --above, scaling peak to --target.
 *   --target <dBFS>    Target true peak for --fix (default: -3 dBFS).
 *   --ext <exts>       Comma-separated extensions (default: mp3,wav,ogg,flac,aiff,m4a).
 *   --dry-run          With --fix: show what would be done without changing files.
 *
 * The --list flag shows a table:
 *   PATH | PEAK dBFS | → TARGET dBFS  (last column only with --fix)
 */

import { execSync, spawnSync } from "child_process";
import fs   from "fs";
import os   from "os";
import path from "path";

// ── ANSI colours ──────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  grey:   "\x1b[90m",
};
const col = (c, s) => `${c}${s}${C.reset}`;

// ── CLI argument parsing ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    targetDir: null,
    list:      false,
    fix:       false,
    above:     null,   // dBFS peak threshold (number or null)
    target:    -3,     // dBFS true peak target for normalisation
    extensions: ["mp3", "wav", "ogg", "flac", "aiff", "m4a"],
    dryRun:    false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if      (a === "--list")    opts.list   = true;
    else if (a === "--fix")     opts.fix    = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--above")   { opts.above  = parseFloat(args[++i]); }
    else if (a === "--target")  { opts.target = parseFloat(args[++i]); }
    else if (a === "--ext")     { opts.extensions = args[++i].split(",").map(e => e.trim().toLowerCase()); }
    else if (!a.startsWith("--")) opts.targetDir = a;
  }
  return opts;
}

// ── Pre-flight checks ─────────────────────────────────────────────────────────
function requireFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (r.error) {
    console.error(col(C.red, "✖  ffmpeg not found. Please install ffmpeg and ensure it is on your PATH."));
    process.exit(1);
  }
}

// ── Directory walk ────────────────────────────────────────────────────────────
function collectAudioFiles(dir, extensions) {
  const results = [];
  const extSet  = new Set(extensions.map(e => `.${e}`));

  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current); }
    catch { return; }

    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = path.join(current, entry);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        walk(full);
      } else if (extSet.has(path.extname(entry).toLowerCase())) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

// ── Loudness measurement (true peak dBFS) ─────────────────────────────────────
/**
 * Returns the true peak level in dBFS for a file, or null on error.
 *
 * Uses the `ebur128` filter with peak=true, then reads the "True peak" summary
 * line. This reflects the loudest moment in the file regardless of duration,
 * making it correct for samples, one-shots, and instrument recordings.
 *
 * @param {string} filePath
 * @returns {number|null}  e.g. -0.3, -6.1
 */
function measureLoudness(filePath) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-nostats",
      "-i", filePath,
      "-filter:a", "ebur128=peak=true",
      "-f", "null",
      "-",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );

  const stderr = result.stderr || "";

  // The summary block contains a line like:
  //   True peak:
  //       Peak: -0.3 dBFS
  // We want the highest peak across all channels — take the maximum value found.
  const peakMatches = [...stderr.matchAll(/Peak:\s*([-\d.]+)\s*dBFS/gi)];
  if (!peakMatches.length) return null;

  const peaks = peakMatches.map(m => parseFloat(m[1]));
  return Math.max(...peaks);
}

// ── Normalisation (peak gain scaling) ────────────────────────────────────────
/**
 * Re-encodes `filePath` applying a linear gain so its true peak equals targetDBFS.
 * This is a single-pass operation — we know the current peak, so we calculate
 * the exact gain needed: gain_dB = targetDBFS - currentPeakDBFS.
 *
 * Writes to a temp file then replaces the original atomically.
 *
 * @param {string} filePath
 * @param {number} currentPeak   measured true peak in dBFS
 * @param {number} targetDBFS    desired true peak in dBFS
 * @returns {boolean}
 */
function fixLoudness(filePath, currentPeak, targetDBFS) {
  const ext     = path.extname(filePath).toLowerCase();
  const tmpFile = path.join(os.tmpdir(), `alh_tmp_${Date.now()}${ext}`);

  const gainDB     = targetDBFS - currentPeak;
  const filterStr  = `volume=${gainDB.toFixed(4)}dB`;
  const codecArgs  = codecArgsFor(ext);

  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i", filePath,
      "-filter:a", filterStr,
      ...codecArgs,
      tmpFile,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );

  if (result.status !== 0) {
    console.error(col(C.red, `  ✖  Encode failed for: ${filePath}`));
    console.error(col(C.grey, result.stderr?.slice(-400)));
    try { fs.unlinkSync(tmpFile); } catch {}
    return false;
  }

  try {
    fs.copyFileSync(tmpFile, filePath);
    fs.unlinkSync(tmpFile);
  } catch (err) {
    console.error(col(C.red, `  ✖  Could not replace original: ${err.message}`));
    return false;
  }

  return true;
}

/** Returns ffmpeg codec/format args suitable for the given extension. */
function codecArgsFor(ext) {
  switch (ext) {
    case ".mp3":  return ["-codec:a", "libmp3lame", "-q:a", "2"];
    case ".ogg":  return ["-codec:a", "libvorbis",  "-q:a", "5"];
    case ".flac": return ["-codec:a", "flac"];
    case ".m4a":  return ["-codec:a", "aac", "-b:a", "192k"];
    case ".aiff": return ["-codec:a", "pcm_s16be"];
    case ".wav":
    default:      return ["-codec:a", "pcm_s16le"];
  }
}

// ── Table helpers ─────────────────────────────────────────────────────────────
function peakLabel(db) {
  if (db === null) return col(C.grey, "   N/A  ");
  const s = db.toFixed(1).padStart(7) + " dBFS";
  if (db > -1)  return col(C.red,    s);  // clipping / near-clip
  if (db > -6)  return col(C.yellow, s);  // hot
  return col(C.green, s);                 // healthy
}

function printTable(rows, showTarget) {
  const maxPath = Math.min(
    80,
    Math.max(...rows.map(r => r.filePath.length), 4)
  );

  const header = [
    col(C.bold, "FILE".padEnd(maxPath)),
    col(C.bold, "  PEAK"),
    showTarget ? col(C.bold, "      → TARGET") : "",
  ].filter(Boolean).join("  ");

  console.log("\n" + header);
  console.log(col(C.grey, "─".repeat(maxPath + (showTarget ? 32 : 18))));

  for (const { filePath, current, target } of rows) {
    const truncated = filePath.length > maxPath
      ? "…" + filePath.slice(-(maxPath - 1))
      : filePath.padEnd(maxPath);

    const parts = [truncated, peakLabel(current)];
    if (showTarget) parts.push(col(C.cyan, (target != null ? `${target.toFixed(1)} dBFS` : "N/A").padStart(12)));
    console.log(parts.join("  "));
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv);

  if (!opts.targetDir) {
    console.error([
      "",
      col(C.bold, "Usage:"),
      "  node audio-loudness-helper.mjs <path> --list",
      "  node audio-loudness-helper.mjs <path> --list --above -1",
      "  node audio-loudness-helper.mjs <path> --fix  --above -1",
      "  node audio-loudness-helper.mjs <path> --fix  --above -1 --target -3",
      "",
      col(C.bold, "Flags:"),
      "  --list             List true peak (dBFS) of every audio file found.",
      "  --above <dBFS>     Filter to files with peak louder than this (e.g. --above -1).",
      "  --fix              Scale files that exceed --above so their peak hits --target.",
      "  --target <dBFS>    Target true peak for --fix (default: -3 dBFS).",
      "  --ext <exts>       Comma-separated extensions (default: mp3,wav,ogg,flac,aiff,m4a).",
      "  --dry-run          Show what --fix would do without changing files.",
      "",
      col(C.bold, "Why peak and not LUFS?"),
      "  Integrated LUFS averages the whole file. A 1-second note with 9 seconds of",
      "  silence reads as −70 LUFS even when the note itself is ear-piercing. True peak",
      "  measures the loudest moment, which is what actually matters for samples.",
      "",
    ].join("\n"));
    process.exit(1);
  }

  if (!opts.list && !opts.fix) {
    console.error(col(C.red, "Please supply at least --list or --fix."));
    process.exit(1);
  }

  requireFfmpeg();

  const fullPath = path.resolve(opts.targetDir);
  if (!fs.existsSync(fullPath)) {
    console.error(`Directory not found: ${fullPath}`);
    process.exit(1);
  }

  console.log(col(C.cyan, `\nScanning: ${fullPath}`));
  console.log(col(C.grey, `Extensions: ${opts.extensions.join(", ")}\n`));

  const files = collectAudioFiles(fullPath, opts.extensions);
  if (files.length === 0) {
    console.log(col(C.yellow, "No audio files found."));
    return;
  }

  console.log(`Found ${col(C.bold, files.length)} audio file(s). Measuring true peak…\n`);

  // ── Measure ────────────────────────────────────────────────────────────────
  const measurements = [];
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    process.stdout.write(
      `\r${col(C.grey, `[${i + 1}/${files.length}]`)} ${path.basename(filePath)}            `
    );
    const peak = measureLoudness(filePath);
    measurements.push({ filePath, current: peak });
  }
  process.stdout.write("\r" + " ".repeat(80) + "\r"); // clear progress line

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = opts.above !== null
    ? measurements.filter(m => m.current !== null && m.current > opts.above)
    : measurements;

  // ── --list ────────────────────────────────────────────────────────────────
  if (opts.list) {
    if (filtered.length === 0) {
      console.log(col(C.green, `No files${opts.above !== null ? ` above ${opts.above} dBFS` : ""} found.`));
    } else {
      if (opts.above !== null) {
        console.log(col(C.yellow, `Files above ${opts.above} dBFS: ${filtered.length}`));
      }
      const rows = filtered.map(m => ({
        filePath: m.filePath,
        current:  m.current,
        target:   opts.fix ? opts.target : null,
      }));
      printTable(rows, opts.fix);
    }
  }

  // ── --fix ─────────────────────────────────────────────────────────────────
  if (opts.fix) {
    if (opts.above === null) {
      console.log(col(C.yellow, "⚠  --fix without --above will normalise ALL files. Use --above to narrow the scope."));
    }

    const toFix = filtered;

    if (toFix.length === 0) {
      console.log(col(C.green, `No files to fix.`));
      return;
    }

    console.log(
      `${opts.dryRun ? col(C.yellow, "[DRY RUN] ") : ""}Fixing ${col(C.bold, toFix.length)} file(s) → target ${opts.target} dBFS peak\n`
    );

    let ok = 0, fail = 0;
    for (const { filePath, current } of toFix) {
      const rel  = path.relative(fullPath, filePath);
      const from = current !== null ? `${current.toFixed(1)} dBFS` : "N/A";
      const to   = `${opts.target.toFixed(1)} dBFS`;

      if (opts.dryRun) {
        console.log(`  ${col(C.cyan, "~")}  ${rel}  ${col(C.grey, from + " → " + to)}`);
        ok++;
        continue;
      }

      process.stdout.write(`  ${col(C.grey, "…")}  ${rel}  ${col(C.grey, from + " → " + to)}`);
      const success = fixLoudness(filePath, current, opts.target);
      if (success) {
        process.stdout.write(`\r  ${col(C.green, "✔")}  ${rel}  ${col(C.grey, from + " → " + to)}\n`);
        ok++;
      } else {
        process.stdout.write(`\r  ${col(C.red, "✖")}  ${rel}\n`);
        fail++;
      }
    }

    console.log(
      `\n${col(C.green, `✔ ${ok} fixed`)}` +
      (fail > 0 ? `  ${col(C.red, `✖ ${fail} failed`)}` : "") +
      "\n"
    );
  }
}

main();
