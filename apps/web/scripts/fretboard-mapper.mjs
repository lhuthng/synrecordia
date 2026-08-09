#!/usr/bin/env node
/**
 * fretboard-mapper.mjs  —  CLI wrapper around src/libs/guitar/GuitarMapper.js
 *
 * Finds the globally-optimal string/fret assignment sequence for every note in
 * a track using a Viterbi-style DP.  All scoring and theory logic lives in the
 * library; this script handles argument parsing, display, and file I/O.
 *
 * Usage:
 *   node scripts/fretboard-mapper.mjs <song.json> [options]
 *
 * Options:
 *   --track <id>          Track id to map (default: first track)
 *   --list                List all tracks and exit
 *   --tuning <name>       Guitar tuning (default: STANDARD)
 *   --capo <n>            Capo fret (default: 0)
 *   --max-fret <n>        Highest usable fret (default: 24)
 *   --hand-span <n>       Max left-hand fret span (default: 4)
 *   --mode <preset>       balanced | comfort | sustain (default: balanced)
 *   --left-hand <0-1>     Left-hand economy weight override
 *   --right-hand <0-1>    Right-hand economy/sustain weight override
 *   --out <file>          Write annotated JSON to this file
 *   --no-tab              Suppress ASCII tab output
 *   --help                Show this help
 */

import fs from "node:fs";
import GuitarMapper from "../src/libs/guitar/GuitarMapper.js";
import { TUNINGS } from "../src/libs/guitar/tunings.js";

// ─────────────────────────────────────────────────────────────────────────────
// NOTE-NAME EXTRACTION  (display only — not part of the lib)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract note names from a raw actions array, grouped into quantised slices
 * in the same order that GuitarMapper produces internally.
 *
 * Returns an array aligned with `result.slices`: element [i] is an array of
 * note-name strings for slice i, in the same note order.
 *
 * @param {object[]} actions
 * @param {number}   quantRes  Beat quantisation grid (default 0.125).
 * @returns {string[][]}
 */
function extractNoteNames(actions, quantRes = 0.125) {
  const quantize = (t) => Math.round(t / quantRes) * quantRes;
  const sliceMap = new Map();

  for (const action of actions) {
    if (action.type !== "note") continue;
    const raws = action.pitches ?? (action.pitch != null ? [action.pitch] : []);
    for (const raw of raws) {
      const qt = quantize(action.time);
      const key = qt.toFixed(6);
      if (!sliceMap.has(key)) sliceMap.set(key, []);
      const arr = sliceMap.get(key);
      if (!arr.includes(String(raw))) arr.push(String(raw));
    }
  }

  // Sort by quantised time (key is a fixed-precision float string)
  const entries = [...sliceMap.entries()].sort(
    (a, b) => parseFloat(a[0]) - parseFloat(b[0]),
  );
  return entries.map(([, names]) => names);
}

// ─────────────────────────────────────────────────────────────────────────────
// ASCII TAB RENDERER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a human-readable ASCII guitar tab from a `mapper.map()` result.
 *
 * Layout:
 *   • One row per string; highest-pitched string (index 0) at the top.
 *   • One column per time-slice.
 *   • Fret numbers at active strings; dashes for inactive strings.
 *   • Technique prefix: "h" = hammer-on, "p" = pull-off, "t" = tap.
 *   • A beat-number ruler below the strings.
 *
 * @param {object}   result      Return value of mapper.map().
 * @param {string[]} tuningNotes Open-string note names (index 0 = high string).
 * @param {string}   title       Song title (printed in the header).
 */
