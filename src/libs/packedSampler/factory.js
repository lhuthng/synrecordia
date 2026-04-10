import PianoSampler from "./piano";
import RecorderSampler from "./recorder";
import BRecorderSampler from "./brecorder";
import GuitarSampler from "./guitar";
import BGuitarSampler from "./bguitar";
import HarpsichordSampler from "./harpsichord";
import WaveformSynth from "./waveform";

export const SYNTH_INSTRUMENTS = ["waveform"];
export const VISUALIZABLE_INSTRUMENTS = ["recorder", "bguitar"];
export const SAMPLE_DIR = { brecorder: "recorder", bguitar: "guitar" };
export const ALL_INSTRUMENTS = [
  "recorder",
  "brecorder",
  "piano",
  "guitar",
  "bguitar",
  "harpsichord",
  "waveform",
];
export const NON_VISUALIZABLE_INSTRUMENTS = ALL_INSTRUMENTS.filter(
  (i) => !VISUALIZABLE_INSTRUMENTS.includes(i),
);

export function isSynthInstrument(name) {
  return SYNTH_INSTRUMENTS.includes(name);
}

export function getSampleDir(name) {
  return SAMPLE_DIR[name] ?? name;
}

export function createSynthInstrument(name, callback, ecoMode = false) {
  switch (name) {
    case "waveform":
      return new WaveformSynth(callback, ecoMode);
    default:
      return null;
  }
}

export function createPackedSampler(name, urls, baseUrl, callback, addition) {
  switch (name) {
    case "recorder":
      return new RecorderSampler(urls, baseUrl, callback, addition);
    case "brecorder":
      return new BRecorderSampler(urls, baseUrl, callback, addition);
    case "piano":
      return new PianoSampler(urls, baseUrl, callback, addition);
    case "guitar":
      return new GuitarSampler(urls, baseUrl, callback, addition);
    case "bguitar":
      return new BGuitarSampler(urls, baseUrl, callback, addition);
    case "harpsichord":
      return new HarpsichordSampler(urls, baseUrl, callback, addition);
    default:
      return new RecorderSampler(urls, baseUrl, callback, addition);
  }
}
