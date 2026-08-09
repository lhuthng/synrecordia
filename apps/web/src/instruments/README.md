# instruments/

Each instrument lives in its own sub-folder and is entirely self-contained.
Nothing leaks between instrument folders — samples, logic, and UI all stay local.

## Taxonomy

|                    | FULL                          | BACKGROUND (audio-only)        |
|--------------------|-------------------------------|--------------------------------|
| VISUALIZABLE       | recorder, guitar              | —                              |
| NOT VISUALIZABLE   | piano, harpsichord, waveform  | recorder-bg, guitar-bg         |

### Visualizable instruments

Only `recorder` and `guitar` are placed on Track 0, the track rendered by the
PIXI visualizer. The `VISUALIZABLE_INSTRUMENTS` constant in
`core/InstrumentRegistry.js` is the single place that controls which instruments
are offered for Track 0.

### Background instruments

`recorder-bg` (internal name `brecorder`) and `guitar-bg` (internal name
`bguitar`) are simplified, audio-only instruments intended for backing and
accompaniment tracks. They are never visualizable and only appear in non-Track-0
slots, where no fingering or string diagram is shown. Each background instrument
points at the same sample folder as its full counterpart via the `SAMPLE_DIR`
map in `InstrumentRegistry.js`.

## Shared base component

`Instrument.jsx` at this root is the icon-plus-toggle button shell that every
instrument component wraps. It owns no audio or canvas logic.

## core/ sub-folder

| File                        | Role                                                           |
|-----------------------------|----------------------------------------------------------------|
| `PackedSampler.js`          | Base class for all samplers                                    |
| `BaseVisualizerInstrument.js` | Abstract plugin class consumed by `usePixiVisualizer`        |
| `InstrumentRegistry.js`     | Single source of truth: all factories, lists, and sample dirs  |

See `core/README.md` for details on each file.

## index.js convention

Every instrument folder exports a standard surface from its `index.js`:

- **Visualizable** (`recorder`, `guitar`): exports `Sampler`, `Visualizer`, `Component`
- **Non-visualizable / background** (all others): exports `Sampler`, `Component`
  (no `Visualizer`)

## Adding a new instrument

1. Create a sub-folder under `instruments/` with the instrument's name.
2. Write `index.js` following the convention above.
3. Register the instrument in `core/InstrumentRegistry.js` — add a factory,
   list it in the appropriate constant (`VISUALIZABLE_INSTRUMENTS`,
   `NON_VISUALIZABLE_INSTRUMENTS`, or `SYNTH_INSTRUMENTS`), and add its entry
   to the `SAMPLE_DIR` map if it uses a sample pack.
4. Drop the sample pack under `public/samples/<name>/` and add an `index.json`
   manifest. See `scripts/SAMPLE_PACK_GUIDE.md` for the expected format.