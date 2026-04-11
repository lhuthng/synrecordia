import RecorderSampler from "../recorder/RecorderSampler.js";
import BRecorderSampler from "../recorder-bg/BRecorderSampler.js";
import GuitarSampler from "../guitar/GuitarSampler.js";
import BGuitarSampler from "../guitar-bg/BGuitarSampler.js";
import PianoSampler from "../piano/PianoSampler.js";
import HarpsichordSampler from "../harpsichord/HarpsichordSampler.js";
import WaveformSynth from "../waveform/WaveformSynth.js";
import { RecorderVisualizerInstrument } from "../recorder/RecorderVisualizer.js";
import { GuitarVisualizerInstrument } from "../guitar/GuitarVisualizer.js";

export const SYNTH_INSTRUMENTS = ["waveform"];
export const VISUALIZABLE_INSTRUMENTS = ["recorder", "guitar"];
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

/**
 * Maps instrument names to their VisualizerInstrument class.
 * Only the two fully-visualizable instruments (recorder, guitar) live here.
 * bguitar is also included so that if createVisualizerInstrument is ever called
 * for it, it gets the correct Guitar renderer instead of the fallback Recorder one.
 * brecorder is intentionally absent — the fallback (RecorderVisualizerInstrument)
 * is already correct for it.
 * Non-visualizable instruments (piano, harpsichord, waveform) are not in this map.
 */
const INSTRUMENT_VISUALIZER_MAP = {
  recorder: RecorderVisualizerInstrument,
  guitar: GuitarVisualizerInstrument,
  bguitar: GuitarVisualizerInstrument,
};

export function createVisualizerInstrument(instrumentName) {
  const InstrumentClass =
    INSTRUMENT_VISUALIZER_MAP[instrumentName] ?? RecorderVisualizerInstrument;
  return new InstrumentClass();
}
