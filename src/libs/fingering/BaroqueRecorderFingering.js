import BaseFingeringResolver from "./BaseFingeringResolver";
import fingeringChart from "../../assets/references/fingering-chart.json";

export default class BaroqueRecorderFingering extends BaseFingeringResolver {
  getPattern(noteName) {
    const map = fingeringChart.systems?.recorder ?? {};
    const entry = map[noteName];
    if (!entry) return null;
    if (typeof entry === "string") return entry;
    return entry["B"] ?? entry["I"] ?? Object.values(entry)[0] ?? null;
  }
}
