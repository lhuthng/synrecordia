#!/usr/bin/env node
/**
 * recalculate-note-range.mjs
 * ==========================
 * Reads one or more Synrecordia song JSON files and recalculates the
 * `noteRange` for every track from the actual pitch values found in `actions`.
 *
 * Handles both action shapes:
 *   { type: "note", pitch: "F4",                   ... }   ← single note
 *   { type: "note", pitches: ["D3","F3","A3","D4"], ... }   ← chord
 *
 * The recalculated min/max are written back in-place (unless --dry-run).
 * Non-note action types (e.g. rests, meta) are ignored.
 * The songs/index.json file is automatically skipped.
 *
 * USAGE
 * -----
 *   node scripts/recalculate-note-range.mjs [options] [path ...]
 *
 * ARGUMENTS
 *   path      One or more song JSON files or directories.
 *             Defaults to  public/songs/  when omitted.
 *
 * OPTIONS
 *   --dry-run    Preview changes without writing any files.
 *   --silent     Only print changed files and errors; suppress unchanged output.
 *   --help, -h   Show this help message.
 *
 * EXAMPLES
 *   # Recalculate all songs in the default directory
 *   node scripts/recalculate-note-range.mjs
 *
 *   # Recalculate a single song
 *   node scripts/recalculate-note-range.mjs public/songs/river-flows-in-you.json
 *
 *   # Preview what would change across the whole library
 *   node scripts/recalculate-note-range.mjs public/songs/ --dry-run
 *
 *   # Quiet mode — only show files that were actually updated
 *   node scripts/recalculate-note-range.mjs --silent
 */

import fsp  from "fs/promises";
import path from "path";

// ── ANSI colour helpers ───────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
};

const col = (c, s) => `${C[c]}${s}${C.reset}`;

// ── Note conversion — mirrors src/libs/utils.js exactly ──────────────────────

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Convert a note name string (e.g. "F4", "A#3", "D#5") to a MIDI number.
 * Returns null for unrecognised input.
 */
function noteNameToMidi(name) {
  const match = name?.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return null;
  const [, note, octaveStr] = match;
  const idx = NOTE_NAMES.indexOf(note);
  if (idx === -1) return null;
  const octave = parseInt(octaveStr, 10);
  return (octave + 1) * 12 + idx;
}

/**
 * Convert a MIDI number to a note name string (e.g. 65 → "F4").
 */
function midiToNoteName(midi) {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)));
  const note    = NOTE_NAMES[clamped % 12];
  const octave  = Math.floor(clamped / 12) - 1;
  return `${note}${octave}`;
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Scan an actions array and return { min, max } MIDI numbers, or null if the
 * track contains no note actions with recognisable pitches.
 */
function computeNoteRange(actions) {
  let min = Infinity;
  let max = -Infinity;

  for (const action of actions ?? []) {
    if (action.type !== "note") continue;

    // Normalise to an array — handles both `pitch` and `pitches` fields.
    const pitches = Array.isArray(action.pitches)
      ? action.pitches
      : action.pitch != null
        ? [action.pitch]
        : [];

    for (const p of pitches) {
      const midi = noteNameToMidi(p);
      if (midi !== null) {
        if (midi < min) min = midi;
        if (midi > max) max = midi;
      }
    }
  }

  return min === Infinity ? null : { min, max };
}

/**
 * Process a single song JSON file.
 * Returns { ok: boolean, changed: boolean }.
 */
async function processSong(filePath, { dryRun, silent }) {
  // ── Read & parse ───────────────────────────────────────────────────────────
  let raw;
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch (err) {
    console.error(col("red", `  ✗  Cannot read: ${filePath}\n     ${err.message}`));
    return { ok: false, changed: false };
  }

  let song;
  try {
    song = JSON.parse(raw);
  } catch (err) {
    console.error(col("red", `  ✗  Invalid JSON: ${filePath}\n     ${err.message}`));
    return { ok: false, changed: false };
  }

  if (!Array.isArray(song.tracks)) {
    if (!silent)
      console.log(`  ${col("dim", "·")}  ${col("dim", path.basename(filePath))}  ${col("dim", "(no tracks — skipped)")}`);
    return { ok: true, changed: false };
  }

  // ── Check every track ─────────────────────────────────────────────────────
  const fileLabel   = col("bold", path.basename(filePath));
  const trackLogs   = [];
  let   anyChanged  = false;

  for (const track of song.tracks) {
    const newRange = computeNoteRange(track.actions);
    const trackId  = col("cyan", track.id ?? `track[${song.tracks.indexOf(track)}]`);

    if (!newRange) {
      trackLogs.push(`       ${trackId}  ${col("dim", "(no note actions — skipped)")}`);
      continue;
    }

    const old = track.noteRange ?? {};
    const changed = old.min !== newRange.min || old.max !== newRange.max;

    if (changed) {
      anyChanged = true;

      const oldStr = old.min != null
        ? `${midiToNoteName(old.min)} (${old.min}) – ${midiToNoteName(old.max)} (${old.max})`
        : col("dim", "none");

      const newStr =
        `${midiToNoteName(newRange.min)} (${newRange.min}) – ${midiToNoteName(newRange.max)} (${newRange.max})`;

      trackLogs.push(
        `       ${trackId}\n` +
        `         was : ${col("yellow", oldStr)}\n` +
        `         now : ${col("green",  newStr)}`,
      );

      // Mutate in-place — we serialise the whole object afterwards.
      track.noteRange = newRange;

    } else if (!silent) {
      const rangeStr =
        `${midiToNoteName(newRange.min)} (${newRange.min}) – ${midiToNoteName(newRange.max)} (${newRange.max})`;
      trackLogs.push(
        `       ${trackId}  ${col("dim", "unchanged")}  ${col("dim", rangeStr)}`,
      );
    }
  }

  // ── Print summary line + per-track detail ─────────────────────────────────
  const icon  = anyChanged ? col("green", "✔") : col("dim",  "·");
  const badge = dryRun     ? col("yellow", "  [dry-run]") : "";
  const verb  = anyChanged ? col("green", "updated") : col("dim", "no changes");

  if (!silent || anyChanged) {
    console.log(`  ${icon}  ${fileLabel}  ${verb}${badge}`);
    for (const line of trackLogs) console.log(line);
  }

  if (!anyChanged) return { ok: true, changed: false };

  // ── Write back ────────────────────────────────────────────────────────────
  if (!dryRun) {
    const output = JSON.stringify(song, null, 2) + "\n";
    try {
      await fsp.writeFile(filePath, output, "utf8");
    } catch (err) {
      console.error(col("red", `     ✗  Write failed: ${filePath}\n        ${err.message}`));
      return { ok: false, changed: false };
    }
  }

  return { ok: true, changed: true };
}

