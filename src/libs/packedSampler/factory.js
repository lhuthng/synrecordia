import PianoSampler from "./piano";
import RecorderSampler from "./recorder";

export function createPackedSampler(name, urls, baseUrl, callback, addition) {
  switch (name) {
    case "recorder":
      return new RecorderSampler(urls, baseUrl, callback, addition);
    case "piano":
      return new PianoSampler(urls, baseUrl, callback, addition);
    default:
      return new RecorderSampler(urls, baseUrl, callback, addition);
  }
}
