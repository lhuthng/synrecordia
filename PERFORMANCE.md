# Performance Checklist

Tracks all performance improvements identified in the mobile performance audit.
Items are ordered by impact (highest first).

## 🔴 Critical — Tone.js Audio Chain

- [x] **Eco mode: skip Reverb/Vibrato/Chorus construction on low-end devices** — `Tone.Reverb` uses an OfflineAudioContext IR generation that can freeze the audio thread 100–500 ms per instance on mobile. In eco mode samplers connect directly `sampler → volume → destination`.
- [x] **Dead `Tone.Filter` node removed** (`recorder.js`, `brecorder.js`) — A `Tone.Filter` was allocated and wired into the graph but no signal ever flowed through it (the sampler bypassed it). Removed entirely.
- [x] **Eco mode: runtime wet bypass** — `setEcoMode(enabled)` on every sampler ramps reverb/vibrato/chorus wet to 0 smoothly when eco mode is toggled at runtime.

## 🔴 Critical — PixiJS Renderer

- [x] **`antialias` disabled in eco mode** — MSAA requires 2–4× fill rate on mobile GPUs; negligible visual benefit for 2-D line content.
- [x] **`GlowFilter` skipped on play bar in eco mode** — Fragment-shader Gaussian blur; replaced with a plain line in eco mode.
- [x] **`ColorMatrixFilter` (brightness pulse) skipped per note in eco mode** — Extra shader pass per note per frame; disabled by passing `ecoMode` into `createSprite`.

## 🟠 High — React Render Frequency

- [x] **`setCurrentBeat` throttled to ~30 fps** (`usePlayer.js`) — Previously called 60×/second, causing full React reconciliation on every animation frame. The PixiJS ticker projects forward with elapsed-time interpolation, so visual smoothness is unaffected.

## 🟠 High — Particle System

- [x] **Particles disabled in eco mode** — `particlesEnabled` forced to `false` when eco mode is active; existing `particlesEnabled` path already handles cleanup.
- [x] **Particle counts reduced** (`MAX_PARTICLES` 400→150, `PARTICLE_SPAWN_CHANCE` 0.2→0.12) — Reduces per-frame GC allocation pressure even in normal mode.

## 🟠 High — Scene Rebuild Cost

- [x] **`buildGuides()` debounced during continuous zoom** — Previously called every pointer-move during timeline handle drag, creating/destroying hundreds of PIXI objects per frame. Now debounced with a 60 ms trailing edge.
- [x] **`buildPlayBar()` `getComputedStyle` call guarded** — Was forcing a synchronous style recalculation on every rebuild. Now cached after the first call.

## 🟡 Medium — React Render Waste

- [x] **`computeNoteRangeFromActions` memoized in `CompactPlayer`** — Was called inline in JSX, re-running on every 30 fps tick. Wrapped in `useMemo` per track.

## 🟡 Medium — Eco Mode Infrastructure

- [x] **`detectEcoMode()` utility** (`src/libs/ecoMode.js`) — Detects mobile low-end devices via `navigator.maxTouchPoints`, `navigator.hardwareConcurrency`, `navigator.deviceMemory`, and viewport width.
- [x] **`EcoModeContext`** (`src/context/EcoModeContext.jsx`) — Provides `ecoMode: boolean`, `autoDetected: boolean`, and `setManualEcoMode(v)` throughout the app. Auto-detects on mount; manual override persists in `sessionStorage`.
- [x] **Eco mode toggle in Advanced Settings modal** — Shows auto-detected badge; user can override.

## 🟡 Medium — Build / Loading

- [x] **Vite manual chunk splitting** — Tone.js, PixiJS, and pixi-filters are split into separate vendor chunks so the browser can cache them independently and load them in parallel.

## 🟢 Quick Wins — Visual

- [x] **`SynthwaveBackground` star count reduced in eco mode** (35→12) — Fewer CSS-animated SVG elements; also stops `feGaussianBlur` SVG filter from firing on every paint.

---

## Batch 2 — Audio & Rendering GC

### 🔴 Critical — Reverb Construction Cost (applies even without eco mode)

- [x] **`Tone.Reverb` → `Tone.Freeverb` in all samplers** (`piano.js`, `guitar.js`, `harpsichord.js`, `recorder.js`, `brecorder.js`, `waveform.js`) — `Tone.Reverb` renders an impulse response in an `OfflineAudioContext` which stalls the audio thread 100–500 ms per instance at construction time. `Tone.Freeverb` is a pure IIR Schroeder reverb (comb + all-pass filters) with zero construction cost. The `wet` signal API is identical so `setEcoMode()` ramp logic is unchanged. Room-size values mapped from old decay values (decay 5 → roomSize 0.85, decay 4 → 0.80, decay 2.5 → 0.70, decay 1.5 → 0.50).

