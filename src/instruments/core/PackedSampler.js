import { noteNameToMidi } from "../../libs/utils.js";

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

  /**
   * Whether the underlying Tone.js sampler has finished loading all samples.
   * The player checks `synth.loaded !== false` before scheduling notes.
   * Delegating here means the player can hold a PackedSampler reference directly
   * instead of needing the inner Tone object.
   */
  get loaded() {
    return this.sampler?.loaded ?? false;
  }

  /**
   * Schedule a note (or chord) to play via the underlying Tone.js sampler.
   * Delegating here keeps the player fully decoupled from Tone internals and
   * allows PackedSampler subclasses to intercept scheduling if needed.
   */
  triggerAttackRelease(notes, duration, time, velocity) {
    return this.sampler.triggerAttackRelease(notes, duration, time, velocity);
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

  /**
   * Returns true when this instrument is monophonic (one note at a time).
   *
   * The player scheduler calls this once per track when startPlayback() fires.
   * Return true to receive only the highest pitch of any polyphonic chord action;
   * return false (the default) to receive all pitches as-is.
   *
   * Subclasses override this to declare their polyphony contract.
   * The player never inspects instrument names — it only calls this method.
   */
  isMonophonic() {
    return false;
  }

  dispose() {
    throw new Error("Method 'dispose()' must be implemented.");
  }

  getPresentation() {
    throw new Error("Method 'getPresentation()' must be implemented.");
  }
}
