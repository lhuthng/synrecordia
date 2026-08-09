# libs/pixi

Pure PIXI.js rendering helpers. No React, no Tone.js — just math and draw calls.
Used exclusively by `BaseVisualizerInstrument` subclasses and `usePixiVisualizer`.

---

## Files

### `constants.js`

All magic numbers in one place.

| Group | Constants |
|---|---|
| Canvas layout | `DEFAULT_WIDTH`, `DEFAULT_HEIGHT`, `FADE_MS` |
| Particles | `MAX_PARTICLES`, `PARTICLE_LIFETIME_MIN/MAX`, `PARTICLE_SPAWN_CHANCE` |
| Recorder holes | `NUM_HOLES`, `HOLE_SIZE`, `FINGERING_GAPS`, `HOLE_PLAY_SCALE`, `HOLE_SCALE_ALPHA` |
| Lazy allocation | `NOTE_LAZY_BUFFER_PX`, `NOTE_FADE_SPEED` |
| Misc | `NOTE_GLOW_PADDING`, `ZONE_COLOR`, `PIANO_DELAY_MS` |

Import from here rather than hardcoding numbers in visualizer files.

---

### `colorUtils.js`

Color conversion and manipulation utilities.

- `cssColorToPixiHex(cssColor)` — converts a CSS color string to a PIXI hex number
- `brightenColor(hex, amount)` — lightens a hex color
- `lerpColor(a, b, t)` — linear interpolation between two hex colors
- `darken(hex, amount)` — darkens a hex color
- `getFingeringColors()` — reads CSS custom properties `--color-note-full` and
  `--color-note-half` from the document root; returns `{ full, half }` as PIXI hex values

`getFingeringColors` must be called at render time, not at module load, so that
theme changes are reflected without a page reload.

---

### `fingeringUtils.js`

Small domain helpers consumed by visualizer `computeNoteEvents` implementations.

- `NOTE_TO_MIDI` — lookup map from note name string to MIDI number
- `getHighestNote(notes)` — returns the note with the highest MIDI value from an array
- `getBeatsPerBar(timeSignature)` — extracts the numerator from a `"4/4"`-style string

---

### `geometryUtils.js`

Draw-call helpers that produce reusable PIXI geometry. Uses `GraphicsContext` caches
so identical shapes share GPU batches across frames.

- `getHolePositions(rectHeight)` — returns an array of `{x, y}` positions for the
  recorder hole layout, scaled to `rectHeight`
- `drawFingering(container, fingering, size, xPadding, colors)` — draws a complete
  recorder fingering diagram (open/half/closed circles) into a PIXI `Container`
- `drawGuitarNote(container, color, darkColor, noteWidth, noteHeight, xPadding, shadowOffset)` —
  draws a rounded string-lane pill with a drop shadow into a PIXI `Container`

---

## Rules

- Do not import React or Tone.js from this folder.
- Do not read application state here; accept everything as function arguments.
- Prefer adding a new constant to `constants.js` over inlining a literal anywhere else.