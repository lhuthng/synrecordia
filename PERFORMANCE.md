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