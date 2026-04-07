import PackedSampler from ".";
import * as Tone from "tone";
import Harpsichord from "../../components/instruments/Harpsichord";

const MAX_DB = 6;
const DEFAULT_DB = -3;
const MIN_DB = -60;

export default class HarpsichordSampler extends PackedSampler {
  constructor(urls, baseUrl, callback, addition) {
    super(addition);

    this.reverb = new Tone.Reverb({
      decay: 1.5,
      preDelay: 0.01,
      wet: 0.08,
    }).toDestination();

    this.volume = new Tone.Volume(DEFAULT_DB).connect(this.reverb);

    this.samplerData = { urls, baseUrl };
    this.sampler = new Tone.Sampler({
      urls,
      baseUrl,
      onload: () => callback?.(),
    }).connect(this.volume);
  }

  dispose() {
    [this.sampler, this.volume, this.reverb].forEach((node) => node.dispose());

    this.sampler = null;
    this.volume = null;
    this.reverb = null;
  }

  getNoteRange() {
    // Standard 88-key piano: A0 (MIDI 21) to C8 (MIDI 108)
    return { min: 21, max: 108 };
  }

  getPresentation() {
    return Harpsichord;
  }

  getVolume() {
    const currentDb = this.volume.volume.value;
    if (currentDb <= MIN_DB) return 0;
    if (currentDb >= MAX_DB) return 100;

    return Math.round(((currentDb - MIN_DB) / (MAX_DB - MIN_DB)) * 100);
  }

  setVolume(percent) {
    if (percent <= 0) {
      this.volume.volume.value = -Infinity;
      return;
    }

    const db = (percent / 100) * (MAX_DB - MIN_DB) + MIN_DB;

    this.volume.volume.rampTo(db, 0.1);
  }

  async setVersion(version, callback) {
    await super.setVersion(version);

    this.samplerData = await this.fetchSampler();

    if (!this.samplerData) return;

    this.sampler.dispose();
    this.sampler = new Tone.Sampler({
      ...this.samplerData,
      onload: () => callback?.(),
    }).connect(this.volume);
  }
}
