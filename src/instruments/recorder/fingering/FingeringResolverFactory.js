import BaroqueRecorderFingering from "./BaroqueRecorderFingering";
import GermanRecorderFingering from "./GermanRecorderFingering";
import SimpleRecorderFingering from "./SimpleRecorderFingering";
import fingeringChart from "../../../assets/references/fingering-chart.json";

export function createFingeringResolver(system, recorderType = "tenor") {
  const noteOffset = fingeringChart.types?.[recorderType]?.noteOffset ?? 0;
  switch (system) {
    case "german":
      return new GermanRecorderFingering(noteOffset);
    case "simple":
      // Simple fingering is always tenor-based; always use offset 0
      return new SimpleRecorderFingering(0);
    case "baroque":
    default:
      return new BaroqueRecorderFingering(noteOffset);
  }
}
