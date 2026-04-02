import { noteNameToMidi } from "../utils.js";

export default class PackedSampler {
  constructor(addition) {
    this.name = addition.name;
    this.alternatives = addition.alternatives.versions;
    this.version = addition.version;
  }

  async fetchSampler() {
    const baseUrl = `/samples/${this.name}/${this.version}/`;
    const urlsResponse = await fetch(`${baseUrl}index.json`);

    if (!urlsResponse.ok) return;

    return {
      urls: await urlsResponse.json(),
      baseUrl,
    };
  }

  getSampler() {
    return this.sampler;
  }

  getVersion() {
    return this.version;
  }

  async setVersion(version) {
    this.version = version;
  }

  getAlternatives() {
    return this.alternatives;
  }

  /**
   * Returns {min, max} MIDI numbers derived from this sampler's loaded sample keys,
   * or null if the sampler data is not yet available.
   */
  getNoteRange() {
    const urls = this.samplerData?.urls;
    if (!urls) return null;
    const midiNums = Object.keys(urls)
      .map((name) => noteNameToMidi(name))
      .filter((n) => n !== null);
    if (midiNums.length === 0) return null;
    return { min: Math.min(...midiNums), max: Math.max(...midiNums) };
  }

  dispose() {
    throw new Error("Method 'dispose()' must be implemented.");
  }

  getPresentation() {
    throw new Error("Method 'getPresentation()' must be implemented.");
  }
}
