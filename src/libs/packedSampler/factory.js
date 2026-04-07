import PianoSampler from "./piano";
import RecorderSampler from "./recorder";
import BRecorderSampler from "./brecorder";
import GuitarSampler from "./guitar";
import HarpsichordSampler from "./harpsichord";
import WaveformSynth from "./waveform";

export const SYNTH_INSTRUMENTS = ["waveform"];
export const VISUALIZABLE_INSTRUMENTS = ["recorder"];
export const SAMPLE_DIR = { brecorder: "recorder" };
export const ALL_INSTRUMENTS = [
  "recorder",
  "brecorder",
  "piano",
  "guitar",
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

export function createSynthInstrument(name, callback) {
  switch (name) {
    case "waveform":
      return new WaveformSynth(callback);
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
    case "harpsichord":
      return new HarpsichordSampler(urls, baseUrl, callback, addition);
    default:
      return new RecorderSampler(urls, baseUrl, callback, addition);
  }
}
