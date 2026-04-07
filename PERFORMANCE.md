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