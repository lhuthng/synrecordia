import PackedSampler from ".";
import * as Tone from "tone";
import Recorder from "../../components/instruments/Recorder";

const MAX_DB = 40;
const DEFAULT_DB = 15;
const MIN_DB = -20;

export default class RecorderSampler extends PackedSampler {
  constructor(urls, baseUrl, callback, addition) {
    super(addition);

    this.vibrato = new Tone.Vibrato(5, 0.1).toDestination();
    this.reverb = new Tone.Reverb({
      decay: 5,
      preDelay: 0.02,
      wet: 0.15,
    }).connect(this.vibrato);
    this.filter = new Tone.Filter(2000, "lowpass").connect(this.reverb);

    this.volume = new Tone.Volume(DEFAULT_DB).connect(this.reverb);

    this.samplerData = { urls, baseUrl };
    this.sampler = new Tone.Sampler({
      urls,
      baseUrl,
      onload: () => callback?.(),
    }).connect(this.volume);
  }

  dispose() {
    [this.sampler, this.volume, this.filter, this.reverb, this.vibrato].forEach(
      (node) => node.dispose(),
    );
  }
  getPresentation() {
    return Recorder;
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

  getVibrato() {
    const depth = this.vibrato.depth.value;
    return Math.round(depth * 100);
  }

  setVibrato(value) {
    if (value < 0) value = 0;
    if (value > 100) value = 100;

    const depth = value / 100; // convert to 0–1 range
    this.vibrato.depth.rampTo(depth, 0.1);
  }
}
