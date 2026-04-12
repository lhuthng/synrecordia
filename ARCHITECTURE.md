# SynRecordia — Architecture Guide

A reference for contributors and future-self. Explains the project's layer
model, instrument taxonomy, and the **target folder structure** this codebase
is moving toward.

---

## Table of Contents

1. [Tech stack at a glance](#1-tech-stack-at-a-glance)
2. [Layer model](#2-layer-model)
3. [Instrument taxonomy](#3-instrument-taxonomy)
4. [Current structure (as-is)](#4-current-structure-as-is)
5. [Target structure (to-be)](#5-target-structure-to-be)
6. [Migration map — file by file](#6-migration-map--file-by-file)
7. [Song JSON schema](#7-song-json-schema)
8. [Adding a new instrument](#8-adding-a-new-instrument)
9. [Key design rules](#9-key-design-rules)

---

## 1. Tech stack at a glance

| Concern | Library | Notes |
|---------|---------|-------|
| UI | React 19 | Hooks-first; `React.memo` on heavy components |
| Audio | Tone.js 15 | Sampler scheduling, Freeverb, Vibrato, Volume nodes |
| Canvas | PIXI.js 8 + pixi-filters | Scrolling note timeline, glow, particles |
| Build | Vite | Manual chunk splitting for Tone/PIXI vendor bundles |
| Styling | Tailwind CSS | Utility classes; synthwave colour palette |
| i18n | react-i18next | `en`, `de`, `vi` locales |

The app is **fully client-side** — no backend, no plugins, just a browser.

---

## 2. Layer model

```
┌─────────────────────────────────────────────────────┐
│                     React UI                        │  components/
│  Player · Visualizer · InstrumentManager · modals   │
├─────────────────────────────────────────────────────┤
│                   React Hooks                       │  hooks/
│  usePlayer · usePixiVisualizer · usePlayMode        │
├──────────────────┬──────────────────────────────────┤
│   Tone.js Audio  │      PIXI.js Canvas              │
│   (PackedSampler │   (BaseVisualizerInstrument       │
│    subclasses)   │    subclasses + pixi helpers)     │
├──────────────────┴──────────────────────────────────┤
│              Instrument modules                     │  instruments/
│  Each instrument owns: Sampler · Component · (Vis.) │
└─────────────────────────────────────────────────────┘
```

**The golden rule:** Tone.js owns the clock; PIXI.js owns the pixels.
They are deliberately decoupled — the canvas never reads React state inside
the ticker loop, only refs. See `VISUALIZER.md` for the full explanation.

---

## 3. Instrument taxonomy

Every instrument falls into exactly one column of this table:

```
                    ┌─────────────────────┬───────────────────────────┐
                    │  FULL (configurable) │  BACKGROUND (bg)          │
  ┌─────────────────┼─────────────────────┼───────────────────────────┤
  │  VISUALIZABLE   │  recorder           │  —                        │
  │  (Track 0 only) │  guitar             │                           │
  ├─────────────────┼─────────────────────┼───────────────────────────┤
  │  NOT            │  piano              │  recorder-bg  (brecorder) │
  │  VISUALIZABLE   │  harpsichord        │  guitar-bg    (bguitar)   │
  │  (audio only)   │  waveform (synth)   │                           │
  └─────────────────┴─────────────────────┴───────────────────────────┘
```

### Full instruments
Expose every configurable parameter in their UI panel.
- **recorder** — type selector (soprano / alto / tenor / bass), fingering
  system (baroque / german / simple), volume, vibrato, sample variant.
- **guitar** — fretboard mapper mode (balanced / comfort / sustain), left/right
  hand weight sliders, volume, sample variant.

### Background (bg) instruments
Audio-only instruments for **backing/accompaniment tracks** (Track 1+).
They are **not visualizable** — they never appear on Track 0 and no fingering
diagram or string-lane overlay is drawn for them. The UI panel is deliberately
minimal: just the controls needed to set volume and swap the sample variant.
- **recorder-bg** (`brecorder`) — volume, vibrato, sample variant only.
  Internally locks `name = "recorder"` (shares the same sample folder) and
  returns a fixed note range `{ min: 41, max: 103 }` that spans all recorder
  types. No type or fingering system selector.
- **guitar-bg** (`bguitar`) — volume, sample variant only.
  Extends `GuitarSampler` so it inherits the full audio chain, but the UI
  hides all fretboard mapper controls. The mapper still runs under the hood
  with balanced defaults.

### Not-visualizable instruments
No `Visualizer` export in their `index.js`. These instruments only appear on
background tracks (Track 1+) where the visualizer canvas is not active.
- **piano** — Salamander Grand Piano V2 (CC BY 3.0).
- **harpsichord** — custom sample pack.
- **waveform** — pure Tone.js synth; no sample loading.
- **recorder-bg** — simplified recorder; shares the `recorder` sample folder.
- **guitar-bg** — simplified guitar; shares the `guitar` sample folder.

---

## 4. Current structure (as-is)

The code for each instrument is currently **scattered across four directories**:

```
src/
├── libs/
│   ├── packedSampler/          ← sampler classes for every instrument
│   │   ├── index.js            ← PackedSampler base class
│   │   ├── factory.js          ← createPackedSampler() + instrument lists
│   │   ├── recorder.js
│   │   ├── brecorder.js
│   │   ├── guitar.js
│   │   ├── bguitar.js
│   │   ├── piano.js
│   │   ├── harpsichord.js
│   │   └── waveform.js
│   ├── fingering/              ← recorder fingering resolvers only
│   │   ├── BaseFingeringResolver.js
│   │   ├── BaroqueRecorderFingering.js
│   │   ├── GermanRecorderFingering.js
│   │   ├── SimpleRecorderFingering.js
│   │   └── FingeringResolverFactory.js
│   ├── guitar/                 ← guitar fretboard logic only
│   │   ├── GuitarMapper.js
│   │   ├── theory.js
│   │   └── tunings.js
│   └── visualizer/             ← visualizer plugin classes
│       ├── BaseVisualizerInstrument.js
│       ├── VisualizerInstrumentFactory.js
│       ├── RecorderVisualizerInstrument.js
│       └── GuitarVisualizerInstrument.js
│
└── components/
    ├── instruments/            ← React UI panels for every instrument
    │   ├── Instrument.jsx      ← shared base shell (icon + toggle)
    │   ├── InstrumentManager.jsx
    │   ├── Recorder.jsx
    │   ├── BRecorder.jsx
    │   ├── Guitar.jsx
    │   ├── BGuitar.jsx
    │   ├── Piano.jsx
    │   ├── Harpsichord.jsx
    │   ├── Waveform.jsx
    │   └── RecorderIllustration.jsx
    └── utils/                  ← PIXI rendering helpers (misnamed as "utils")
        ├── constants.js
        ├── colorUtils.js
        ├── fingeringUtils.js
        └── geometryUtils.js
```

**Pain points:**
- To understand a single instrument you must visit 4 separate directories.
- `VISUALIZABLE_INSTRUMENTS` and `ALL_INSTRUMENTS` are defined inside
  `packedSampler/factory.js` — mixing data with a factory function.
- `components/utils/` contains PIXI canvas helpers, not React component
  utilities — the name is misleading.
- `libs/guitar/` and `libs/fingering/` are instrument-specific but live at
  the same depth as general-purpose libs (`ecoMode.js`, `utils.js`).

---

## 5. Target structure (to-be)

Principle: **each instrument is a self-contained folder**. All code that
belongs to an instrument — sampler, visualizer plugin, domain logic, React
component — lives together. Shared infrastructure lives in `instruments/core/`.

```
src/
│
├── instruments/
│   │
│   ├── core/                            ← shared infrastructure (not instrument-specific)
│   │   ├── PackedSampler.js             ← base sampler class
│   │   ├── BaseVisualizerInstrument.js  ← base visualizer plugin class
│   │   └── InstrumentRegistry.js        ← single source of truth:
│   │                                       • ALL_INSTRUMENTS list
│   │                                       • VISUALIZABLE_INSTRUMENTS (auto-derived)
│   │                                       • createPackedSampler()
│   │                                       • createVisualizerInstrument()
│   │                                       (merges factory.js + VisualizerInstrumentFactory.js)
│   │
│   ├── Instrument.jsx                   ← shared base UI shell (icon + toggle strip)
│   │                                      used by every instrument component
│   │
│   ├── recorder/                        ← ✅ VISUALIZABLE · FULL · Track 0
│   │   ├── index.js                     ← exports { Sampler, Component, Visualizer }
│   │   ├── RecorderSampler.js
│   │   ├── RecorderVisualizer.js
│   │   ├── RecorderComponent.jsx
│   │   ├── RecorderIllustration.jsx
│   │   └── fingering/
│   │       ├── BaseFingeringResolver.js
│   │       ├── BaroqueRecorderFingering.js
│   │       ├── GermanRecorderFingering.js
│   │       ├── SimpleRecorderFingering.js
│   │       └── FingeringResolverFactory.js
│   │
│   ├── recorder-bg/                     ← ❌ NOT VISUALIZABLE · BACKGROUND
│   │   ├── index.js                     ← { Sampler, Component }  ← no Visualizer export
│   │   ├── BRecorderSampler.js          ← same audio chain; fixed note range; name="recorder"
│   │   └── BRecorderComponent.jsx       ← volume · vibrato · variant only (no type/system)
│   │
│   ├── guitar/                          ← ✅ VISUALIZABLE · FULL · Track 0
│   │   ├── index.js                     ← exports { Sampler, Component, Visualizer }
│   │   ├── GuitarSampler.js
│   │   ├── GuitarVisualizer.js
│   │   ├── GuitarComponent.jsx          ← volume · variant · mapper mode · hand weights
│   │   └── mapper/                      ← fretboard domain logic
│   │       ├── GuitarMapper.js
│   │       ├── theory.js
│   │       └── tunings.js
│   │
│   ├── guitar-bg/                       ← ❌ NOT VISUALIZABLE · BACKGROUND
│   │   ├── index.js                     ← { Sampler, Component }  ← no Visualizer export
│   │   ├── BGuitarSampler.js            ← extends GuitarSampler; mapper runs w/ balanced defaults
│   │   └── BGuitarComponent.jsx         ← volume · variant only (no mapper controls)
│   │
│   ├── piano/                           ← ❌ NOT VISUALIZABLE
│   │   ├── index.js                     ← exports { Sampler, Component }  ← no Visualizer export
│   │   ├── PianoSampler.js
│   │   └── PianoComponent.jsx
│   │
│   ├── harpsichord/                     ← ❌ NOT VISUALIZABLE
│   │   ├── index.js
│   │   ├── HarpsichordSampler.js
│   │   └── HarpsichordComponent.jsx
│   │
│   └── waveform/                        ← ❌ SYNTH · NOT VISUALIZABLE
│       ├── index.js
│       ├── WaveformSynth.js             ← pure Tone.js synth, no sample loading
│       └── WaveformComponent.jsx
│
├── components/
│   ├── ui/                              ← design-system primitives (stateless atoms)
│   │   ├── DuoButton.jsx
│   │   ├── DuoSelect.jsx
│   │   ├── DuoSlideBar.jsx
│   │   ├── DuoToggleButton.jsx
│   │   └── SettingTooltip.jsx
│   │
│   ├── layout/                          ← page-level shells and decoration
│   │   ├── AmbientLight.jsx
│   │   ├── Header.jsx
│   │   └── SynthwaveBackground.jsx
│   │
│   ├── modals/                          ← overlay dialogs
│   │   ├── AdvancedSettingsModal.jsx
│   │   └── SelectDeviceModal.jsx
│   │
│   ├── player/                          ← everything rendered inside the playback bar
│   │   ├── Player.jsx
│   │   ├── CompactPlayer.jsx
│   │   ├── SongTimeline.jsx
│   │   └── InstrumentManager.jsx
│   │
│   ├── Details.jsx
│   ├── Directory.jsx
│   ├── EcoModeToast.jsx
│   └── Visualizer.jsx
│
├── hooks/
│   ├── usePixiVisualizer.js
│   ├── usePlayMode.js
│   └── usePlayer.js
│
├── context/
│   ├── EcoModeContext.jsx
│   ├── MobileMenuContext.jsx
│   └── useMobileMenu.js
│
└── libs/
    ├── ecoMode.js                       ← device capability detection
    ├── utils.js                         ← general-purpose helpers (noteNameToMidi, etc.)
    └── pixi/                            ← PIXI rendering helpers used by visualizer plugins
        ├── constants.js                 ← canvas layout + particle + hole constants
        ├── colorUtils.js                ← colour math (brighten, darken, lerp, cssToHex)
        ├── fingeringUtils.js            ← getHighestNote, note-name helpers
        └── geometryUtils.js             ← drawFingering, drawGuitarNote, getHolePositions
```

---

## 6. Migration map — file by file

| Current path | Target path |
|---|---|
| `libs/packedSampler/index.js` | `instruments/core/PackedSampler.js` |
| `libs/packedSampler/factory.js` | `instruments/core/InstrumentRegistry.js` (merged) |
| `libs/visualizer/BaseVisualizerInstrument.js` | `instruments/core/BaseVisualizerInstrument.js` |
| `libs/visualizer/VisualizerInstrumentFactory.js` | `instruments/core/InstrumentRegistry.js` (merged) |
| `libs/packedSampler/recorder.js` | `instruments/recorder/RecorderSampler.js` |
| `libs/visualizer/RecorderVisualizerInstrument.js` | `instruments/recorder/RecorderVisualizer.js` |
| `components/instruments/Recorder.jsx` | `instruments/recorder/RecorderComponent.jsx` |
| `components/instruments/RecorderIllustration.jsx` | `instruments/recorder/RecorderIllustration.jsx` |
| `libs/fingering/*.js` | `instruments/recorder/fingering/*.js` |
| `libs/packedSampler/brecorder.js` | `instruments/recorder-bg/BRecorderSampler.js` |
| `components/instruments/BRecorder.jsx` | `instruments/recorder-bg/BRecorderComponent.jsx` |
| *(was labelled bass-guitar in old plan)* | `instruments/guitar-bg/` |
| `libs/packedSampler/guitar.js` | `instruments/guitar/GuitarSampler.js` |
| `libs/visualizer/GuitarVisualizerInstrument.js` | `instruments/guitar/GuitarVisualizer.js` |
| `components/instruments/Guitar.jsx` | `instruments/guitar/GuitarComponent.jsx` |
| `libs/guitar/GuitarMapper.js` | `instruments/guitar/mapper/GuitarMapper.js` |
| `libs/guitar/theory.js` | `instruments/guitar/mapper/theory.js` |
| `libs/guitar/tunings.js` | `instruments/guitar/mapper/tunings.js` |
| `libs/packedSampler/bguitar.js` | `instruments/guitar-bg/BGuitarSampler.js` |
| `components/instruments/BGuitar.jsx` | `instruments/guitar-bg/BGuitarComponent.jsx` |
| `libs/packedSampler/piano.js` | `instruments/piano/PianoSampler.js` |
| `components/instruments/Piano.jsx` | `instruments/piano/PianoComponent.jsx` |
| `libs/packedSampler/harpsichord.js` | `instruments/harpsichord/HarpsichordSampler.js` |
| `components/instruments/Harpsichord.jsx` | `instruments/harpsichord/HarpsichordComponent.jsx` |
| `libs/packedSampler/waveform.js` | `instruments/waveform/WaveformSynth.js` |
| `components/instruments/Waveform.jsx` | `instruments/waveform/WaveformComponent.jsx` |
| `components/instruments/Instrument.jsx` | `instruments/Instrument.jsx` |
| `components/instruments/InstrumentManager.jsx` | `components/player/InstrumentManager.jsx` |
| `components/utils/constants.js` | `libs/pixi/constants.js` |
| `components/utils/colorUtils.js` | `libs/pixi/colorUtils.js` |
| `components/utils/fingeringUtils.js` | `libs/pixi/fingeringUtils.js` |
| `components/utils/geometryUtils.js` | `libs/pixi/geometryUtils.js` |

---

## 7. Song JSON schema

Every song is a single `.json` file served from `public/songs/`. The Player
loads it on demand; the Visualizer and audio engine consume it directly.

### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique slug — matches the filename stem |
| `title` | `string` | Display title |
| `composer` | `string?` | Optional composer credit |
| `bpm` | `number` | Base BPM — what the UI slider controls |
| `bpms` | `BpmEntry[]?` | Tempo-change map (absent = constant tempo) |
| `timeSignature` | `string?` | Single time signature e.g. `"4/4"` (overridden by `timeSignatures`) |
| `timeSignatures` | `TsEntry[]?` | Per-segment time signatures for meter-change songs |
| `tracks` | `Track[]` | One entry per instrument track; `tracks[0]` is the visualized track |

### `bpms` array

```json
"bpms": [
  { "beat": 0,   "bpm": 180 },
  { "beat": 432, "bpm": 240 },
  { "beat": 564, "bpm": 180 },
  { "beat": 684, "bpm": 130 }
]
```

Each entry records the BPM that takes effect at a given **MIDI beat** (quarter
notes since the start). `bpms[0].beat` must be `0` and its `bpm` must equal the
top-level `bpm`. The array is optional; when absent or single-entry, playback and
the visualizer both treat the song as having constant tempo.

The `convert-midi.mjs` script writes this array automatically when the source
MIDI file contains `0x51` tempo meta-events.

### `timeSignatures` array

```json
"timeSignatures": [
  { "timeSignature": "3/4", "length": 48 },
  { "timeSignature": "4/4", "length": 200 }
]
```

`length` is the number of beats that this time signature spans. The visualizer
uses these to space bar lines correctly. Absent → falls back to `timeSignature`
or `"4/4"`.

### Track object

```json
{
  "instrument": "recorder",
  "hint": "alto",
  "noteRange": { "min": 60, "max": 84 },
  "actions": [ … ]
}
```

`hint` is an optional string; if it matches a recorder type (`soprano`, `alto`,
`tenor`, `bass`), the player auto-selects that type when the song loads and shows
a toast notification.

### Action object

```json
{ "type": "note", "time": 12.0, "duration": 0.5, "pitch": "A4", "velocity": 80 }
// or polyphonic:
{ "type": "note", "time": 12.0, "duration": 0.5, "pitches": ["E3","G3","B3"], "velocity": 70 }
```

`time` and `duration` are in **raw MIDI beats** (ticks ÷ PPQ). The player
converts them to wall-clock seconds at playback time using the `bpms` array.
The visualizer converts them to **visual beats** (see `VISUALIZER.md`) for
pixel-accurate placement.

---

## 8. Adding a new instrument

### Step A — Create the instrument folder

```
src/instruments/my-instrument/
    index.js
    MyInstrumentSampler.js
    MyInstrumentComponent.jsx
    MyInstrumentVisualizer.js   ← only if visualizable
```

### Step B — Write `index.js`

```js
// Visualizable instrument (Track 0 — shown in the PIXI visualizer)
export { MyInstrumentSampler   as Sampler   } from './MyInstrumentSampler.js';
export { MyInstrumentComponent as Component } from './MyInstrumentComponent.jsx';
export { MyInstrumentVisualizer as Visualizer } from './MyInstrumentVisualizer.js';

// Non-visualizable / background instrument — omit the Visualizer export
// export { MyInstrumentSampler   as Sampler   } from './MyInstrumentSampler.js';
// export { MyInstrumentComponent as Component } from './MyInstrumentComponent.jsx';
```

Note: `VISUALIZABLE_INSTRUMENTS` in `InstrumentRegistry.js` is still the
authoritative runtime list for which instruments are offered on Track 0.
The presence or absence of a `Visualizer` export in `index.js` is a
complementary structural signal used for documentation and future tooling.

### Step C — Register in `InstrumentRegistry.js`

```js
import * as MyInstrument from '../my-instrument/index.js';

const INSTRUMENTS = {
  // ... existing entries ...
  'my-instrument': MyInstrument,
};
```

That's it. The registry's `createPackedSampler()` and
`createVisualizerInstrument()` functions derive everything from the module map.

### Step D — Add sample pack (if sampled)

```
public/samples/my-instrument/
    index.json                  ← { "versions": ["v1"], "default": "v1" }
    v1/
        index.json              ← maps note names → filenames
        A0v1.mp3
        ...
```

See `scripts/SAMPLE_PACK_GUIDE.md` for the full FL Studio → slice → package
pipeline.

### Background variant

If the instrument has a background variant that hides certain parameters:

```
src/instruments/my-instrument-bg/
    index.js                         ← { Sampler, Component } only — no Visualizer
    BMyInstrumentSampler.js
    BMyInstrumentComponent.jsx       ← minimal UI: volume + variant only
```

Background variants are **not visualizable**. They are audio-only instruments
that live on Track 1+ where no PIXI canvas is shown. Do not export `Visualizer`
from their `index.js` and do not add them to `VISUALIZABLE_INSTRUMENTS`.

### Polyphony contract

By default every instrument is **polyphonic**: `PackedSampler.isMonophonic()`
returns `false`, so chord actions pass all pitches to `triggerAttackRelease`
unchanged.

Override `isMonophonic()` in a sampler class to change this behaviour:

| Scenario | What to do |
|---|---|
| Always monophonic (e.g. flute, recorder) | Return `true` unconditionally |
| User-togglable (e.g. guitar) | Store a flag in `_mapperOptions` and return it |
| Default polyphonic | Do nothing — `PackedSampler` base already returns `false` |

```js
// 1. Always monophonic — override in the sampler class
class RecorderSampler extends PackedSampler {
  isMonophonic() { return true; }
}

// 2. User-togglable — flag stored in _mapperOptions
class GuitarSampler extends PackedSampler {
  isMonophonic() { return this._mapperOptions.monophonic === true; }
}

// 3. Always polyphonic — no override needed (PackedSampler default)
class PianoSampler extends PackedSampler {
  // isMonophonic() inherited → returns false
}
```

`usePlayer.startPlayback` calls `synth.isMonophonic()` **once per track** when
building pre-computed track states at play-start. If `true`, only the highest
pitch of any polyphonic chord action is forwarded to `triggerAttackRelease`.
`Player.jsx` is never consulted and never needs updating when polyphony changes.

---

## 9. Key design rules

### Instruments are self-contained
No instrument folder may import from another instrument folder. The one
permitted exception is a background variant importing its parent's **sampler**
(e.g. `BGuitarSampler extends GuitarSampler`), since they share an audio chain:

```js
// ✅ allowed — bg variant extending parent sampler
import GuitarSampler from '../guitar/GuitarSampler.js';

// ❌ not allowed — cross-instrument domain logic
import { GuitarMapper } from '../guitar/mapper/GuitarMapper.js'; // in recorder/
```

### Background instruments share samples with their full counterpart
`brecorder` sets `name = "recorder"` so it reads from
`public/samples/recorder/`. `bguitar` inherits from `GuitarSampler` which
already points at `public/samples/guitar/`. Neither bg variant has its own
sample folder. The `SAMPLE_DIR` map in `InstrumentRegistry.js` encodes this
relationship for the loader.

### `instruments/core/` is the only shared import target
Files outside `instruments/` that need instrument infrastructure (hooks,
`InstrumentManager`) import exclusively from `instruments/core/` and from
individual `index.js` barrel files — never from deep internal paths.

### `VISUALIZABLE_INSTRUMENTS` is the runtime authority
The `VISUALIZABLE_INSTRUMENTS` array in `InstrumentRegistry.js` is the
authoritative list of instruments that are offered on Track 0 (the visualized
track). Currently `["recorder", "guitar"]`. Background instruments
(`brecorder`, `bguitar`) are explicitly excluded and therefore only appear
on Track 1+ slots. Update this array when adding a new visualizable instrument.

### `libs/pixi/` is not a component utility folder
`colorUtils`, `geometryUtils`, `fingeringUtils`, and `constants` are PIXI
canvas rendering helpers used exclusively by `BaseVisualizerInstrument`
subclasses and `usePixiVisualizer`. They live in `libs/pixi/`, not in
`components/utils/`, because they have nothing to do with React.

### The `player/` sub-folder owns playback UI
`Player`, `CompactPlayer`, `SongTimeline`, and `InstrumentManager` all belong
in `components/player/`. They are tightly coupled to each other and to
`usePlayer` / `usePlayMode` hooks, but are separate from the visualizer.

### Instruments declare their own polyphony
`usePlayer` never checks `track.instrument` or `effectiveInstrument` to decide
whether to collapse chords. The sampler's `isMonophonic()` method is the **sole
authority**:

- Adding a new monophonic instrument requires only overriding `isMonophonic()`
  in its sampler class — no changes to `usePlayer`, `Player.jsx`, or any registry.
- This keeps the player completely instrument-agnostic and prevents an
  ever-growing list of name-based special cases inside the scheduler.