### 🟠 High — Particle GC Pressure

- [x] **Particle object pool pre-allocated at init** (`usePixiVisualizer.js`, `RecorderVisualizerInstrument.js`) — Previously every particle spawn did `new PIXI.Sprite(texture)` + `particleLayer.addChild()` and every particle death did `spr.destroy()` + `removeChild()`. With `MAX_PARTICLES = 150` particles and up to 60 fps, this was up to ~9 000 alloc/dealloc cycles per second during active playback. The pool pre-allocates all 150 sprites at canvas init time (`visible: false`), permanently parented to `particleLayer`. `acquire()` flips `visible = true` and returns a sprite; `release()` flips `visible = false` and returns it to the free stack. No per-frame JS object allocation or GPU texture upload.

---

## Batch 3 — Loading UX & GPU Fill-Rate

### 🔴 Critical — Canvas Render Resolution

- [x] **Canvas resolution capped at 2× (1× in eco mode)** (`usePixiVisualizer.js`) — PixiJS defaults to `window.devicePixelRatio`, which is 3× on modern iPhones and high-end Androids. A 3× DPR device previously rendered 9× as many pixels as a 1× device; capping at 2× (normal) cuts pixel count to 4× — a **44% GPU fill-rate reduction** on 3× devices. Eco mode drops to 1× for an **89% reduction**. Implemented via `resolution: ecoModeRef.current ? 1 : Math.min(window.devicePixelRatio || 1, 2)` in `app.init()`.

### 🔴 Critical — Play Button Latency

- [x] **Progressive sample loading — play allowed once track 0 is ready** (`usePlayer.js`) — `isReady` previously required all tracks to finish decoding (`isAudioReady.every(Boolean)`). Changed to `isAudioReady[0] === true`. The main instrument (track 0) unlocks the play button immediately; secondary tracks load in the background. Notes from still-loading samplers are silently skipped in the RAF tick (`state.synth.loaded !== false` guard) so there are no errors or crashes.
- [x] **`await Tone.loaded()` removed from `startPlayback`** (`usePlayer.js`) — This call blocked the play action until every `ToneAudioBuffer` across all tracks finished decoding — sometimes several seconds on mobile. Removed entirely; track-0 readiness is already guaranteed by the `isReady` guard above.
- [x] **AudioContext pre-warm on first user gesture** (`usePlayer.js`) — `Tone.start()` is now called on the first `touchstart`, `mousedown`, or `keydown` event (whichever comes first), via a self-removing one-shot listener mounted in a `useEffect`. Previously the AudioContext was only unlocked when the play button was pressed, adding a ~200 ms unlock delay. Pre-warming eliminates this delay: by the time the user reaches the play button the context is already running.

### 🟠 High — PixiJS Hit-Test Cost

- [x] **`eventMode = 'none'` on non-interactive Pixi layers** (`usePixiVisualizer.js`) — Set on `guideLayer` (hundreds of bar/beat `Graphics` objects), `holesLayer` (static instrument decorations), `particleLayer` (150 sprites), and `zonesLayer` (gray overlay rectangles). PixiJS traverses the full scene graph on every pointer event to find hit targets; marking these subtrees as `'none'` eliminates their traversal entirely. `notesLayer` and `playBarLayer` are left at their defaults since they host interactive children.

### 🟢 Bug Fix — Guide Bar Misalignment During Zoom

- [x] **Guide bars immediately rescale on `noteWidth` change** (`usePixiVisualizer.js`) — `buildGuides()` is debounced 60 ms to prevent GC thrashing during zoom gestures, but `scrollLayer.x` and note sprites updated immediately. This left guide bar/beat lines at old pixel positions for 60 ms — visibly misaligned. Fix: capture `prevPpb` before updating `pixelsPerBeatRef`, compute `ratio = newPpb / prevPpb`, and multiply every guide child's `.x` by that ratio synchronously in the same effect. The debounced full rebuild still fires for text label correctness.

---

## Batch 4 — React Render Cost & Build Quality

### 🟠 High — React Re-render Reduction

