import BaroqueRecorderFingering from "./BaroqueRecorderFingering";
import GermanRecorderFingering from "./GermanRecorderFingering";
import SimpleRecorderFingering from "./SimpleRecorderFingering";

export function createFingeringResolver(system) {
  switch (system) {
    case "german":
      return new GermanRecorderFingering();
    case "simple":
      return new SimpleRecorderFingering();
    case "baroque":
    default:
      return new BaroqueRecorderFingering();
  }
}
