import PackedSampler from ".";
import * as Tone from "tone";
import Guitar from "../../components/instruments/Guitar";

const MAX_DB = 6;
const DEFAULT_DB = -5;
const MIN_DB = -60;

const REVERB_WET = 0.2;

export default class GuitarSampler extends PackedSampler {
  constructor(urls, baseUrl, callback, addition) {
    super(addition);

    const ecoMode = addition?.ecoMode ?? false;

    if (!ecoMode) {
      this.reverb = new Tone.Freeverb({
        roomSize: 0.8,
        dampening: 3200,
        wet: REVERB_WET,
      }).toDestination();
      this.volume = new Tone.Volume(DEFAULT_DB).connect(this.reverb);
    } else {
      this.reverb = null;
      this.volume = new Tone.Volume(DEFAULT_DB).toDestination();
    }

    this.samplerData = { urls, baseUrl };
    this.sampler = new Tone.Sampler({
      urls,
      baseUrl,
      onload: () => callback?.(),
    }).connect(this.volume);
  }

  dispose() {
    [this.sampler, this.volume, this.reverb]
      .filter(Boolean)
      .forEach((node) => node.dispose());

    this.sampler = null;
    this.volume = null;
    this.reverb = null;
  }

  getPresentation() {
    return Guitar;
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

  /** Smoothly bypass (or restore) the reverb wet mix for runtime eco mode toggling. */
  setEcoMode(enabled) {
    if (this.reverb) {
      this.reverb.wet.rampTo(enabled ? 0 : REVERB_WET, 0.5);
    }
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
