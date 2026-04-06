import * as Tone from "tone";
import WaveformComponent from "../../components/instruments/Waveform";

const WAVEFORMS = ["sine", "square", "triangle", "sawtooth"];
const MAX_DB = 0;
const DEFAULT_DB = -10;
const MIN_DB = -60;

export default class WaveformSynth {
  constructor(callback) {
    this.name = "waveform";
    this.version = "sine";

    this.reverb = new Tone.Reverb({
      decay: 2.5,
      preDelay: 0.01,
      wet: 0.2,
    }).toDestination();
    this.chorus = new Tone.Chorus(4, 2.5, 0.5).connect(this.reverb).start();
    this.volume = new Tone.Volume(DEFAULT_DB).connect(this.chorus);

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

  dispose() {
    [this.synth, this.volume, this.chorus, this.reverb].forEach((n) =>
      n?.dispose(),
    );
    this.synth = null;
    this.volume = null;
    this.chorus = null;
    this.reverb = null;
  }
}
