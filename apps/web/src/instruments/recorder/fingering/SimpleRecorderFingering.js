import BaseFingeringResolver from "./BaseFingeringResolver";
import fingeringChart from "../../../assets/references/fingering-chart.json";

export default class SimpleRecorderFingering extends BaseFingeringResolver {
  constructor(noteOffset = 0) {
    super(noteOffset);
  }

  getPattern(noteName) {
    const map = fingeringChart.systems.simple ?? {};
    const entry = map[this.shiftedNote(noteName)];
    if (!entry) return null;
    if (typeof entry === "string") return entry;
    return entry["I"] ?? Object.values(entry)[0] ?? null;
  }
}
