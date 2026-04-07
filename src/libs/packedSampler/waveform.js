import * as Tone from "tone";
import WaveformComponent from "../../components/instruments/Waveform";

const WAVEFORMS = ["sine", "square", "triangle", "sawtooth"];
const MAX_DB = -10;
const DEFAULT_DB = -20;
const MIN_DB = -80;

const REVERB_WET = 0.1;
const CHORUS_WET = 0.5;

export default class WaveformSynth {
  constructor(callback, ecoMode = false) {
    this.name = "waveform";
    this.version = "sine";

    if (!ecoMode) {
      this.reverb = new Tone.Freeverb({
        roomSize: 0.7,
        dampening: 3200,
        wet: REVERB_WET,
      }).toDestination();
      this.chorus = new Tone.Chorus(4, 2.5, CHORUS_WET)
        .connect(this.reverb)
        .start();
      this.volume = new Tone.Volume(DEFAULT_DB).connect(this.chorus);
    } else {
      this.reverb = null;
      this.chorus = null;
      this.volume = new Tone.Volume(DEFAULT_DB).toDestination();
    }

    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 1.2 },
    }).connect(this.volume);

    setTimeout(() => callback?.(), 0);
  }

  getSampler() {
    return this.synth;
  }

  getVersion() {
    return this.version;
  }

  getAlternatives() {
    return WAVEFORMS;
  }

  getNoteRange() {
    return { min: 21, max: 108 };
  }

  getPresentation() {
    return WaveformComponent;
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

  setVersion(waveform, callback) {
    this.version = waveform;
    this.synth.set({ oscillator: { type: waveform } });
    callback?.();
  }

  /** Smoothly bypass (or restore) reverb + chorus for runtime eco mode toggling. */
  setEcoMode(enabled) {
    if (this.reverb) {
      this.reverb.wet.rampTo(enabled ? 0 : REVERB_WET, 0.5);
    }
    if (this.chorus) {
      this.chorus.wet.rampTo(enabled ? 0 : CHORUS_WET, 0.5);
    }
  }

  dispose() {
    [this.synth, this.volume, this.chorus, this.reverb]
      .filter(Boolean)
      .forEach((n) => n.dispose());
    this.synth = null;
    this.volume = null;
    this.chorus = null;
    this.reverb = null;
  }
}
