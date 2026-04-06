import PianoSampler from "./piano";
import RecorderSampler from "./recorder";
import GuitarSampler from "./guitar";
import WaveformSynth from "./waveform";

export const SYNTH_INSTRUMENTS = ["waveform"];
export const VISUALIZABLE_INSTRUMENTS = ["recorder"];
export const ALL_INSTRUMENTS = ["recorder", "piano", "guitar", "waveform"];

export function isSynthInstrument(name) {
  return SYNTH_INSTRUMENTS.includes(name);
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
    case "piano":
      return new PianoSampler(urls, baseUrl, callback, addition);
    case "guitar":
      return new GuitarSampler(urls, baseUrl, callback, addition);
    default:
      return new RecorderSampler(urls, baseUrl, callback, addition);
  }
}