function renderAsciiTab(result, tuningNotes, title) {
  const numStrings = tuningNotes.length;
  const TECH_PREFIX = { "hammer-on": "h", "pull-off": "p", tap: "t", pick: "" };

  // ── Build per-column cell map: (0-based string index) → display text ─────
  const cols = result.slices.map((slice) => {
    const col = new Map(); // 0-based string → cell text
    if (!slice.notes) return col;
    for (const note of slice.notes) {
      const [strNum, fret] = note.pos; // strNum is 1-based
      const prefix = TECH_PREFIX[note.technique] ?? "";
      col.set(strNum - 1, prefix + String(fret)); // convert to 0-based
    }
    return col;
  });

  // ── Determine per-column widths ───────────────────────────────────────────
  const colWidths = cols.map((col) => {
    let maxLen = 1;
    for (const text of col.values()) maxLen = Math.max(maxLen, text.length);
    return maxLen + 1; // +1 leading dash
  });

  // ── String-name labels (strip octave digit, keep accidentals) ────────────
  const labels = tuningNotes.map((n) => n.replace(/\d+$/, ""));
  const labelWidth = Math.max(...labels.map((l) => l.length), 1);

  // ── One line per string ───────────────────────────────────────────────────
  const lines = [];
  for (let s = 0; s < numStrings; s++) {
    const label = labels[s].padStart(labelWidth);
    let line = label + " |";

    for (let ci = 0; ci < cols.length; ci++) {
      const w = colWidths[ci];
      const cell = cols[ci].get(s);
      if (cell !== undefined) {
        line += cell.padStart(w, "-");
      } else {
        line += "-".repeat(w);
      }
    }

    line += "|";
    lines.push(line);
  }

  // ── Beat-number ruler ─────────────────────────────────────────────────────
  const rulerPad = " ".repeat(labelWidth + 2);
  let ruler = rulerPad;
  for (let ci = 0; ci < cols.length; ci++) {
    const w = colWidths[ci];
    const label =
      result.slices[ci].time % 1 === 0
        ? String(result.slices[ci].time)
        : result.slices[ci].time.toFixed(2).replace(/\.?0+$/, "");
    ruler += label.padStart(w, " ");
  }

  // ── Print ─────────────────────────────────────────────────────────────────
  const lineLen = lines[0]?.length ?? 40;
  const dbl = "═".repeat(lineLen);
  const bar = "─".repeat(lineLen);

  console.log("\n" + dbl);
  console.log(`  ${title}`);
  console.log(dbl);
  for (const line of lines) console.log(line);
  console.log(bar);
  console.log(ruler + "  ← beat");
  console.log(bar);
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI ARGUMENT PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _positional: [] };
  let i = 0;
  while (i < argv.length) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i += 2;
      } else {
        args[key] = true;
        i += 1;
      }
    } else {
      args._positional.push(argv[i]);
      i += 1;
    }
  }
  return args;
}

