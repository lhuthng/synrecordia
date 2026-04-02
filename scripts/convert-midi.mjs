#!/usr/bin/env node
/**
 * convert-midi.mjs
 *
 * Inspect or convert a MIDI file to the project's song JSON format.
 *
 * Modes:
 *   --list     List all tracks with note counts and instrument info, then exit.
 *   (default)  Convert MIDI to JSON and write public/songs/<id>.json.
 *
 * Usage:
 *   node scripts/convert-midi.mjs <input> --list
 *   node scripts/convert-midi.mjs <input> [convert-options]
 *
 * Convert options:
 *   --main-tracks <i,j,...>    0-based track indices to merge as main instrument.
 *                               Default: auto-detect (highest-pitched notes).
 *   --main-instrument <name>   Instrument id for the main track. Default: "recorder".
 *   --other-tracks <i,j,...>   0-based track indices to merge as secondary instrument.
 *                               Default: auto-detect (lowest-pitched notes).
 *   --other-instrument <name>  Instrument id for the secondary track. Default: "piano".
 *   --id <song-id>             Override the output song id. Default: filename stem.
 *   --title <title>            Override the song title. Default: derived from filename.
 *   --register                 Also add/update entry in public/songs/index.json.
 */

import fs from "fs";
import path from "path";

// ── General MIDI instrument names (programs 0-127) ────────────────────────────
const GM_INSTRUMENTS = [
  /* 0-7   */ "Acoustic Grand Piano",
  "Bright Acoustic Piano",
  "Electric Grand Piano",
  "Honky-tonk Piano",
  "Electric Piano 1",
  "Electric Piano 2",
  "Harpsichord",
  "Clavi",
  /* 8-15  */ "Celesta",
  "Glockenspiel",
  "Music Box",
  "Vibraphone",
  "Marimba",
  "Xylophone",
  "Tubular Bells",
  "Dulcimer",
  /* 16-23 */ "Drawbar Organ",
  "Percussive Organ",
  "Rock Organ",
  "Church Organ",
  "Reed Organ",
  "Accordion",
  "Harmonica",
  "Tango Accordion",
  /* 24-31 */ "Acoustic Guitar (nylon)",
  "Acoustic Guitar (steel)",
  "Electric Guitar (jazz)",
  "Electric Guitar (clean)",
  "Electric Guitar (muted)",
  "Overdriven Guitar",
  "Distortion Guitar",
  "Guitar harmonics",
  /* 32-39 */ "Acoustic Bass",
  "Electric Bass (finger)",
  "Electric Bass (pick)",
  "Fretless Bass",
  "Slap Bass 1",
  "Slap Bass 2",
  "Synth Bass 1",
  "Synth Bass 2",
  /* 40-47 */ "Violin",
  "Viola",
  "Cello",
  "Contrabass",
  "Tremolo Strings",
  "Pizzicato Strings",
  "Orchestral Harp",
  "Timpani",
  /* 48-55 */ "String Ensemble 1",
  "String Ensemble 2",
  "SynthStrings 1",
  "SynthStrings 2",
  "Choir Aahs",
  "Voice Oohs",
  "Synth Voice",
  "Orchestra Hit",
  /* 56-63 */ "Trumpet",
  "Trombone",
  "Tuba",
  "Muted Trumpet",
  "French Horn",
  "Brass Section",
  "SynthBrass 1",
  "SynthBrass 2",
  /* 64-71 */ "Soprano Sax",
  "Alto Sax",
  "Tenor Sax",
  "Baritone Sax",
  "Oboe",
  "English Horn",
  "Bassoon",
  "Clarinet",
  /* 72-79 */ "Piccolo",
  "Flute",
  "Recorder",
  "Pan Flute",
  "Blown Bottle",
  "Shakuhachi",
  "Whistle",
  "Ocarina",
  /* 80-87 */ "Lead 1 (square)",
  "Lead 2 (sawtooth)",
  "Lead 3 (calliope)",
  "Lead 4 (chiff)",
  "Lead 5 (charang)",
  "Lead 6 (voice)",
  "Lead 7 (fifths)",
  "Lead 8 (bass+lead)",
  /* 88-95 */ "Pad 1 (new age)",
  "Pad 2 (warm)",
  "Pad 3 (polysynth)",
  "Pad 4 (choir)",
  "Pad 5 (bowed)",
  "Pad 6 (metallic)",
  "Pad 7 (halo)",
  "Pad 8 (sweep)",
  /* 96-103 */ "FX 1 (rain)",
  "FX 2 (soundtrack)",
  "FX 3 (crystal)",
  "FX 4 (atmosphere)",
  "FX 5 (brightness)",
  "FX 6 (goblins)",
  "FX 7 (echoes)",
  "FX 8 (sci-fi)",
  /* 104-111 */ "Sitar",
  "Banjo",
  "Shamisen",
  "Koto",
  "Kalimba",
  "Bag pipe",
  "Fiddle",
  "Shanai",
  /* 112-119 */ "Tinkle Bell",
  "Agogo",
  "Steel Drums",
  "Woodblock",
  "Taiko Drum",
  "Melodic Tom",
  "Synth Drum",
  "Reverse Cymbal",
  /* 120-127 */ "Guitar Fret Noise",
  "Breath Noise",
  "Seashore",
  "Bird Tweet",
  "Telephone Ring",
  "Helicopter",
  "Applause",
  "Gunshot",
];