- [x] **`React.memo` on `Visualizer`** (`src/components/Visualizer.jsx`) — `Visualizer` was a plain function component re-entering on every parent re-render, including non-beat-driven ones (modal opens, song selection, settings changes). Wrapped with `memo()` so React skips reconciliation when none of its props changed.
- [x] **`React.memo` on `SongTimeline`** (`src/components/SongTimeline.jsx`) — Same pattern. `SongTimeline` is a moderately complex component with `ResizeObserver`, drag state, and animation RAF; memoising prevents unnecessary re-entry during parent renders unrelated to timeline state.
- [x] **`React.memo` on `InstrumentManager`** (`src/components/instruments/InstrumentManager.jsx`) — `InstrumentManager` does not receive `currentBeat`, yet previously re-rendered on every 30-fps beat tick because its parent (`Player`) re-rendered. With `memo`, it only re-renders when its own props change (e.g. `flashCount` on note trigger, `initialReady` on sampler load, `toggle` on track selection).
- [x] **Stable per-track callback props for `InstrumentManager`** (`src/components/Player.jsx`) — The JSX previously created new inline arrow functions (`handleAudioReady`, `onSwapInstrument`) and a new `callbacks` object literal on every Player render, defeating `React.memo`. Replaced with two `useMemo` blocks: `trackHandlers` (per-track, keyed on track count + stable callbacks) and `instrumentCallbacks` (shared object of stable state-setter refs). Dead `onReady`/`offReady` props — confirmed not destructured by `InstrumentManager` — removed entirely.

### 🟠 High — GPU Compositing Hints

- [x] **`willChange: "transform"` on Pixi canvas container** (`src/components/Visualizer.jsx`) — Tells the browser to promote the PixiJS canvas host element to its own GPU compositor layer. Reduces paint cost when the play bar, particles, and scroll layer animate each frame.
- [x] **`willChange: "transform"` on SongTimeline playhead** (`src/components/SongTimeline.jsx`) — The playhead `<div>` moves on every beat tick (~30 fps). GPU layer promotion means position updates are composited without triggering browser layout or paint.

### 🟡 Medium — PixiJS Text Object Count

- [x] **Bar label density skip in `buildGuides()`** (`usePixiVisualizer.js`) — Every bar previously received a `new PIXI.Text()` label regardless of zoom level, each allocating a Canvas 2D context internally. A `labelInterval` is now computed from approximate bar pixel width: every 8th bar when bars are < 80 px wide, every 4th when < 160 px, every 2nd when < 320 px, every bar otherwise. Bar lines and beat lines are unaffected. At minimum zoom with a 3-minute song this reduces `PIXI.Text` objects from ~180 to ~23.

### 🟡 Medium — Build & Dev Server

- [x] **`esbuild.drop: ["console", "debugger"]` in production** (`vite.config.js`) — Strips all `console.*` calls and `debugger` statements from the production bundle. Saves ~5–10 KB minified and removes log noise on mobile.
- [x] **`build.target: "es2020"`** (`vite.config.js`) — Targets modern syntax, enabling more aggressive tree-shaking and avoiding unnecessary transpilation of optional chaining, nullish coalescing, etc.
- [x] **`optimizeDeps.include` for tone, pixi.js, pixi-filters** (`vite.config.js`) — Explicitly pre-bundles the three heaviest ESM dependencies during Vite dev-server startup. Eliminates repeated on-demand transforms during development HMR and reduces cold-start time.

---

## Batch 5 — UX Fixes & Feature: Song Hints

### 🟢 Bug Fix — SongTimeline Zoom Drag Pauses Playback

- [x] **Zoom-handle drag no longer pauses playback** (`src/components/SongTimeline.jsx`) — The `startDrag` function called `onScrubStart` (→ `pausePlayback`) unconditionally for all three drag types: `thumb` (scrub), `left` (zoom), `right` (zoom). Changed to only call `onScrubStart` when `type === "thumb"`. Dragging the left or right edge to zoom now leaves the song playing; only scrubbing the thumb pauses it.

### 🟢 Feature — Per-Track Instrument Hints in Song JSON

- [x] **`hint` property on song tracks** (`public/songs/departure.json`, `scripts/convert-midi.mjs`) — Songs can now declare an optional `hint` string on any track (e.g. `"hint": "alto"`). `departure.json` track 0 now carries `"hint": "alto"` since this piece is written for an alto recorder. The `convert-midi.mjs` script accepts a 4th component in `--track` specs (`0:recorder:0:alto`) and writes it to the output JSON.
- [x] **Auto-apply hint on song load with toast notification** (`src/hooks/usePlayer.js`, `src/components/Player.jsx`, locales) — When `selectSong` is called, `usePlayer` checks `tracks[0].hint`. If it matches a known recorder type (`soprano`, `alto`, `tenor`, `bass`), it calls `setRecorderType` automatically and sets a `pendingHint` state. `Player` renders a dismissible `AnimatePresence` toast at the bottom of the screen showing e.g. *"Switched to Alto recorder — suggested by this song"*, which auto-clears after 3 seconds. i18n keys added for `en`, `de`, and `vi`.