function printHelp() {
  const tunings = Object.keys(TUNINGS).join(", ");
  console.log(`
fretboard-mapper.mjs  —  Dynamic-programming guitar fretboard mapper
                         for synrecordia song JSON

USAGE
  node scripts/fretboard-mapper.mjs <song.json> [options]

OPTIONS
  --track <id>          Track id to map (default: first track)
  --list                List all tracks in the file, then exit
  --tuning <name>       Guitar tuning (default: STANDARD)
                        Available: ${tunings}
  --capo <n>            Capo fret (default: 0)
  --max-fret <n>        Highest usable fret (default: 24)
  --hand-span <n>       Max left-hand fret span (default: 4)
  --mode <preset>       balanced | comfort | sustain  (default: balanced)
                          balanced — 50/50 trade-off between left- and right-hand
                          comfort  — minimise left-hand travel and span
                          sustain  — maximise sustain, open strings, let-ring
  --left-hand <0-1>     Override left-hand economy weight
  --right-hand <0-1>    Override right-hand economy / sustain weight
  --out <file>          Write lean JSON result to <file>
  --no-tab              Suppress the ASCII tab output
  --help                Show this help

EXAMPLES
  node scripts/fretboard-mapper.mjs public/songs/happy-birthday-to-you.json \\
       --track recorder

  node scripts/fretboard-mapper.mjs public/songs/happy-birthday-to-you.json \\
       --track piano --mode sustain --out hb-piano-mapped.json

  node scripts/fretboard-mapper.mjs public/songs/happy-birthday-to-you.json \\
       --track piano --tuning DROP_D --left-hand 0.7 --right-hand 0.4

OUTPUT
  • ASCII guitar tab showing string/fret assignments.
  • Per-note listing with string, fret, and technique annotation.
  • Left-hand summary (fret range, average position, open-string fraction).
  • Optional --out JSON file with the lean mapped slice data.

TECHNIQUE MARKS  (in tab and note listing)
  h  hammer-on   (same string, ascending fret, within legato threshold)
  p  pull-off    (same string, descending fret, within legato threshold)
  ·  pick        (default)
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args._positional.length === 0) {
    printHelp();
    process.exit(0);
  }

  const songFile = args._positional[0];
  if (!fs.existsSync(songFile)) {
    console.error(`Error: file not found: ${songFile}`);
    process.exit(1);
  }

  let songJson;
  try {
    songJson = JSON.parse(fs.readFileSync(songFile, "utf-8"));
  } catch (e) {
    console.error(`Error: could not parse JSON: ${e.message}`);
    process.exit(1);
  }

  // ── --list ────────────────────────────────────────────────────────────────
  if (args.list) {
    console.log(`\nTracks in "${songJson.title || songFile}":\n`);
    for (const t of songJson.tracks ?? []) {
      const noteActions = (t.actions ?? []).filter((a) => a.type === "note");
      const chordActions = noteActions.filter((a) => Array.isArray(a.pitches));
      const singleActions = noteActions.filter((a) => a.pitch != null);
      console.log(
        `  [${t.id}]  instrument="${t.instrument}"  ` +
          `note-actions=${noteActions.length}` +
          `  (${singleActions.length} single, ${chordActions.length} chord)`,
      );
    }
    console.log();
    process.exit(0);
  }

  // ── Resolve tuning ────────────────────────────────────────────────────────
  const tuningKey = (args.tuning ?? "STANDARD")
    .toUpperCase()
    .replace(/-/g, "_");
  if (!TUNINGS[tuningKey]) {
    console.error(
      `Error: unknown tuning "${tuningKey}".\n` +
        `Available: ${Object.keys(TUNINGS).join(", ")}`,
    );
    process.exit(1);
  }
  const tuningNotes = TUNINGS[tuningKey];

  // ── Resolve track ─────────────────────────────────────────────────────────
  const trackId = args.track == null ? undefined : String(args.track);
  const track = trackId
    ? (songJson.tracks ?? []).find((t) => t.id === trackId)
    : (songJson.tracks ?? [])[0];

  if (!track) {
    console.error(`Error: track not found: "${trackId}"`);
    process.exit(1);
  }

  // ── Build mapper options ──────────────────────────────────────────────────
  const mode = args.mode ?? "balanced";
  const leftHandWeight =
    args["left-hand"] != null ? parseFloat(args["left-hand"]) : null;
  const rightHandWeight =
    args["right-hand"] != null ? parseFloat(args["right-hand"]) : null;

  if (leftHandWeight !== null && (leftHandWeight < 0 || leftHandWeight > 2)) {
    console.error(
      "Error: --left-hand must be between 0 and 1 (or close to it).",
    );
    process.exit(1);
  }
  if (
    rightHandWeight !== null &&
    (rightHandWeight < 0 || rightHandWeight > 2)
  ) {
    console.error(
      "Error: --right-hand must be between 0 and 1 (or close to it).",
    );
    process.exit(1);
  }

  const mapperOptions = {
    tuning: tuningKey,
    capo: args.capo != null && args.capo !== true ? parseInt(args.capo, 10) : 0,
    maxFret: args["max-fret"] != null ? parseInt(args["max-fret"], 10) : 24,
    maxHandSpan:
      args["hand-span"] != null ? parseInt(args["hand-span"], 10) : 4,
    mode,
    leftHandWeight,
    rightHandWeight,
  };

  const mapper = new GuitarMapper(mapperOptions);

  // ── Header banner ─────────────────────────────────────────────────────────
  console.log();
  console.log("🎸  Fretboard Mapper  (Dynamic Programming)");
  console.log("    Song      :", songJson.title ?? songFile);
  console.log("    Track     :", `${track.id}  (${track.instrument})`);
  console.log("    Tuning    :", tuningKey, `[${tuningNotes.join("  ")}]`);
  console.log(
    "    Capo      :",
    mapperOptions.capo === 0 ? "none" : `fret ${mapperOptions.capo}`,
  );
  console.log("    Max fret  :", mapperOptions.maxFret);
  console.log("    Hand span :", `${mapperOptions.maxHandSpan} frets max`);
  console.log("    BPM       :", songJson.bpm);
  console.log("    Mode      :", mode);
  console.log();

  // ── Run the mapper ────────────────────────────────────────────────────────
  process.stdout.write("  Running DP solver…  ");
  const t0 = Date.now();
  const result = mapper.map(track.actions);
  console.log(`done in ${Date.now() - t0} ms\n`);

  console.log(
    "    LH / RH   :",
    `${result.leftHandWeight.toFixed(2)}  /  ${result.rightHandWeight.toFixed(2)}`,
  );
  console.log("    Slices    :", result.slices.length);
  console.log();

  // ── Note names (for display only) ────────────────────────────────────────
  const noteNames = extractNoteNames(
    track.actions /* quantRes default 0.125 */,
  );

  // ── ASCII tab ─────────────────────────────────────────────────────────────
  if (!args["no-tab"]) {
    renderAsciiTab(result, tuningNotes, songJson.title ?? songFile);
  }

  // ── Note-by-note listing ──────────────────────────────────────────────────
  const TECH_SYMBOL = {
    "hammer-on": "h",
    "pull-off": "p",
    tap: "t",
    pick: "·",
  };

  let playable = 0;
  let unplayable = 0;

  console.log("  Note Mapping");
  console.log("  " + "─".repeat(70));
  console.log(
    "  " + "beat".padEnd(8) + "notes".padEnd(24) + "string : fret   technique",
  );
  console.log("  " + "─".repeat(70));

  for (let i = 0; i < result.slices.length; i++) {
    const rSlice = result.slices[i];
    const names = noteNames[i] ?? [];

    if (!rSlice.notes) {
      unplayable++;
      console.log(
        `  ${String(rSlice.time).padEnd(8)} ✗  UNPLAYABLE  [${names.join("+")}]`,
      );
      continue;
    }

    playable++;
    const parts = rSlice.notes.map((note, ni) => {
      const [strNum, fret] = note.pos; // strNum is 1-based
      const symbol = TECH_SYMBOL[note.technique] ?? "?";
      const strStr = `S${strNum}`;
      const fretStr = String(fret).padStart(2);
      return `${String(names[ni] ?? "?").padEnd(4)} → ${strStr}:${fretStr}  ${symbol}`;
    });

    console.log(`  ${String(rSlice.time).padEnd(8)} ${parts.join("     ")}`);
  }

  console.log("  " + "─".repeat(70));
  console.log(
    `  Result: ${playable} playable, ${unplayable} unplayable` +
      `  (${result.slices.length} total slices)\n`,
  );

  // ── Left-hand summary ─────────────────────────────────────────────────────
  const allFretted = result.slices
    .filter((s) => s.notes)
    .flatMap((s) => s.notes.filter((n) => n.pos[1] > 0).map((n) => n.pos[1]));

  const allPositions = result.slices
    .filter((s) => s.notes)
    .flatMap((s) => s.notes);

  const openFraction =
    allPositions.length > 0
      ? allPositions.filter((n) => n.pos[1] === 0).length / allPositions.length
      : 0;

  console.log("  Left-hand summary");
  if (allFretted.length > 0) {
    const avg = allFretted.reduce((a, b) => a + b, 0) / allFretted.length;
    console.log(
      `    Fret range   : ${Math.min(...allFretted)} – ${Math.max(...allFretted)}`,
    );
    console.log(`    Average fret : ${avg.toFixed(1)}`);
  }
  console.log(
    `    Open strings : ${(openFraction * 100).toFixed(0)} % of all notes`,
  );
  console.log();

  // ── JSON output ───────────────────────────────────────────────────────────
  if (typeof args.out === "string") {
    try {
      fs.writeFileSync(args.out, JSON.stringify(result, null, 2), "utf-8");
      console.log(`  JSON output written → ${args.out}\n`);
    } catch (e) {
      console.error(`  Warning: could not write output file: ${e.message}`);
    }
  }
}

main();
