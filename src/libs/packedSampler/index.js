import PianoSampler from "../packedSamplers/piano";
import RecorderSampler from "../packedSamplers/recorder";

export default class PackedSampler {
  constructor() {
    if (new.target === PackedSampler) {
      throw new Error("PackedSampler is abstract and cannot be instantiated.");
    }
    this.sampler = null;
  }

  getSampler() {
    return this.sampler;
  }

  dispose() {
    throw new Error("Method 'dispose()' must be implemented.");
  }
}

export function createPackedSampler(name, urls, baseUrl, callback) {
  switch (name) {
    case "recorder":
      return new RecorderSampler(urls, baseUrl, callback);
    case "piano":
      return new PianoSampler(urls, baseUrl, callback);
    default:
      return new RecorderSampler(urls, baseUrl, callback);
  }
}