// ── Argument parser ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    inputPath: null,
    list: false,
    tracks: [], // [{ indices: number[], instrument: string }, ...] from --track flags
    id: null,
    title: null,
    composer: null,
    difficulty: null,
    trim: false,
    register: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--list":
        args.list = true;
        break;
      case "--register":
        args.register = true;
        break;
      case "--trim":
        args.trim = true;
        break;
      case "--track": {
        // Format: "<i,j,...>:<instrument-id>[:<semitones>]"
        const spec = argv[++i] ?? "";
        const parts = spec.split(":");
        if (parts.length < 2) {
          console.warn(
            `Invalid --track spec "${spec}", expected <indices>:<instrument>[:<semitones>]`,
          );
          break;
        }
        const indices = parts[0]
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n));
        const instrument = parts[1].trim();
        const semitones = parts.length >= 3 ? parseInt(parts[2].trim(), 10) : 0;
        if (indices.length === 0 || !instrument) {
          console.warn(
            `Invalid --track spec "${spec}": need at least one index and a non-empty instrument name`,
          );
          break;
        }
        if (parts.length >= 3 && isNaN(semitones)) {
          console.warn(
            `Invalid semitone offset in --track spec "${spec}": expected an integer`,
          );
          break;
        }
        args.tracks.push({ indices, instrument, semitones });
        break;
      }
      case "--id":
        args.id = argv[++i];
        break;
      case "--title":
        args.title = argv[++i];
        break;
      case "--composer":
        args.composer = argv[++i];
        break;
      case "--difficulty":
        args.difficulty = argv[++i];
        break;
      default:
        if (!arg.startsWith("--")) {
          args.inputPath = arg;
        } else {
          console.warn(`Unknown option: ${arg}`);
        }
    }
  }

  return args;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/convert-midi.mjs <input> --list
  node scripts/convert-midi.mjs <input> [options]

Options:
  --list                     List all tracks with note counts and instrument info, then exit.
  --track <i,j,...>:<name>[:<semitones>]
                             Define an output track: merge the given 0-based MIDI track indices
                             and assign them the instrument id <name>. Repeat for N tracks.
                             An optional semitone offset (e.g. -12 for one octave down) is
                             applied to every note in that track before conversion.
                             When omitted entirely, auto-detects and splits into recorder + piano.
                             Note: many MIDI files use C3 = middle C (Yamaha/Roland convention)
                             while this script uses C4 = middle C. If notes sound one octave too
                             high, add :-12 to the affected track(s).
  --id <song-id>             Override song id (default: filename stem).
  --title <title>            Override song title (default: derived from filename).
  --composer <name>          Composer name written into the song JSON and index entry.
  --difficulty <level>       Difficulty written into the index entry (e.g. beginner/easy/medium/hard).
  --trim                     Trim the main instrument track: collapse chords to highest pitch,
                             shorten notes that overlap the next, remove zero-duration notes.
  --register                 Add/update entry in public/songs/index.json.
