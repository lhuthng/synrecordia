# recorder

Full-featured soprano/alto/tenor/bass recorder. Track-0 instrument — shown in
the PIXI fingering visualizer.

## Files

| File | Role |
|------|------|
| `RecorderSampler.js` | Tone.js `Sampler` wrapped with `Freeverb` and `Vibrato` effects. Extends `PackedSampler`. |
| `RecorderVisualizer.js` | `BaseVisualizerInstrument` subclass. Draws hole diagrams on the static layer; emits particles on note hits. |
| `RecorderComponent.jsx` | Instrument panel UI: volume, vibrato intensity, instrument variant (soprano/alto/tenor/bass), and fingering-system selector. |
| `RecorderIllustration.jsx` | Decorative SVG of a recorder body used inside the Visualizer panel. Purely presentational. |
| `index.js` | Public entry point. Exports `Sampler`, `Visualizer`, and `Component`. |

## fingering/ sub-folder

All fingering logic lives here. Each system extends `BaseFingeringResolver`, which
defines the shared interface (`getFingering(note)`).

| File | Role |
|------|------|
| `BaseFingeringResolver.js` | Abstract base — defines the resolver contract. |
| `BaroqueRecorderFingering.js` | Baroque (cross) fingering system. |
| `GermanRecorderFingering.js` | German fingering system. |
| `SimpleRecorderFingering.js` | Simplified fingering for beginners. |
| `FingeringResolverFactory.js` | Single entry point. Call `createFingeringResolver(system, recorderType)` — do not instantiate resolvers directly. |

The factory accepts a system string (`"baroque"`, `"german"`, `"simple"`) and a
recorder type (`"soprano"`, `"alto"`, `"tenor"`, `"bass"`).

## Sample folder

Samples live at `public/samples/recorder/<version>/index.json`.

See `scripts/SAMPLE_PACK_GUIDE.md` and the project root `README.md` for the full
Philharmonia pipeline (download → normalise → pack → generate index).

## Adding a new fingering system

1. Create `<Name>RecorderFingering.js` extending `BaseFingeringResolver`.
2. Implement `getFingering(note)` for every note in the recorder's range.
3. Register the new key in `FingeringResolverFactory.js`.
4. Add the option to `RecorderComponent.jsx`'s fingering-system selector.