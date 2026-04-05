import { RecorderVisualizerInstrument } from "./RecorderVisualizerInstrument.js";

/**
 * VisualizerInstrumentFactory
 *
 * Maps a track's instrument name to the concrete BaseVisualizerInstrument
 * subclass that knows how to visualize it.
 *
 * Adding support for a new instrument:
 *   1. Create  src/libs/visualizer/MyInstrumentVisualizer.js
 *   2. Add an entry in the INSTRUMENT_MAP below.
 *
 * Unknown instrument names fall back to RecorderVisualizerInstrument so the
 * visualizer always has a working renderer rather than crashing silently.
 */

const INSTRUMENT_MAP = {
  recorder: RecorderVisualizerInstrument,
  // piano: PianoVisualizerInstrument,   ← add future instruments here
};

/**
 * Return a fresh instrument visualizer instance for the given instrument name.
 *
 * @param {string} instrumentName - The value of track.instrument from the song data.
 * @returns {import('./BaseVisualizerInstrument.js').BaseVisualizerInstrument}
 */
export function createVisualizerInstrument(instrumentName) {
  const InstrumentClass =
    INSTRUMENT_MAP[instrumentName] ?? RecorderVisualizerInstrument;
  return new InstrumentClass();
}