`);
}

// ── MIDI binary helpers ───────────────────────────────────────────────────────
function readString(buf, offset, length) {
  return buf.slice(offset, offset + length).toString("ascii");
}

function readUint32(buf, offset) {
  return buf.readUInt32BE(offset);
}

function readUint16(buf, offset) {
  return buf.readUInt16BE(offset);
}

function readVarInt(buf, offset) {
  let value = 0;
  let byte = 0;
  do {
    byte = buf[offset++];
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return { value, offset };
}

function midiNoteToName(noteNumber) {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const name = names[noteNumber % 12];
  const octave = Math.floor(noteNumber / 12) - 1;
  return `${name}${octave}`;
}

function velocityToPercent(velocity) {
  return Math.round((Math.min(Math.max(velocity, 0), 127) / 127) * 100);
}

// ── MIDI parser ───────────────────────────────────────────────────────────────
function parseMidi(buf) {
  let offset = 0;

  const headerChunk = readString(buf, offset, 4);
  if (headerChunk !== "MThd") throw new Error("Invalid MIDI header");
  offset += 4;

  const headerLength = readUint32(buf, offset);
  offset += 4;

  const format = readUint16(buf, offset);
  offset += 2;

  const numTracks = readUint16(buf, offset);
  offset += 2;

  const division = readUint16(buf, offset);
  offset += 2;

  // skip any extra header bytes
  offset += Math.max(0, headerLength - 6);

  if (division & 0x8000) {
    throw new Error("SMPTE time division is not supported");
  }

  const ppq = division;
  const tracks = [];
  let firstTempo = null;
  const timeSignatures = [];

  for (let t = 0; t < numTracks; t++) {
    const chunkType = readString(buf, offset, 4);
    if (chunkType !== "MTrk")
      throw new Error(`Invalid track header at offset ${offset}`);
    offset += 4;

    const trackLength = readUint32(buf, offset);
    offset += 4;

    const trackEnd = offset + trackLength;
    const notes = [];
    const noteOnMap = new Map();
    let trackName = null;
    const programSet = new Set(); // programs used in this track
    let absTicks = 0;
    let runningStatus = null;

    while (offset < trackEnd) {
      const deltaResult = readVarInt(buf, offset);
      const delta = deltaResult.value;
      offset = deltaResult.offset;

      absTicks += delta;

      let statusByte = buf[offset];
      const hasStatusByte = statusByte >= 0x80;

      if (hasStatusByte) {
        offset += 1;
        runningStatus = statusByte;
      } else {
        if (runningStatus === null) {
          throw new Error("Running status encountered without previous status");
        }
        statusByte = runningStatus;
      }

      // ── Meta events ────────────────────────────────────────────────────────
      if (statusByte === 0xff) {
        const metaType = buf[offset++];
        const lengthResult = readVarInt(buf, offset);
        const length = lengthResult.value;
        offset = lengthResult.offset;
        const data = buf.slice(offset, offset + length);
        offset += length;

        if (metaType === 0x03) {
          // Track name
          trackName = data.toString("ascii").replace(/\0/g, "").trim();
        } else if (metaType === 0x51 && length === 3 && firstTempo === null) {
          // Tempo (first occurrence)
          const tempo = (data[0] << 16) | (data[1] << 8) | data[2];
          firstTempo = tempo;
        } else if (metaType === 0x58 && length >= 2) {
          // Time signature
          const numerator = data[0];
          const dd = data[1];
          const denominator = 2 ** dd;
          const clocks = data[2] ?? 24;
          const thirtySeconds = data[3] ?? 8;
          timeSignatures.push({
            ticks: absTicks,
            numerator,
            dd,
            denominator,
            clocks,
            thirtySeconds,
          });
        }
        continue;
      }

      // ── SysEx events ───────────────────────────────────────────────────────
      if (statusByte === 0xf0 || statusByte === 0xf7) {
        const lengthResult = readVarInt(buf, offset);
        const length = lengthResult.value;
        offset = lengthResult.offset + length;
        continue;
      }

      const eventType = statusByte & 0xf0;
      const channel = statusByte & 0x0f;

      const isOneDataByte = eventType === 0xc0 || eventType === 0xd0;

      const data1 = buf[offset++];
      let data2;
      if (!isOneDataByte) data2 = buf[offset++];

      // ── Program Change (instrument) ────────────────────────────────────────
      if (eventType === 0xc0) {
        programSet.add(data1);
        continue;
      }

      // ── Note On ────────────────────────────────────────────────────────────
      if (eventType === 0x90) {
        const noteNumber = data1;
        const velocity = data2 ?? 0;
        if (velocity === 0) {
          // Note-on with velocity 0 = note off
          const key = `${channel}-${noteNumber}`;
          const stack = noteOnMap.get(key);
          if (stack && stack.length > 0) {
            const start = stack.shift();
            notes.push({
              noteNumber,
              startTicks: start.startTicks,
              durationTicks: absTicks - start.startTicks,
              velocity: start.velocity,
            });
          }
        } else {
          const key = `${channel}-${noteNumber}`;
          const stack = noteOnMap.get(key) || [];
          stack.push({ startTicks: absTicks, velocity });
          noteOnMap.set(key, stack);
        }
      }

      // ── Note Off ───────────────────────────────────────────────────────────
      else if (eventType === 0x80) {
        const noteNumber = data1;
        const key = `${channel}-${noteNumber}`;
        const stack = noteOnMap.get(key);
        if (stack && stack.length > 0) {
          const start = stack.shift();
          notes.push({
            noteNumber,
            startTicks: start.startTicks,
            durationTicks: absTicks - start.startTicks,
            velocity: start.velocity,
          });
        }
      }
    }

    tracks.push({
      name: trackName,
      notes,
      programs: [...programSet],
    });
  }

  const bpm = firstTempo ? Math.round(60_000_000 / firstTempo) : 120;
  return { format, ppq, tracks, bpm, timeSignatures };
}

// ── Music helpers ─────────────────────────────────────────────────────────────
function quantizeBeats(value, grid = 1 / 12) {
  return Math.round(value / grid) * grid;
}

function pitchNameToMidi(name) {
  const match = name.match(/^([A-G])(#?)(-?\d+)$/);
  if (!match) return 0;
  const [, letter, sharp, octaveStr] = match;
  const octave = parseInt(octaveStr, 10);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter];
  const accidental = sharp ? 1 : 0;
  return (octave + 1) * 12 + base + accidental;
}

// ── Monophonic trim helpers ───────────────────────────────────────────────────
function highestPitch(pitches) {
  let best = null;
  let bestMidi = -Infinity;
  for (const p of pitches) {
    const m = pitchNameToMidi(p);
    if (Number.isFinite(m) && m > bestMidi) {
      bestMidi = m;
      best = p;
    }
  }
  return best ?? pitches[0];
}

/**
 * Trims an actions array to be suitable for a monophonic instrument (e.g. recorder):
 *   1. Collapses polyphonic note actions (pitches[]) → single highest pitch.
 *   2. Shortens any note whose duration would overlap the next note's start.
 *   3. Removes notes whose duration became zero.
 *
 * @param {object[]} actions
 * @returns {object[]} new trimmed actions array
 */
function trimMonophonicActions(actions) {
  let collapsed = 0;

  // 1. Collapse pitches[] → single highest pitch
  for (const a of actions) {
    if (a?.type !== "note") continue;
    const multi = Array.isArray(a.pitches)
      ? a.pitches
      : Array.isArray(a.pitch)
        ? a.pitch
        : null;
    if (multi?.length > 0) {
      a.pitch = highestPitch(multi);
      delete a.pitches;
      collapsed++;
    }
  }

  // 2. Build a time-sorted index of note actions only
  const indexed = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a?.type !== "note") continue;
    const time = Number(a.time);
    if (!Number.isFinite(time)) continue;
    indexed.push({ i, time, duration: Number(a.duration) || 0 });
  }
  indexed.sort((a, b) => a.time - b.time || a.i - b.i);

  // 3. Trim overlapping durations
  let trimmed = 0;
  const toRemove = new Set();
  for (let k = 0; k < indexed.length - 1; k++) {
    const cur = indexed[k];
    const next = indexed[k + 1];
    const curEnd = cur.time + cur.duration;
    if (curEnd > next.time) {
      const newDur = Math.max(0, next.time - cur.time);
      if (newDur <= 0) {
        toRemove.add(cur.i);
      } else {
        actions[cur.i].duration = newDur;
        cur.duration = newDur; // keep index consistent for chained overlaps
        trimmed++;
      }
    }
  }

  // 4. Filter out zero-duration notes
  const removed = toRemove.size;
  const result =
    removed > 0 ? actions.filter((_, i) => !toRemove.has(i)) : actions;

  console.log(
    `  Trim (main): collapsed=${collapsed} trimmed=${trimmed} removed=${removed}`,
  );
  return result;
}

function buildActions(notes, ppq) {
  const grouped = new Map();

  notes.forEach((note) => {
    const timeBeats = quantizeBeats(note.startTicks / ppq);
    const durationBeats = quantizeBeats(note.durationTicks / ppq);
    const timeKey = timeBeats.toFixed(6);

    const group = grouped.get(timeKey) || [];
    group.push({
      pitch: midiNoteToName(note.noteNumber),
      duration: Number(durationBeats.toFixed(6)),
      velocity: velocityToPercent(note.velocity),
    });
    grouped.set(timeKey, group);
  });

  const actions = Array.from(grouped.entries())
    .map(([timeKey, group]) => {
      const time = Number(timeKey);

      if (group.length === 1) {
        const note = group[0];
        return {
          type: "note",
          time,
          duration: note.duration,
          pitch: note.pitch,
          velocity: note.velocity,
        };
      }

      const pitches = group
        .map((note) => note.pitch)
        .sort((a, b) => pitchNameToMidi(a) - pitchNameToMidi(b));

      const duration = Number(
        quantizeBeats(Math.max(...group.map((n) => n.duration))).toFixed(6),
      );

      const velocity = Math.round(
        group.reduce((sum, n) => sum + n.velocity, 0) / group.length,
      );

      return { type: "note", time, duration, pitches, velocity };
    })
    .sort((a, b) => a.time - b.time);

  return actions;
}

// ── Auto track-split (legacy behaviour) ──────────────────────────────────────
function splitTracks(parsed) {
  const candidateTracks = parsed.tracks.filter((t) => t.notes.length > 0);
  if (candidateTracks.length === 0) return { right: [], left: [] };

  if (candidateTracks.length === 1) {
    const right = [];
    const left = [];
    candidateTracks[0].notes.forEach((note) => {
      if (note.noteNumber >= 60) right.push(note);
      else left.push(note);
    });
    return { right, left };
  }

  const withMeta = candidateTracks.map((track) => {
    const avg =
      track.notes.reduce((s, n) => s + n.noteNumber, 0) / track.notes.length;
    return { ...track, avgPitch: avg };
  });

  const rightNamed = withMeta.find((t) => /right|rh/i.test(t.name || ""));
  const leftNamed = withMeta.find((t) => /left|lh/i.test(t.name || ""));

  if (rightNamed && leftNamed && rightNamed !== leftNamed) {
    return { right: rightNamed.notes, left: leftNamed.notes };
  }

  const sorted = [...withMeta].sort((a, b) => b.avgPitch - a.avgPitch);
  return { right: sorted[0].notes, left: sorted[1].notes };
}

// ── List-mode output ──────────────────────────────────────────────────────────
function printTrackList(parsed, inputPath) {
  console.log(`\nMIDI File : ${path.basename(inputPath)}`);
  console.log(
    `Format    : ${parsed.format}   PPQ: ${parsed.ppq}   BPM: ${parsed.bpm}`,
  );
  console.log(`Tracks    : ${parsed.tracks.length} total\n`);

  const headers = ["Idx", "Name", "GM Instrument(s)", "Notes", "Avg Pitch"];

  const rows = parsed.tracks.map((track, i) => {
    const noteCount = track.notes.length;

    const avgPitch =
      noteCount > 0
        ? midiNoteToName(
            Math.round(
              track.notes.reduce((s, n) => s + n.noteNumber, 0) / noteCount,
            ),
          )
        : "—";

    let gmCol;
    if (track.programs.length === 0) {
      gmCol = "(no program change)";
    } else {
      gmCol = track.programs
        .map((p) => {
          const name = GM_INSTRUMENTS[p] ?? `Program ${p}`;
          return `${name} [prog ${p}]`;
        })
        .join(", ");
    }

    return [
      String(i),
      track.name || "(unnamed)",
      gmCol,
      String(noteCount),
      avgPitch,
    ];
  });

  // compute column widths
  const colWidths = headers.map((h, ci) =>
    Math.max(h.length, ...rows.map((r) => r[ci].length)),
  );

  const sep = colWidths.map((w) => "─".repeat(w)).join("  ");
  const fmt = (row) =>
    row.map((cell, ci) => cell.padEnd(colWidths[ci])).join("  ");

  console.log(fmt(headers));
  console.log(sep);
  rows.forEach((row) => console.log(fmt(row)));
  console.log();
}

// ── Merge notes from given track indices ──────────────────────────────────────
function collectNotes(tracks, indices, semitones = 0) {
  const notes = indices.flatMap((idx) => {
    if (idx < 0 || idx >= tracks.length) {
      console.warn(
        `  Warning: track index ${idx} is out of range (${tracks.length} tracks), skipping.`,
      );
      return [];
    }
    const raw = tracks[idx].notes;
    if (semitones === 0) return raw;
    // Apply semitone transpose, clamping to valid MIDI range [0, 127]
    return raw.map((n) => ({
      ...n,
      noteNumber: Math.max(0, Math.min(127, n.noteNumber + semitones)),
    }));
  });
  // sort chronologically after merging
  notes.sort((a, b) => a.startTicks - b.startTicks);
  return notes;
}

// ── Build timeSignatures output array ─────────────────────────────────────────
function buildTimeSignatures(parsed, songEndTick) {
  if (parsed.timeSignatures && parsed.timeSignatures.length > 0) {
    const sigs = parsed.timeSignatures
      .map((s) => ({ ...s, beat: s.ticks / parsed.ppq }))
      .sort((a, b) => a.ticks - b.ticks);

    return sigs.map((s, i) => {
      const nextTick = i + 1 < sigs.length ? sigs[i + 1].ticks : songEndTick;
      const lengthTicks = Math.max(0, nextTick - s.ticks);
      const lengthBeats = lengthTicks / parsed.ppq;
      return {
        timeSignature: `${s.numerator}/${s.denominator}`,
        length: Math.ceil(lengthBeats),
      };
    });
  }

  const songEndBeats = songEndTick / parsed.ppq;
  return [{ timeSignature: "4/4", length: Math.ceil(songEndBeats) }];
}

// ── Entry point ───────────────────────────────────────────────────────────────
const args = parseArgs(process.argv);

if (!args.inputPath) {
  printUsage();
  process.exit(1);
}

const inputPath = path.resolve(process.cwd(), args.inputPath);
if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(2);
}

let buffer;
try {
  buffer = fs.readFileSync(inputPath);
} catch (err) {
  console.error("Failed to read input file:", err.message || err);
  process.exit(3);
}

let parsed;
try {
  parsed = parseMidi(buffer);
} catch (err) {
  console.error("Failed to parse MIDI file:", err.message || err);
  process.exit(4);
}

// ── --list mode ───────────────────────────────────────────────────────────────
if (args.list) {
  printTrackList(parsed, inputPath);
  process.exit(0);
}

// ── Convert mode ──────────────────────────────────────────────────────────────
const stemName = path.basename(inputPath, path.extname(inputPath));
const songId = args.id || stemName;
const defaultTitle = stemName
  .replace(/[-_]+/g, " ")
  .replace(/\b\w/g, (c) => c.toUpperCase());
const songTitle = args.title || defaultTitle;
const songComposer = args.composer || null;
const songDifficulty = args.difficulty || null;

// Build the list of output tracks from --track flags or auto-detect.
let outputTracks;

if (args.tracks.length > 0) {
  // ── Explicit track definitions via --track ──────────────────────────────────
  outputTracks = args.tracks.map(({ indices, instrument, semitones }, i) => {
    if (semitones) {
      const dir = semitones > 0 ? "up" : "down";
      console.log(
        `  Transpose (${instrument}): ${Math.abs(semitones)} semitone(s) ${dir}`,
      );
    }
    let actions = buildActions(
      collectNotes(parsed.tracks, indices, semitones),
      parsed.ppq,
    );
    // --trim applies to the first defined track only
    if (args.trim && i === 0) actions = trimMonophonicActions(actions);
    return { id: instrument, instrument, actions };
  });
} else {
  // ── Auto-detect (legacy: recorder + piano) ──────────────────────────────────
  const split = splitTracks(parsed);
  let mainActions = buildActions(split.right, parsed.ppq);
  if (args.trim) mainActions = trimMonophonicActions(mainActions);
  const otherActions = buildActions(split.left, parsed.ppq);
  outputTracks = [
    { id: "recorder", instrument: "recorder", actions: mainActions },
    { id: "piano", instrument: "piano", actions: otherActions },
  ];
}

// Compute song end tick across all tracks
const allNoteEndTicks = parsed.tracks.flatMap((trk) =>
  trk.notes.map((n) => (n.startTicks || 0) + (n.durationTicks || 0)),
);
const songEndTick =
  allNoteEndTicks.length > 0 ? Math.max(...allNoteEndTicks) : 0;

const outTimeSignatures = buildTimeSignatures(parsed, songEndTick);

const song = {
  id: songId,
  title: songTitle,
  ...(songComposer && { composer: songComposer }),
  bpm: parsed.bpm,
  timeSignatures: outTimeSignatures,
  tracks: outputTracks,
};

// Write public/songs/<id>.json
const publicSongsDir = path.resolve(process.cwd(), "public", "songs");
const outputPath = path.join(publicSongsDir, `${songId}.json`);

try {
  fs.mkdirSync(publicSongsDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(song, null, 2));
  console.log(`Wrote: ${outputPath}`);
} catch (err) {
  console.error("Failed to write song JSON:", err.message || err);
  process.exit(5);
}

// Optionally update public/songs/index.json
if (args.register) {
  const indexPath = path.join(publicSongsDir, "index.json");
  let index = [];
  try {
    const raw = fs.readFileSync(indexPath, "utf8");
    index = JSON.parse(raw);
    if (!Array.isArray(index)) index = [];
  } catch {
    // file not found or invalid JSON — start with empty array
    index = [];
  }

  const entry = {
    id: songId,
    title: songTitle,
    ...(songComposer && { composer: songComposer }),
    bpm: parsed.bpm,
    file: `${songId}.json`,
    ...(songDifficulty && { difficulty: songDifficulty }),
  };

  const existingIdx = index.findIndex((it) => it && it.id === songId);
  if (existingIdx !== -1) {
    index[existingIdx] = entry;
    console.log(`Updated existing entry "${songId}" in index.json`);
  } else {
    index.push(entry);
    console.log(`Added new entry "${songId}" to index.json`);
  }

  // Keep the index sorted alphabetically by title
  index.sort((a, b) => {
    const ta = (a.title || "").toLowerCase();
    const tb = (b.title || "").toLowerCase();
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  try {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    console.log(`Wrote: ${indexPath}`);
  } catch (err) {
    console.error("Failed to update index.json:", err.message || err);
    process.exit(6);
  }
}

process.exit(0);
