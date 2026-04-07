import PackedSampler from ".";
import * as Tone from "tone";
import Recorder from "../../components/instruments/Recorder";
import fingeringChart from "../../assets/references/fingering-chart.json";
import { noteNameToMidi } from "../utils.js";

const MAX_DB = 0;
const DEFAULT_DB = -12;
const MIN_DB = -40;

const REVERB_WET = 0.05;
const VIBRATO_WET = 1.0;

export default class RecorderSampler extends PackedSampler {
  constructor(urls, baseUrl, callback, addition) {
    super(addition);

    const ecoMode = addition?.ecoMode ?? false;

    if (!ecoMode) {
      this.vibrato = new Tone.Vibrato(5, 0.1).toDestination();
      this.reverb = new Tone.Freeverb({
        roomSize: 0.85,
        dampening: 3000,
        wet: REVERB_WET,
      }).connect(this.vibrato);
      this.volume = new Tone.Volume(DEFAULT_DB).connect(this.reverb);
    } else {
      this.vibrato = null;
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
    [this.sampler, this.volume, this.reverb, this.vibrato]
      .filter(Boolean)
      .forEach((node) => node.dispose());
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

  getNoteRange(fingeringSystem = "baroque", recorderType = "tenor") {
    const chartKey = fingeringSystem === "simple" ? "simple" : "recorder";
    const system = fingeringChart.systems?.[chartKey];
    const noteOffset = fingeringChart.types?.[recorderType]?.noteOffset ?? 0;

    if (system) {
      const midiNums = Object.keys(system)
        .map((name) => noteNameToMidi(name))
        .filter((n) => n !== null)
        .map((n) => n + noteOffset);
      if (midiNums.length > 0) {
        return { min: Math.min(...midiNums), max: Math.max(...midiNums) };
      }
    }

    // Fall back to sample-based range from the base class
    return super.getNoteRange();
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
    if (!this.vibrato) return 10; // default depth % when eco mode (no vibrato node)
    const depth = this.vibrato.depth.value;
    return Math.round(depth * 100);
  }

  setVibrato(value) {
    if (!this.vibrato) return;
    if (value < 0) value = 0;
    if (value > 100) value = 100;

    const depth = value / 100; // convert to 0–1 range
    this.vibrato.depth.rampTo(depth, 0.1);
  }

  /** Smoothly bypass (or restore) reverb + vibrato for runtime eco mode toggling. */
  setEcoMode(enabled) {
    if (this.reverb) {
      this.reverb.wet.rampTo(enabled ? 0 : REVERB_WET, 0.5);
    }
    if (this.vibrato) {
      this.vibrato.wet.rampTo(enabled ? 0 : VIBRATO_WET, 0.5);
    }
  }
}
