#!/usr/bin/env node
/**
 * convert-midi.mjs
 *
 * Usage:
 *   node scripts/convert-midi.mjs <input-path>
 *
 * Reads a MIDI file, converts to the project's song JSON format and writes:
 *   ./public/songs/<basename>.json
 * Then updates (or creates) ./public/songs/index.json to include the new song.
 *
 * Notes:
 * - This script intentionally accepts only the input path. Outputs are written
 *   under the project's `public/songs` directory relative to CWD.
 * - It attempts to be robust when index.json doesn't exist or is invalid.
 */

import fs from "fs";
import path from "path";

const [, , inputArg] = process.argv;

if (!inputArg) {
  console.error("Usage: node scripts/convert-midi.mjs <input-path>");
  process.exit(1);
}

const inputPath = path.resolve(process.cwd(), inputArg);
if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(2);
}

const baseName = path.basename(inputPath, path.extname(inputPath));
const title = baseName
  .replace(/[-_]+/g, " ")
  .replace(/\b\w/g, (c) => c.toUpperCase());

let buffer;
try {
  buffer = fs.readFileSync(inputPath);
} catch (err) {
  console.error("Failed to read input file:", err.message || err);
  process.exit(3);
}

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
      throw new Error(`Invalid track header at ${offset}`);
    offset += 4;

    const trackLength = readUint32(buf, offset);
    offset += 4;

    const trackEnd = offset + trackLength;
    const notes = [];
    const noteOnMap = new Map();
    let trackName = null;
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
        if (runningStatus === null)
          throw new Error("Running status encountered without previous status");
        statusByte = runningStatus;
      }

      if (statusByte === 0xff) {
        const metaType = buf[offset++];
        const lengthResult = readVarInt(buf, offset);
        const length = lengthResult.value;
        offset = lengthResult.offset;
        const data = buf.slice(offset, offset + length);
        offset += length;

        if (metaType === 0x03) {
          trackName = data.toString("ascii");
        } else if (metaType === 0x51 && length === 3 && firstTempo === null) {
          const tempo = (data[0] << 16) | (data[1] << 8) | data[2];
          firstTempo = tempo;
        } else if (metaType === 0x58 && length >= 2) {
          // time signature meta event: [nn, dd, cc, bb]
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

      if (eventType === 0x90) {
        const noteNumber = data1;
        const velocity = data2 ?? 0;
        if (velocity === 0) {
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
      } else if (eventType === 0x80) {
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

    tracks.push({ name: trackName, notes });
  }

  const bpm = firstTempo ? Math.round(60000000 / firstTempo) : 120;
  return { format, ppq, tracks, bpm, timeSignatures };
}

function quantizeBeats(value, grid = 1 / 12) {
  return Math.round(value / grid) * grid;
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
        .sort((a, b) => {
          const midiA = pitchNameToMidi(a);
          const midiB = pitchNameToMidi(b);
          return midiA - midiB;
        });

      const duration = Number(
        quantizeBeats(Math.max(...group.map((note) => note.duration))).toFixed(
          6,
        ),
      );

      const velocity = Math.round(
        group.reduce((sum, note) => sum + note.velocity, 0) / group.length,
      );

      return { type: "note", time, duration, pitches, velocity };
    })
    .sort((a, b) => a.time - b.time);

  return actions;
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

function splitTracks(parsed) {
  const candidateTracks = parsed.tracks.filter(
    (track) => track.notes.length > 0,
  );
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

  const rightNamed = withMeta.find((track) =>
    /right|rh/i.test(track.name || ""),
  );
  const leftNamed = withMeta.find((track) => /left|lh/i.test(track.name || ""));

  if (rightNamed && leftNamed && rightNamed !== leftNamed) {
    return { right: rightNamed.notes, left: leftNamed.notes };
  }

  const sorted = [...withMeta].sort((a, b) => b.avgPitch - a.avgPitch);
  return { right: sorted[0].notes, left: sorted[1].notes };
}

// --- main conversion flow ---
let parsed;
try {
  parsed = parseMidi(buffer);
} catch (err) {
  console.error("Failed to parse MIDI file:", err.message || err);
  process.exit(4);
}

const split = splitTracks(parsed);

// build actions (no padding — keep action times unchanged)
const recorderActions = buildActions(split.right, parsed.ppq);
const pianoActions = buildActions(split.left, parsed.ppq);

// compute song end tick (max of notes end)
const allNoteEndTicks = parsed.tracks.flatMap((trk) =>
  trk.notes.map((n) => (n.startTicks || 0) + (n.durationTicks || 0)),
);
const songEndTick =
  allNoteEndTicks.length > 0 ? Math.max(...allNoteEndTicks) : 0;
const songEndBeats = songEndTick / parsed.ppq;

// construct timeSignatures output as array of { timeSignature, length } in beats
let outTimeSignatures = [];
if (parsed.timeSignatures && parsed.timeSignatures.length > 0) {
  const sigs = parsed.timeSignatures
    .map((s) => ({ ...s, beat: s.ticks / parsed.ppq }))
    .sort((a, b) => a.ticks - b.ticks);

  for (let i = 0; i < sigs.length; i++) {
    const s = sigs[i];
    const nextTick = i + 1 < sigs.length ? sigs[i + 1].ticks : songEndTick;
    const lengthTicks = Math.max(0, nextTick - s.ticks);
    const lengthBeats = lengthTicks / parsed.ppq;
    // round up length to the next integer beat
    outTimeSignatures.push({
      timeSignature: `${s.numerator}/${s.denominator}`,
      length: Math.ceil(lengthBeats),
    });
  }
} else {
  // default to single 4/4 covering entire song (round up length to next integer beat)
  outTimeSignatures.push({
    timeSignature: "4/4",
    length: Math.ceil(songEndBeats),
  });
}

const song = {
  id: baseName,
  title,
  bpm: parsed.bpm,
  // timeSignatures array: each entry has { timeSignature, length } (length in beats)
  timeSignatures: outTimeSignatures,
  tracks: [
    { id: "recorder", instrument: "recorder", actions: recorderActions },
    { id: "piano", instrument: "piano", actions: pianoActions },
  ],
};

// Write output file to public/songs/<baseName>.json under current working dir
const publicSongsDir = path.resolve(process.cwd(), "public", "songs");
const outputPath = path.join(publicSongsDir, `${baseName}.json`);

try {
  fs.mkdirSync(publicSongsDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(song, null, 2));
  console.log(`Wrote ${outputPath}`);
} catch (err) {
  console.error("Failed to write song JSON:", err.message || err);
  process.exit(5);
}

// Update public/songs/index.json to include this song (create or update)
const indexPath = path.join(publicSongsDir, "index.json");
let index = [];
try {
  const raw = fs.readFileSync(indexPath, "utf8");
  index = JSON.parse(raw);
  if (!Array.isArray(index)) index = [];
} catch (e) {
  // file not found or invalid JSON — start with empty index
  index = [];
}

// Build index entry
const entry = {
  id: baseName,
  title,
  bpm: parsed.bpm,
  file: `${baseName}.json`,
};

// Update or append
const existingIndex = index.findIndex((it) => it && it.id === baseName);
if (existingIndex !== -1) {
  index[existingIndex] = entry;
} else {
  index.push(entry);
}

// Sort index alphabetically by title (case-insensitive) for nicer listing
index.sort((a, b) => {
  const ta = (a.title || "").toLowerCase();
  const tb = (b.title || "").toLowerCase();
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  return 0;
});

try {
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`Updated ${indexPath}`);
} catch (err) {
  console.error("Failed to update songs index:", err.message || err);
  process.exit(6);
}

process.exit(0);
