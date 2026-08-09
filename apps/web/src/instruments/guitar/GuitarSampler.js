import PackedSampler from "../core/PackedSampler.js";
import * as Tone from "tone";
import GuitarComponent from "./GuitarComponent.jsx";

// Balanced-mode preset defaults — mirrors GuitarMapper.js PRESETS.balanced.
const DEFAULT_MAPPER_OPTIONS = {
  mode: "balanced",
  leftHandWeight: 0.5,
  rightHandWeight: 0.5,
  monophonic: false,
};

const MAX_DB = 6;
const DEFAULT_DB = -4;
const MIN_DB = -60;

const REVERB_WET = 0.2;

export default class GuitarSampler extends PackedSampler {
  constructor(urls, baseUrl, callback, addition) {
    super(addition);
    this._mapperOptions = { ...DEFAULT_MAPPER_OPTIONS };

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
    return GuitarComponent;
  }

  /** Returns a shallow copy of the current fret-mapper options. */
  getMapperOptions() {
    return { ...this._mapperOptions };
  }

  /**
   * Merges the supplied options into the stored mapper config so the Guitar
   * panel can restore the last-used values when reopened.
   *
   * @param {{ mode?: string, leftHandWeight?: number, rightHandWeight?: number }} opts
   */
  setMapperOptions(opts) {
    this._mapperOptions = { ...this._mapperOptions, ...opts };
  }

  /**
   * Returns true when the user has enabled monophonic mode via the Guitar panel.
   * Reads the live value from _mapperOptions so toggling the UI takes effect
   * on the next startPlayback() call without needing any extra refs.
   */
  isMonophonic() {
    return this._mapperOptions.monophonic === true;
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
