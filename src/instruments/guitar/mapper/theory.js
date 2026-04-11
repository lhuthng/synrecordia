/**
 * Guitar theory helpers — flat-aware note ↔ MIDI conversion.
 *
 * Convention: C4 = 60  (i.e. pitch = pitchClass + (octave + 1) * 12)
 *
 * Supports sharps and flats:  "C#4", "Db4", "Eb3", "Bb2", "Gb3", "Ab2", etc.
 * `midiToNote` always uses the idiomatic sharp/flat name from PC_NAMES.
 */

/** @type {Record<string, number>} */
const NOTE_CLASS_MAP = {
  C:   0,  "B#":  0,
  "C#": 1, Db:   1,
  D:   2,
  "D#": 3, Eb:   3,
  E:   4,  Fb:   4,
  F:   5,  "E#": 5,
  "F#": 6, Gb:   6,
  G:   7,
  "G#": 8, Ab:   8,
  A:   9,
  "A#": 10, Bb: 10,
  B:  11,  Cb:  11,
};

/**
 * Preferred name for each pitch class (0–11).
 * Uses sharps for most accidentals; flats for Eb, Ab, Bb to match
 * common guitar-tuning notation.
 */
const PC_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/**
 * Convert a note name (e.g. "C#4", "Eb3", "A2", "Bb3") to a MIDI pitch integer.
 *
 * Supported formats: letter + optional accidental (# or b) + signed integer octave.
 * Convention: C4 = 60.
 *
 * @param {string} name
 * @returns {number}
 */
export function noteToMidi(name) {
  const m = String(name).match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) throw new Error(`Invalid note name: "${name}"`);
  const [, letter, acc, octStr] = m;
  const key = letter.toUpperCase() + acc;
  const pc  = NOTE_CLASS_MAP[key];
  if (pc === undefined) throw new Error(`Unknown pitch class: "${key}"`);
  return pc + (parseInt(octStr, 10) + 1) * 12;
}

/**
 * Convert a MIDI pitch integer to a note name (e.g. 60 → "C4").
 * Accidentals use the idiomatic names from PC_NAMES (sharps or flats).
 *
 * @param {number} midi
 * @returns {string}
 */
export function midiToNote(midi) {
  const oct = Math.floor(midi / 12) - 1;
  return PC_NAMES[((midi % 12) + 12) % 12] + oct;
}