// ── File collection ───────────────────────────────────────────────────────────

function isSongFile(filePath) {
  if (!filePath.endsWith(".json")) return false;
  if (path.basename(filePath) === "index.json") return false;
  return true;
}

async function collectSongFiles(inputs) {
  const files = [];

  for (const input of inputs) {
    let stat;
    try {
      stat = await fsp.stat(input);
    } catch {
      console.error(col("red", `  ✗  Path not found: ${input}`));
      continue;
    }

    if (stat.isDirectory()) {
      let entries;
      try {
        entries = await fsp.readdir(input);
      } catch (err) {
        console.error(col("red", `  ✗  Cannot read directory: ${input}\n     ${err.message}`));
        continue;
      }
      for (const entry of entries.sort()) {
        const full = path.join(input, entry);
        if (isSongFile(full)) files.push(full);
      }
    } else if (isSongFile(input)) {
      files.push(input);
    } else {
      console.warn(col("yellow", `  ⚠  Skipping (not a song JSON): ${input}`));
    }
  }

  return files;
}

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { dryRun: false, silent: false, help: false, inputs: [] };

  for (const a of args) {
    switch (a) {
      case "--dry-run":
      case "--dryrun":
        opts.dryRun = true;
        break;
      case "--silent":
      case "-q":
        opts.silent = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        opts.inputs.push(a);
    }
  }

  return opts;
}

function printUsage() {
  console.log(`
  ${col("bold", "recalculate-note-range.mjs")}

  Recompute the ${col("cyan", "noteRange")} for every track in one or more Synrecordia
  song JSON files, derived from the actual pitch values in ${col("cyan", "actions")}.

  ${col("bold", "Usage")}
    node scripts/recalculate-note-range.mjs [options] [path ...]

  ${col("bold", "Arguments")}
    path        Song JSON file(s) or director(ies) to process.
                Defaults to  ${col("dim", "public/songs/")}  when omitted.

  ${col("bold", "Options")}
    --dry-run   Show what would change without writing any files.
    --silent    Suppress output for unchanged files; only show updates/errors.
    --help, -h  Show this help message.

  ${col("bold", "Examples")}
    node scripts/recalculate-note-range.mjs
    node scripts/recalculate-note-range.mjs public/songs/river-flows-in-you.json
    node scripts/recalculate-note-range.mjs public/songs/ --dry-run
    node scripts/recalculate-note-range.mjs public/songs/ --silent
`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  const DEFAULT_SONGS_DIR = path.join(process.cwd(), "public", "songs");
  const inputs = opts.inputs.length ? opts.inputs : [DEFAULT_SONGS_DIR];

  const files = await collectSongFiles(inputs);

  if (files.length === 0) {
    console.log(col("yellow", "\n  No song files found.\n"));
    process.exit(0);
  }

  console.log();
  if (opts.dryRun) {
    console.log(col("yellow", "  ── DRY RUN — no files will be written ──\n"));
  }

  let totalOk      = 0;
  let totalChanged = 0;
  let totalErrors  = 0;

  for (const file of files) {
    const { ok, changed } = await processSong(file, opts);
    if (ok) {
      totalOk++;
      if (changed) totalChanged++;
    } else {
      totalErrors++;
    }
  }

  const errPart = totalErrors
    ? col("red",   `${totalErrors} error${totalErrors !== 1 ? "s" : ""}`)
    : col("dim",   "0 errors");

  console.log(
    `\n  ${col("bold", "Done.")}` +
    `  ${files.length} file${files.length !== 1 ? "s" : ""} scanned` +
    `  ·  ${col("green", String(totalChanged))} updated` +
    `  ·  ${errPart}\n`,
  );

  if (totalErrors > 0) process.exit(1);
}

main().catch((err) => {
  console.error(col("red", `\n  Fatal: ${err.message}\n`));
  process.exit(1);
});
