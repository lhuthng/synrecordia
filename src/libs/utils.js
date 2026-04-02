import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const NOTE_NAMES = [
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

/** Convert a note name like "C4", "D#5", "A#3" → MIDI number (0-127), or null on invalid input. */
export function noteNameToMidi(name) {
  const match = name?.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return null;
  const [, note, octaveStr] = match;
  const idx = NOTE_NAMES.indexOf(note);
  if (idx === -1) return null;
  const octave = parseInt(octaveStr, 10);
  return (octave + 1) * 12 + idx;
}

/** Convert a MIDI number (0-127) → note name like "C4", "D#5". */
export function midiToNoteName(midi) {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)));
  const note = NOTE_NAMES[clamped % 12];
  const octave = Math.floor(clamped / 12) - 1;
  return `${note}${octave}`;
}

/**
 * Transpose a note name by the given number of semitones.
 * Returns the original note name if it cannot be parsed.
 */
export function transposeNote(noteName, semitones) {
  if (!semitones || !noteName) return noteName;
  const midi = noteNameToMidi(noteName);
  if (midi === null) return noteName;
  return midiToNoteName(Math.max(0, Math.min(127, midi + semitones)));
}

/**
 * Apply a semitone transpose to a note or array of notes.
 * Handles both a single note name string and an array of note name strings.
 */
export function transposeNotes(rawNotes, semitones) {
  if (!semitones) return rawNotes;
  if (Array.isArray(rawNotes))
    return rawNotes.map((n) => transposeNote(n, semitones));
  return transposeNote(rawNotes, semitones);
}

/**
 * Compute the MIDI note range {min, max} covered by an actions array.
 * Returns null if no notes are found.
 */
export function computeNoteRangeFromActions(actions) {
  let min = Infinity;
  let max = -Infinity;
  for (const action of actions ?? []) {
    if (action.type !== "note") continue;
    const pitches = Array.isArray(action.pitches)
      ? action.pitches
      : action.pitch
        ? [action.pitch]
        : [];
    for (const p of pitches) {
      const midi = noteNameToMidi(p);
      if (midi !== null) {
        min = Math.min(min, midi);
        max = Math.max(max, midi);
      }
    }
  }
  return min === Infinity ? null : { min, max };
}
