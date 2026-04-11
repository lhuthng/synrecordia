import { noteNameToMidi, midiToNoteName } from "../../../libs/utils.js";

export default class BaseFingeringResolver {
  constructor(noteOffset = 0) {
    this.noteOffset = noteOffset;
  }

  /**
   * Shift the incoming note name backward by noteOffset so it aligns with
   * the tenor-based fingering chart.
   */
  shiftedNote(noteName) {
    if (!this.noteOffset) return noteName;
    const midi = noteNameToMidi(noteName);
    if (midi === null) return noteName;
    return midiToNoteName(Math.max(0, Math.min(127, midi - this.noteOffset)));
  }

  getPattern() {
    throw new Error(
      `${this.constructor.name}.getPattern() must be implemented.`,
    );
  }
}