### 🟢 Bug Fix — Guide Bar Misalignment During Zoom

- [x] **Guide bars immediately rescale on `noteWidth` change** (`usePixiVisualizer.js`) — `buildGuides()` is debounced 60 ms to prevent GC thrashing during zoom gestures, but `scrollLayer.x` and note sprites updated immediately. This left guide bar/beat lines at old pixel positions for 60 ms — visibly misaligned. Fix: capture `prevPpb` before updating `pixelsPerBeatRef`, compute `ratio = newPpb / prevPpb`, and multiply every guide child's `.x` by that ratio synchronously in the same effect. The debounced full rebuild still fires for text label correctness.

---

## Batch 6 — GPU Filter Passes & Per-Frame Micro-optimisations

### 🔴 Critical — Per-hole GlowFilter Elimination

- [x] **GlowFilter moved from each hole shadow → one per colour-group per note** (`geometryUtils.js`, `RecorderVisualizer.js`, `GuitarVisualizer.js`) — Each active recorder hole previously allocated a `GlowFilter` on its shadow layer inside `drawFingering`. A typical recorder note has 4–8 active holes, so with 70+ notes in the lazy-allocation buffer a dense song ran **350–560 GlowFilter instances per frame** (each requiring 3 GPU render passes: source render + horizontal blur + vertical blur). The fix removes all per-hole filters from `drawFingering` and `drawGuitarNote`; the shadow layer is now a plain semi-transparent tinted `Graphics` object (alpha 0.55–0.60) that provides visual depth without a filter pass. `drawFingering` now routes holes into two typed sub-containers: `fullGroup` (state `"1"`, full-note colour) and `halfGroup` (state `"h"`, half-note colour), only creating a group when that hole type is actually present. `RecorderVisualizer.createSprite` adds a correctly-coloured `GlowFilter` to each non-null group in non-eco mode, and keeps the `ColorMatrixFilter` (brightness pulse) on the outer `graphics` container so it wraps all holes uniformly. Notes with a single hole type get **1 glow + 1 brightness = 4 passes**; notes with both types get **2 glows + 1 brightness = 7 passes** — both far fewer than the old **12–25 passes per note**. `GuitarVisualizer` follows the same pattern with a single pill group. Result: **3–6× GPU fill-rate reduction** on a typical recorder track while preserving accurate per-colour glows.

### 🟠 High — CSS Variable Reads Cached in GuitarVisualizer

- [x] **Module-level `_cssVarsCache` in `GuitarVisualizer.js`** — `getFretColor`, `getDarkColor`, `getTextPrimaryColor`, `getSubColor`, and `getWhiteColor` each called `getComputedStyle(document.documentElement)` on every invocation. `createSprite` called all five on every note sprite allocation (song start, scrub jumps, lazy-buffer entry). Replaced with a single `getCssVars()` call that reads all six CSS custom properties once and caches the result in a module-level object. CSS variables do not change during a session so the cache is always valid.

### 🟡 Medium — Fingering Colour Cache in RecorderVisualizer

- [x] **Per-instance `_colorCache` in `RecorderVisualizerInstrument`** — `getFingeringColors()` called `getComputedStyle` on every `createSprite` invocation. Cached in an instance field (`_colorCache`) so the style recalculation fires at most once per instrument instance lifetime.

### 🟡 Medium — Scale Animation Early-Exit Guard

- [x] **`Math.abs(diff) > 0.001` guard in `onTickSprite`** (`RecorderVisualizer.js`, `GuitarVisualizer.js`) — The hole/pill scale lerp (`hole.scale.y += diff * HOLE_SCALE_ALPHA`) ran unconditionally every frame for every on-screen sprite, even after the animation had fully settled (inactive note resting at scale 1.0). With 70+ sprites on screen and `HOLE_SCALE_ALPHA = 0.18` settling in ~20 frames, the multiply ran thousands of times per second doing nothing. The guard skips the assignment once `|target − current| < 0.001`, eliminating the per-frame cost for all non-transitioning notes.

### 🟢 Low — Particle Cleanup O(1) via Swap-and-Pop

- [x] **`splice(i, 1)` → swap-and-pop + hoisted `dtSeconds`** (`usePixiVisualizer.js`) — The backward-iteration particle loop called `splice(i, 1)` to remove dead particles, which shifts every subsequent element in the array — O(n) per removal. Replaced with forward iteration: the dead particle's slot is filled with the last array element and `pop()` removes the now-duplicated tail in O(1). `dtSeconds` was also being recomputed inside the loop body on every iteration; it is now derived once before the loop since `tickerArg.deltaMS` is constant for the entire frame.


