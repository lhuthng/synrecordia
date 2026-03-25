import fs from "node:fs";
import path from "node:path";

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

if (!inputArg || !trackIdArg) {
  console.error(
    "Usage: node scripts/shift-track-octave.mjs <json-path> <track-id> [up|down] [steps] [fromTime] [toTime]",
  );
  process.exit(1);
}

const inputPath = path.resolve(inputArg);
const direction = String(directionArg).toLowerCase();
const steps = Number.parseInt(stepsArg, 10);
const fromTime = fromArg === undefined ? -Infinity : Number(fromArg);
const toTime = toArg === undefined ? Infinity : Number(toArg);

if (!Number.isFinite(steps) || steps < 0) {
  console.error("Steps must be a non-negative integer");
  process.exit(1);
}

if (direction !== "up" && direction !== "down") {
  console.error('Direction must be either "up" or "down"');
  process.exit(1);
}

if (
  !Number.isFinite(fromTime) ||
  !Number.isFinite(toTime) ||
  fromTime > toTime
) {
  console.error(
    "fromTime and toTime must be finite numbers with fromTime <= toTime",
  );
  process.exit(1);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shiftNoteName(noteName, semitones) {
  const match = String(noteName).match(/^([A-G])(#?)(-?\d+)$/);
  if (!match) return noteName;

  const [, letter, sharp, octaveText] = match;
  const octave = Number(octaveText);

  if (!Number.isFinite(octave)) return noteName;

  const noteOrder = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };

  let midi = (octave + 1) * 12 + noteOrder[letter] + (sharp ? 1 : 0);
  midi += semitones;

  if (midi < 0) return noteName;

  const pitchClasses = [
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

  const pitchClass = pitchClasses[midi % 12];
  const shiftedOctave = Math.floor(midi / 12) - 1;
  return `${pitchClass}${shiftedOctave}`;
}

function shiftPitchValue(value, semitones) {
  if (typeof value === "string") {
    return shiftNoteName(value, semitones);
  }

  if (Array.isArray(value)) {
    return value.map((item) => shiftPitchValue(item, semitones));
  }

  if (isObject(value)) {
    const next = {};
    for (const [key, innerValue] of Object.entries(value)) {
      next[key] = shiftPitchValue(innerValue, semitones);
    }
    return next;
  }

  return value;
}

function shiftTrack(song, trackId, semitones, rangeStart, rangeEnd) {
  if (!isObject(song) || !Array.isArray(song.tracks)) {
    throw new Error("Invalid song JSON: expected a tracks array");
  }

  const nextSong = structuredClone(song);
  const track = nextSong.tracks.find((entry) => entry && entry.id === trackId);

  if (!track) {
    throw new Error(`Track not found: ${trackId}`);
  }

  if (!Array.isArray(track.actions)) {
    throw new Error(`Track "${trackId}" does not contain an actions array`);
  }

  track.actions = track.actions.map((action) => {
    if (!isObject(action)) return action;

    const nextAction = { ...action };
    const actionTime = Number(nextAction.time ?? 0);
    const isInRange = actionTime >= rangeStart && actionTime <= rangeEnd;

    if (isInRange && "pitch" in nextAction) {
      nextAction.pitch = shiftPitchValue(nextAction.pitch, semitones);
    }

    if (isInRange && "pitches" in nextAction) {
      nextAction.pitches = shiftPitchValue(nextAction.pitches, semitones);
    }

    return nextAction;
  });

  return nextSong;
}

const semitones = direction === "up" ? steps * 12 : -steps * 12;
const raw = fs.readFileSync(inputPath, "utf8");
const song = JSON.parse(raw);
const updated = shiftTrack(song, trackIdArg, semitones, fromTime, toTime);

fs.writeFileSync(inputPath, `${JSON.stringify(updated, null, 2)}\n`);
console.log(
  `Shifted track "${trackIdArg}" ${direction} by ${steps} octave(s) from ${fromTime} to ${toTime} in ${inputPath}`,
);
