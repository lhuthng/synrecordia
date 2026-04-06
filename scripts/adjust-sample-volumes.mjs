#!/usr/bin/env node
/**
 * adjust-sample-volumes.mjs
 *
 * CLI: node adjust-sample-volumes.mjs <input-folder-or-index.json> [--list] [--adjust <dB>] [--ext mp3,wav] [--dry-run]
 *
 * Behavior:
 * - If the first positional argument is a JSON file named `index.json` (or any .json),
 *   it's treated as an index mapping note -> filename (relative paths resolved
 *   against the index.json location). Example index format:
 *     { "A4": "flute_A4_1_forte_normal.mp3", ... }
 *
 * - Otherwise the positional argument is treated as a directory. The script will
 *   scan that directory (non-recursively) and operate on audio files matching the
 *   provided extensions.
 *
 * Modes:
 *   --list                 Measure and print true-peak (dBFS) for every resolved file.
 *   --adjust <dB>          Apply a relative gain (+ or - dB) to every resolved file.
 *   --dry-run              When used with --adjust, shows actions without writing files.
 *   --ext <list>           Comma-separated extensions (default: mp3,wav,ogg,flac,m4a,aiff)
 *   --help                 Show usage
 *
 * Notes:
 * - Requires ffmpeg available on PATH.
 * - Measurement uses ffmpeg's ebur128 filter with peak=true (true-peak dBFS).
 * - Adjusting uses ffmpeg volume filter and writes a temp file then replaces the original.
 * - Use --dry-run to preview changes; consider backing up files before modifying.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";

// ANSI colours (lightweight)
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

function usage() {
  console.log(`
Usage:
  node adjust-sample-volumes.mjs <index.json|folder> [--list] [--adjust <dB>] [--dry-run] [--ext mp3,wav]

Examples:
  # Measure peaks for files listed in an index.json
  node adjust-sample-volumes.mjs public/samples/recorder/philharmonia-flute/index.json --list

  # Measure peaks for all audio files in a folder
  node adjust-sample-volumes.mjs public/samples/recorder/philharmonia-flute --list

  # Lower every indexed file by 3 dB (dry run)
  node adjust-sample-volumes.mjs public/samples/recorder/philharmonia-flute --adjust -3 --dry-run

  # Apply +1.5 dB to all wav/mp3 files in a folder
  node adjust-sample-volumes.mjs public/samples/recorder/philharmonia-flute --adjust 1.5 --ext mp3,wav

Flags:
  --list         Measure & print true-peak (dBFS) for every resolved file.
  --adjust <dB>  Apply a relative gain (positive or negative) to all resolved files.
  --dry-run      With --adjust: show what would be done without changing files.
  --ext <exts>   Comma-separated extensions (default: mp3,wav,ogg,flac,m4a,aiff)
  --help         Show this message
`);
  process.exit(0);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) usage();

  const opts = {
    input: null, // index.json path or directory
    list: false,
    adjust: null, // number in dB
    dryRun: false,
    extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aiff"],
  };

  // First non-flag is input
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (!a.startsWith("--") && opts.input === null) {
      opts.input = a;
      i++;
      continue;
    }
    if (a === "--list") {
      opts.list = true;
      i++;
      continue;
    }
    if (a === "--adjust") {
      opts.adjust = parseFloat(args[i + 1]);
      i += 2;
      continue;
    }
    if (a === "--dry-run") {
      opts.dryRun = true;
      i++;
      continue;
    }
    if (a === "--ext") {
      opts.extensions = args[i + 1]
        .split(",")
        .map((s) => s.trim().toLowerCase());
      i += 2;
      continue;
    }
    if (a === "--help") usage();
    // unknown flag
    console.error(col(C.yellow, `Unknown option: ${a}`));
    usage();
  }

  if (!opts.input) usage();
  if (!opts.list && opts.adjust === null) {
    console.error(col(C.red, "Please supply at least --list or --adjust <dB>"));
    usage();
  }

  return opts;
}

function requireFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (r.error) {
    console.error(
      col(
        C.red,
        "✖ ffmpeg not found. Please install ffmpeg and ensure it is on your PATH.",
      ),
    );
    process.exit(1);
  }
}

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

// Measure true peak (dBFS) using ffmpeg's ebur128=peak=true
function measureTruePeak(filePath) {
  // Primary method: ebur128 (true peak)
  const r = spawnSync(
    "ffmpeg",
    [
      "-nostats",
      "-i",
      filePath,
      "-filter:a",
      "ebur128=peak=true",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const stderr = r.stderr || "";
  const matches = [...stderr.matchAll(/Peak:\s*([\-0-9.]+)\s*dBFS/gi)];
  if (matches.length) {
    const peaks = matches.map((m) => parseFloat(m[1]));
    return Math.max(...peaks);
  }

  // Fallback: use volumedetect's max_volume if ebur128 produced no peak info.
  // volumedetect reports a line like: "max_volume: -0.3 dB"
  const r2 = spawnSync(
    "ffmpeg",
    ["-nostats", "-i", filePath, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const stderr2 = r2.stderr || "";
  const m2 = stderr2.match(/max_volume:\s*([\-0-9.]+)\s*dB/i);
  if (m2) {
    return parseFloat(m2[1]);
  }

  // If neither method yields a value, give up.
  return null;
}

function applyGain(filePath, gainDb) {
  const ext = path.extname(filePath).toLowerCase() || ".wav";
  const tmp = path.join(os.tmpdir(), `asv_tmp_${Date.now()}${ext}`);
  const filter = `volume=${gainDb.toFixed(4)}dB`;
  const codec = codecArgsFor(ext);

  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", filePath, "-filter:a", filter, ...codec, tmp],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  if (r.status !== 0) {
    console.error(col(C.red, `✖ ffmpeg failed for ${filePath}`));
    console.error(col(C.grey, (r.stderr || "").slice(-400)));
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (e) {}
    return false;
  }

  try {
    fs.copyFileSync(tmp, filePath);
    fs.unlinkSync(tmp);
    return true;
  } catch (err) {
    console.error(
      col(C.red, `✖ Could not replace original ${filePath}: ${err.message}`),
    );
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (e) {}
    return false;
  }
}

function collectFilesFromIndex(indexPath, extensions) {
  const abs = path.resolve(indexPath);
  if (!fs.existsSync(abs)) {
    console.error(col(C.red, `Index file not found: ${abs}`));
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    console.error(col(C.red, `Failed to read/parse JSON: ${e.message}`));
    process.exit(1);
  }
  const base = path.dirname(abs);
  const files = [];
  for (const v of Object.values(data)) {
    if (typeof v !== "string") continue;
    const full = path.join(base, v);
    const ext = path.extname(full).replace(".", "").toLowerCase();
    if (!extensions.includes(ext)) continue;
    if (!fs.existsSync(full)) {
      console.warn(col(C.yellow, `Warning: listed file missing: ${full}`));
      continue;
    }
    files.push(full);
  }
  return files;
}

function collectFilesFromDirectory(dir, extensions) {
  const full = path.resolve(dir);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
    console.error(col(C.red, `Directory not found: ${full}`));
    process.exit(1);
  }
  const extSet = new Set(extensions.map((e) => `.${e}`));
  const entries = fs.readdirSync(full);
  const results = [];
  for (const e of entries) {
    const p = path.join(full, e);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && extSet.has(path.extname(e).toLowerCase()))
        results.push(p);
    } catch {}
  }
  return results.sort();
}

function peakLabel(db) {
  if (db === null) return col(C.grey, "   N/A  ");
  const s = db.toFixed(1).padStart(7) + " dBFS";
  if (db > -1) return col(C.red, s);
  if (db > -6) return col(C.yellow, s);
  return col(C.green, s);
}

function printTable(rows) {
  const maxPath = Math.min(90, Math.max(...rows.map((r) => r.path.length), 4));
  console.log(
    "\n" +
      col(C.bold, "FILE".padEnd(maxPath)) +
      "  " +
      col(C.bold, "PEAK") +
      "\n" +
      col(C.grey, "─".repeat(maxPath + 20)),
  );
  for (const r of rows) {
    const truncated =
      r.path.length > maxPath
        ? "…" + r.path.slice(-(maxPath - 1))
        : r.path.padEnd(maxPath);
    console.log(`${truncated}  ${peakLabel(r.peak)}`);
  }
  console.log();
}

function exitWith(msg) {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv);
  requireFfmpeg();

  // Determine whether input is a JSON index or a directory
  const inputPath = opts.input;
  const isJson = path.extname(inputPath).toLowerCase() === ".json";
  let files = [];

  if (isJson) {
    files = collectFilesFromIndex(inputPath, opts.extensions);
  } else {
    // If a directory contains an index.json, prefer using it (keeps mapping semantics)
    const candidateIndex = path.join(path.resolve(inputPath), "index.json");
    if (fs.existsSync(candidateIndex)) {
      console.log(
        col(C.cyan, `Found index.json in folder; using it: ${candidateIndex}`),
      );
      files = collectFilesFromIndex(candidateIndex, opts.extensions);
    } else {
      files = collectFilesFromDirectory(inputPath, opts.extensions);
    }
  }

  if (files.length === 0) {
    console.log(
      col(
        C.yellow,
        "No audio files found for the provided input and extensions.",
      ),
    );
    process.exit(0);
  }

  // Measure true peaks
  console.log(col(C.cyan, `\nMeasuring ${files.length} file(s)...\n`));
  const measurements = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    process.stdout.write(
      `\r${col(C.grey, `[${i + 1}/${files.length}]`)} ${path.basename(f)}            `,
    );
    const peak = measureTruePeak(f);
    measurements.push({ file: f, peak });
  }
  process.stdout.write("\r" + " ".repeat(120) + "\r");

  if (opts.list) {
    const rows = measurements.map((m) => ({
      path: path.relative(process.cwd(), m.file),
      peak: m.peak,
    }));
    printTable(rows);
  }

  if (opts.adjust !== null) {
    const gain = Number(opts.adjust);
    if (Number.isNaN(gain))
      exitWith(col(C.red, "Invalid --adjust value (must be a number)"));
    console.log(
      col(
        C.cyan,
        `${opts.dryRun ? "[DRY RUN] " : ""}Applying ${gain >= 0 ? "+" : ""}${gain} dB to ${measurements.length} file(s)\n`,
      ),
    );

    let ok = 0,
      fail = 0;
    for (let i = 0; i < measurements.length; i++) {
      const { file, peak } = measurements[i];
      const rel = path.relative(process.cwd(), file);
      const before = peak === null ? "N/A" : `${peak.toFixed(1)} dBFS`;
      const expectedAfter =
        peak === null ? "N/A" : `${(peak + gain).toFixed(1)} dBFS`;

      if (opts.dryRun) {
        console.log(
          `  ${col(C.cyan, "~")}  ${rel}  ${col(C.grey, before + " → " + expectedAfter)}`,
        );
        ok++;
        continue;
      }

      process.stdout.write(
        `  ${col(C.grey, "…")}  ${rel}  ${col(C.grey, before + " → " + expectedAfter)}`,
      );
      const success = applyGain(file, gain);
      if (success) {
        // Re-measure for confirmation (best-effort)
        const after = measureTruePeak(file);
        const afterLabel = after === null ? "N/A" : `${after.toFixed(1)} dBFS`;
        process.stdout.write(
          `\r  ${col(C.green, "✔")}  ${rel}  ${col(C.grey, before + " → " + afterLabel)}\n`,
        );
        ok++;
      } else {
        process.stdout.write(`\r  ${col(C.red, "✖")}  ${rel}\n`);
        fail++;
      }
    }

    console.log(
      `\n${col(C.green, `✔ ${ok} processed`)}${fail ? `  ${col(C.red, `✖ ${fail} failed`)}` : ""}\n`,
    );
  }
}

main();
