/**
 * Guitar tunings — standard and alternate tunings for 6- and 7-string guitars.
 *
 * Convention: string index 0 = highest-pitched string (high E in standard).
 */

import { noteToMidi } from "./theory.js";

/**
 * Map from tuning name to array of open-string note names.
 * Index 0 is the highest-pitched string (e.g. high E in standard tuning).
 *
 * @type {Record<string, string[]>}
 */
export const TUNINGS = {
  STANDARD:       ["E4", "B3", "G3", "D3", "A2", "E2"],
  E_FLAT:         ["Eb4", "Bb3", "Gb3", "Db3", "Ab2", "Eb2"],
  DROP_D:         ["E4", "B3", "G3", "D3", "A2", "D2"],
  D_STANDARD:     ["D4", "A3", "F3", "C3", "G2", "D2"],
  DROP_C:         ["D4", "A3", "F3", "C3", "G2", "C2"],
  OPEN_G:         ["D4", "B3", "G3", "D3", "G2", "D2"],
  OPEN_E:         ["E4", "B3", "G#3", "E3", "B2", "E2"],
  OPEN_D:         ["D4", "A3", "F#3", "D3", "A2", "D2"],
  DADGAD:         ["D4", "A3", "G3", "D3", "A2", "D2"],
  OPEN_C6:        ["E4", "C4", "G3", "C3", "A2", "C2"],
  BARITONE_B:     ["B3", "F#3", "D3", "A2", "E2", "B1"],
  BARITONE_A:     ["A3", "E3", "C3", "G2", "D2", "A1"],
  SEVEN_STANDARD: ["E4", "B3", "G3", "D3", "A2", "E2", "B1"],
  SEVEN_DROP_A:   ["E4", "B3", "G3", "D3", "A2", "E2", "A1"],
};

/**
 * Return the MIDI pitches for each open string of the named tuning.
 * Index 0 = highest-pitched string, matching the TUNINGS order.
 *
 * @param {string} tuningName  Key from TUNINGS (e.g. "STANDARD", "DROP_D").
 * @returns {number[]}
 * @throws {Error} If `tuningName` is not a recognised tuning key.
 */
export function getOpenMidis(tuningName) {
  const notes = TUNINGS[tuningName];
  if (!notes) {
    throw new Error(
      `Unknown tuning: "${tuningName}". ` +
      `Available: ${Object.keys(TUNINGS).join(", ")}`,
    );
  }
  return notes.map(noteToMidi);
}
