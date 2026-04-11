# guitar

Full-featured acoustic guitar instrument. Track-0 instrument — shown in the PIXI string/fret visualizer.

## Files

| File | Role |
|------|------|
| `GuitarSampler.js` | Tone.js `Sampler` with Freeverb; stores mapper options used during playback |
| `GuitarVisualizer.js` | Draws string-lane pills with glow in the PIXI canvas |
| `GuitarComponent.jsx` | UI panel: volume, variant, mapper mode, left/right hand-weight sliders |
| `index.js` | Public surface: exports `Sampler`, `Visualizer`, `Component` |

## mapper/

Fretboard domain logic, independent of rendering and audio.

| File | Role |
|------|------|
| `GuitarMapper.js` | DP-based Viterbi solver; finds the globally-optimal string/fret assignment sequence for a track's notes |
| `theory.js` | Flat-aware note/MIDI conversion: `noteToMidi`, `midiToNote` |
| `tunings.js` | `TUNINGS` map and `getOpenMidis(tuningName)` |

The mapper runs once per track before playback begins. Its output is consumed by `GuitarVisualizer.js` to position pills on the correct string lane.

## Sample folder

```
public/samples/guitar/<version>/index.json
```

See `scripts/SAMPLE_PACK_GUIDE.md` and the root `README.md` for the sample pipeline.

## index.js contract

Because guitar is a **visualizable** instrument (Track-0 eligible), `index.js` must export all three:

```
export { GuitarSampler as Sampler };
export { GuitarVisualizer as Visualizer };
export { GuitarComponent as Component };
```

## Relationship to core/

- `GuitarSampler` extends `PackedSampler` (see `instruments/core/PackedSampler.js`).
- `GuitarVisualizer` extends `BaseVisualizerInstrument` (see `instruments/core/BaseVisualizerInstrument.js`).
- Both are registered in `instruments/core/InstrumentRegistry.js`.