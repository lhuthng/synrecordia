# instruments/core

Shared base classes and the central registry for every instrument in SynRecordia.
Nothing in this folder is instrument-specific; it defines the contracts that all
instruments implement.

---

## PackedSampler.js

Base class for every sampler.

- Stores `name`, `version`, and `alternatives` (fallback sample versions).
- `fetchSampler(note, options)` — loads the Tone.js Sampler from the packed
  sample index for the instrument's current version.
- `getNoteRange()` — returns `{ lowest, highest }` derived from the loaded index.
- Subclasses **must** implement:
  - `dispose()` — tear down the Tone.js graph.
  - `getPresentation()` — return the React component that `InstrumentManager`
    will render as the instrument's control panel.

---

## BaseVisualizerInstrument.js

Abstract plugin class consumed by the `usePixiVisualizer` hook.

The hook calls four methods on the active visualizer instance:

| Method | When called | What it does |
|---|---|---|
| `computeNoteEvents(track)` | on track load | converts raw note data into timed render events |
| `buildStaticLayer(app)` | on mount | draws background geometry (strings, staff lines, etc.) |
| `createSprite(event, app)` | per note | allocates and positions a PIXI display object |
| `onTickSprite(sprite, event, now)` | every frame | animates the sprite (move, fade, scale, etc.) |

Concrete subclasses live at `instruments/<name>/<Name>Visualizer.js` and extend
this class.

---

## InstrumentRegistry.js

**The single file to edit when adding or removing an instrument.**

### Exports

| Export | Type | Description |
|---|---|---|
| `createPackedSampler(name, opts)` | factory | instantiates a sampler by instrument name |
| `createSynthInstrument(name, opts)` | factory | instantiates a synth-based instrument |
| `createVisualizerInstrument(name)` | factory | instantiates the matching visualizer plugin |
| `VISUALIZABLE_INSTRUMENTS` | `string[]` | instruments eligible for Track 0 (PIXI visualizer) |
| `NON_VISUALIZABLE_INSTRUMENTS` | `string[]` | instruments that cannot go on Track 0 |
| `ALL_INSTRUMENTS` | `string[]` | union of the two lists above |
| `SYNTH_INSTRUMENTS` | `string[]` | instruments that use synth rather than samples |
| `getSampleDir(name)` | function | resolves the `public/samples/` path for a given instrument |
| `isSynthInstrument(name)` | function | returns `true` for synth-based instruments |

All instrument lists and `SAMPLE_DIR` mappings are defined here, so there is
exactly one place to update when the instrument set changes.