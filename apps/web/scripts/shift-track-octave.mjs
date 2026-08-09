#!/usr/bin/env node
/**
 * shift-track-octave.mjs
 *
 * Shifts all notes in a specific track of a song JSON file up or down by a
 * given number of octaves. Optionally restricts the shift to a time range.
 * The file is modified in place.
 *
 * Usage:
 *   node scripts/shift-track-octave.mjs <json-path> <track-id> [up|down] [steps] [fromTime] [toTime]
 *
 * Arguments:
 *   json-path   Path to the song JSON file (modified in place).
 *   track-id    The `id` field of the track to shift.
 *   up|down     Direction to shift (default: "up").
 *   steps       Number of octaves to shift (default: 1).
 *   fromTime    Start of the time range in beats (default: beginning).
 *   toTime      End of the time range in beats (default: end).
 */

import fs from "node:fs";
import path from "node:path";

// ── Argument parsing ──────────────────────────────────────────────────────────

const [
  ,
  ,
  inputArg,
  trackIdArg,
  directionArg = "up",
  stepsArg = "1",
  fromArg,
  toArg,
] = process.argv;

function validateArgs() {
  if (!inputArg || !trackIdArg) {
    console.error(
      "Usage: node scripts/shift-track-octave.mjs <json-path> <track-id> [up|down] [steps] [fromTime] [toTime]",
    );
    process.exit(1);
  }

  const direction = String(directionArg).toLowerCase();
  if (direction !== "up" && direction !== "down") {
    console.error('Direction must be "up" or "down".');
    process.exit(1);
  }

  const steps = Number.parseInt(stepsArg, 10);
  if (!Number.isFinite(steps) || steps < 0) {
    console.error("Steps must be a non-negative integer.");
    process.exit(1);
  }

  const fromTime = fromArg === undefined ? -Infinity : Number(fromArg);
  const toTime = toArg === undefined ? Infinity : Number(toArg);

  if (
    (fromArg !== undefined && !Number.isFinite(fromTime)) ||
    (toArg !== undefined && !Number.isFinite(toTime))
  ) {
    console.error("fromTime and toTime must be finite numbers.");
    process.exit(1);
  }

  if (fromTime > toTime) {
    console.error("fromTime must be less than or equal to toTime.");
    process.exit(1);
  }

  return { direction, steps, fromTime, toTime };
}

// ── Pitch helpers ─────────────────────────────────────────────────────────────

const NOTE_ORDER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PITCH_CLASSES = [
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

function shiftNoteName(noteName, semitones) {
  const match = String(noteName).match(/^([A-G])(#?)(-?\d+)$/);
  if (!match) return noteName;

  const [, letter, sharp, octaveText] = match;
  const octave = Number(octaveText);
  if (!Number.isFinite(octave)) return noteName;

  let midi = (octave + 1) * 12 + NOTE_ORDER[letter] + (sharp ? 1 : 0);
  midi += semitones;
  if (midi < 0) return noteName;

  return `${PITCH_CLASSES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function shiftPitchValue(value, semitones) {
  if (typeof value === "string") return shiftNoteName(value, semitones);
  if (Array.isArray(value))
    return value.map((item) => shiftPitchValue(item, semitones));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shiftPitchValue(v, semitones)]),
    );
  }
  return value;
}

// ── Track transform ───────────────────────────────────────────────────────────

function shiftTrack(song, trackId, semitones, rangeStart, rangeEnd) {
  if (!song || !Array.isArray(song.tracks)) {
    throw new Error("Invalid song JSON: expected a tracks array.");
  }

  const result = structuredClone(song);
  const track = result.tracks.find((t) => t?.id === trackId);

  if (!track) throw new Error(`Track not found: "${trackId}".`);
  if (!Array.isArray(track.actions)) {
    throw new Error(`Track "${trackId}" has no actions array.`);
  }

  track.actions = track.actions.map((action) => {
    if (!action || typeof action !== "object") return action;

    const time = Number(action.time ?? 0);
    if (time < rangeStart || time > rangeEnd) return action;

    const shifted = { ...action };
    if ("pitch" in shifted)
      shifted.pitch = shiftPitchValue(shifted.pitch, semitones);
    if ("pitches" in shifted)
      shifted.pitches = shiftPitchValue(shifted.pitches, semitones);
    return shifted;
  });

  return result;
}

// ── Entry point ───────────────────────────────────────────────────────────────

function main() {
  const { direction, steps, fromTime, toTime } = validateArgs();

  const inputPath = path.resolve(inputArg);
  const song = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const semitones = direction === "up" ? steps * 12 : -(steps * 12);
  const updated = shiftTrack(song, trackIdArg, semitones, fromTime, toTime);

  fs.writeFileSync(inputPath, `${JSON.stringify(updated, null, 2)}\n`);

  const rangeDesc =
    fromTime === -Infinity && toTime === Infinity
      ? "entire song"
      : `beats ${fromTime}–${toTime}`;
  console.log(
    `Shifted track "${trackIdArg}" ${direction} by ${steps} octave(s) (${rangeDesc}) in ${inputPath}`,
  );
}

main();
