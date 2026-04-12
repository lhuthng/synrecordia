# Visualizer - How It Works

The visualizer is a PIXI.js canvas that sits alongside Tone.js audio playback. The two systems are deliberately decoupled: Tone.js owns the clock; the canvas owns the pixels. Understanding how they talk to each other - and how the canvas keeps memory flat - is the core of the design.

---

## The world model

Everything in the scene lives inside a single `scrollLayer` container. The rule is simple:

> **The playhead is fixed. The world moves.**

Each note, bar line, and beat line is placed at a world-x coordinate derived from its **visual beat** position (see [BPM-section coordinate system](#bpm-section-coordinate-system) below):

```synrecordia/src/instruments/recorder/RecorderVisualizer.js#L191-193
container.x = -scaledGraphicsWidth - (event.visualTime ?? event.time) * ppb;
```

The negative sign puts future beats to the left and the past to the right, matching the conventional "music scrolls from right to left" direction. To scroll the scene, the ticker converts the current MIDI beat to a visual beat and sets:

```synrecordia/src/hooks/usePixiVisualizer.js#L942-945
const displayVisualBeat = beatToVisualBeat(beat, bpmsRef.current);
const desiredX = bx + displayVisualBeat * pxPerBeat;
```

`barX` is just the fixed pixel position of the playhead line (e.g. 95% of the canvas width). Increasing `displayVisualBeat` slides the world left, keeping the current beat under the playhead.

---

## Tone.js → canvas handoff

Tone.js fires React state updates with the current `currentBeat` value. That value flows into the hook as a prop and is immediately written to `currentBeatRef` and `targetBeatRef`. The canvas never reads React state inside its ticker loop — only refs. This matters because the ticker runs at 60 fps independently of React's render cycle, and reading stale closure values would cause drift.

The pipeline is:

    Tone.js transport tick
      → React state update (currentBeat prop)
        → useEffect writes currentBeatRef / targetBeatRef
          → PIXI ticker reads refs each frame

Tone.js is the source of truth for timing. The canvas is a consumer that smooths and renders it.

---

## Beat interpolation

The ticker doesn't use `currentBeat` directly for scrolling. It maintains its own `displayBeat` (in MIDI beats) that chases `targetBeat` with an exponential-decay lerp:

    displayBeat += (target - displayBeat) * (1 - exp(-k * elapsed))

Using wall-clock `elapsed` rather than a fixed alpha makes the lerp frame-rate independent — the same feel at 30 fps or 144 fps.

While playing, the target is also **projected forward** by elapsed wall-clock time:

    targetBeat = currentBeat + elapsed * (bpm / 60)

This keeps the animation gliding smoothly between React re-renders. Without it, every Tone.js tick would cause a small visible stutter because React updates are not frame-synchronised. The projection means the canvas always shows a plausible "where is the beat right now" estimate, and the next real update from Tone.js corrects any drift.

`displayBeat` is a MIDI beat. Before it is used for scrolling it is converted to a visual beat via `beatToVisualBeat` (see below). The conversion is monotonic so the lerp in MIDI-beat space produces equally smooth motion in visual-beat space.

Latency compensation is subtracted from `displayBeat` before scrolling, so a positive `latencyMs` makes the canvas lag behind the audio intentionally — useful on systems where audio output is delayed.

---

## BPM-section coordinate system

Songs can contain mid-song tempo changes stored in the `bpms` array of the song JSON:

```json
{
  "bpm": 120,
  "bpms": [
    { "beat": 0,  "bpm": 120 },
    { "beat": 48, "bpm": 144 }
  ]
}
```

`bpm` (the top-level field) is the **base BPM** — the value the UI slider controls. Each entry in `bpms` records the absolute BPM at a given MIDI beat.

The **visual scale** for a section is `baseBpm / sectionBpm`. A faster section
(higher BPM) produces a scale < 1, compressing it to fewer visual pixels per
MIDI beat. A slower section (lower BPM) produces a scale > 1, stretching it.

### `beatToVisualBeat` and `visualBeatToMidiBeat`

Two pure helper functions defined at the top of `usePixiVisualizer.js` implement
the coordinate conversion:

```synrecordia/src/hooks/usePixiVisualizer.js#L30-45
function beatToVisualBeat(midiBeat, bpms) {
  if (!bpms || bpms.length <= 1) return midiBeat;
  const baseBpm = bpms[0].bpm;
  let cumVisual = 0;
  let segStart = 0;
  for (let i = 0; i < bpms.length; i++) {
    const scale = baseBpm / bpms[i].bpm; // e.g. 180/240 = 0.75 → compressed
    const nextSegStart = i + 1 < bpms.length ? bpms[i + 1].beat : Infinity;
    if (midiBeat <= nextSegStart || !isFinite(nextSegStart)) {
      return cumVisual + (midiBeat - segStart) * scale;
    }
    cumVisual += (nextSegStart - segStart) * scale;
    segStart = nextSegStart;
  }
  return cumVisual;
}
```

`_visualBeatToMidiBeat` is the inverse — defined at module level and available
for use, but not yet wired up to scrub handlers (which currently operate with a
close-enough pixel-to-MIDI-beat approximation).

### What uses visual beats

| Location | What changes |
|---|---|
| `buildGuides` | Bar and beat line `.x` positions use `beatToVisualBeat(barBeat)` |
| `buildZones` | Song-end zone boundary uses `beatToVisualBeat(duration)` |
| `buildBpmRegions` | BPM region backgrounds and labels use `beatToVisualBeat(startBeat/endBeat)` |
| Ticker scroll | `scrollLayer.x` is set from `beatToVisualBeat(displayBeat)` |
| Sprite placement | `container.x` uses `event.visualTime` (pre-computed, see below) |
| Sprite culling | Binary search bounds `timeMaxBuf`/`timeMinBuf` compare against `event.visualTime` |

When `bpms` is absent or has a single entry, every conversion is an identity (`visualBeat === midibeat`) and behaviour is identical to the pre-BPM-scaling code.

### Pre-computed event fields

The `useLayoutEffect` that populates `noteEventsRef` annotates every event with visual coordinates computed once at load time:

    event.visualTime     = beatToVisualBeat(event.time,                  bpms)
    event.visualDuration = beatToVisualBeat(event.time + event.duration, bpms)
                         - event.visualTime

`createSprite` implementations (RecorderVisualizer, GuitarVisualizer) read `event.visualTime ?? event.time` for `container.x` and `event.visualDuration ?? event.duration` for width, falling back to raw MIDI values when the visual fields are absent.

The `isActive` check in the ticker (`beat >= sprite.time && beat < sprite.time + sprite.duration`) intentionally uses MIDI beats, not visual beats, so that note highlighting and particle emission fire at the correct musical moment regardless of tempo section.

### Slider and proportional scaling

The UI BPM slider changes `song.bpm` (the base BPM). Scale factors are derived at render time as `bpms[i].bpm / bpms[0].bpm`, so they are invariant with respect to slider changes. If the base BPM moves from 120 to 100, a section previously at 1.2× still plays at 1.2× of the new base (120 BPM effective). The visual compression ratio for each section is equally unaffected — only the overall scroll speed changes.

### BPM region visualization

When a song has more than one BPM entry, the visualizer draws a thin visual
indicator inside the scrolling canvas so the player can see where tempo changes
occur:

- **Even-indexed regions** (1-based: region 2, 4, …) receive a `bg-white/5`
  background rectangle spanning the full canvas height and the region's visual-beat
  width. Odd regions have no background — a song with only one BPM entry shows
  nothing extra.
- **Every region** gets a right-anchored label at the bottom-right corner showing
  the **scaled BPM** (`sliderBpm × sectionBpm / baseBpm`), so if you drag the
  BPM slider to half speed, all labels halve too.
- The same even/odd bands are drawn in the `SongTimeline` minimap as CSS
  `bg-white/5` absolute-positioned divs.

These objects live in a dedicated `bpmRegionLayer` container inserted into
`scrollLayer` between the zone-end overlays and the guide lines, so they render
under bar lines and note sprites. The layer is rebuilt whenever the song, the
BPM slider, the note width, or the duration changes.

#### Stale-closure safety

`buildBpmRegions` is a closure defined inside the async `init()` function. `init()`
only re-runs when canvas dimensions or the time signature change — not on every
song load. To ensure the closure always sees the current song's `bpms`, a
`bpmsRef` is written during React render (safe ref mutation, always fresh before
effects fire), and a dedicated `useEffect([displaySong])` calls
`buildBpmRegionsRef.current?.()` whenever the song changes.

---

### Multi-BPM playback (`usePlayer.js`)

The visualizer's coordinate system handles the *visual* side of tempo changes.
The *audio* side is handled in `usePlayer.js` with two helpers defined inside
`startPlayback`:

**`wallTimeToBeat(elapsed)`** — converts elapsed wall-clock seconds into the
current MIDI beat position by walking the `bpms` array piecewise. Each section
uses `effectiveBpm = section.bpm × (sliderBpm / baseBpm)`, so user slider
adjustments scale every section proportionally:

    segment 0: beats 0–432  at 180 BPM (base) → advance 3 beats/sec at slider=180
    segment 1: beats 432–564 at 240 BPM       → advance 4 beats/sec at slider=180
    segment 2: beats 564–684 at 180 BPM       → advance 3 beats/sec
    segment 3: beats 684+    at 130 BPM       → advance ≈2.17 beats/sec

**`beatRangeToSeconds(start, end)`** — converts a MIDI-beat duration to wall-clock
seconds. Used for `triggerAttackRelease` note duration so sampled notes in faster
sections are shorter and notes in slower sections are longer.

`wallTimeToBeatRef` stores the current closure so `handleBpmChange` can compute
the correct beat when the slider is dragged mid-playback, preventing a perceived
beat jump.

Both helpers fall back to the simple constant-BPM formula when `bpms` is absent
or has only one entry.

---

## Two kinds of objects, two memory strategies

The scene has two types of scrolling content handled differently, for good reason.

### Guide lines - keep everything, cull visibility

Bar lines and beat lines are pre-built once in `buildGuides` as plain `PIXI.Graphics` objects and added to `guideLayer`. They are cheap: no textures, no filters, no event listeners. The full set lives in memory for the entire song, but PIXI still pays a per-object cost during the render pass even for off-screen containers.

The fix is **visibility culling**. Objects with `visible = false` are completely skipped by the renderer. We track which children are currently on screen with a `{ left, right }` index pair — `guideVisWinRef` — and only flip visibility at the edges.

This works because `guideLayer.children` is sorted by `.x` in non-increasing order (beat 0 at index 0, then increasingly negative x values). The visible children are always a **contiguous slice** `[left, right]` of the array. Each frame, four short loops walk the boundaries:

    expand right  - while gc[right+1].x > xMin  → show, right++
    shrink right  - while gc[right].x  ≤ xMin   → hide, right--
    shrink left   - while gc[left].x   ≥ xMax   → hide, left++
    expand left   - while gc[left-1].x in range → show, left--

During normal forward playback roughly one child crosses each boundary per frame, so the cost is effectively **O(1)**. Scrubbing to a distant position is **O(Δ)** where Δ is the number of guides that crossed the viewport — proportional to how far you jumped, no more.

The x positions of guide lines are in **visual beat space** (i.e. multiplied by `beatToVisualBeat`), so the culling math works unchanged — it only cares about whether `child.x` is inside the scroll-layer-relative viewport, which remains valid regardless of the coordinate system used.

### Note sprites - allocate on demand, destroy when done

Notes are much heavier: each one is a container holding a `PIXI.Graphics` fingering diagram, a `GlowFilter`, a hover background, a text label, and event listeners. Keeping thousands of them alive for a long song would be expensive even with visibility culling.

So note sprites are **never pre-built**. `buildSprites` only stores raw event data (beat time, duration, fingering, and pre-computed visual coordinates) sorted by time into `noteEventsRef`. No PIXI objects are created at that point.

The ticker lazily allocates and destroys containers as notes enter or leave a **buffered viewport** — the visible area extended by `NOTE_LAZY_BUFFER_PX` on each side so that glow effects finish fading in before a note reaches the screen edge:

    timeMaxBuf = (scrollX + buffer) / ppb          ← future notes enter here (visual beats)
    timeMinBuf = (scrollX - width - buffer) / ppb  ← past notes destroyed here (visual beats)

The allocation window `visWinRef { start, end }` is found each frame with **binary search** into the sorted event array, comparing against `event.visualTime`. Notes whose index is in `[start, end)` but not in the previous window are allocated; notes that fell outside are destroyed. The Map `activeSpriteMapRef` keeps only the currently-live containers, so memory stays bounded by how many notes fit in the buffered viewport, not by the total song length.

Newly allocated sprites start at `alpha = 0` and lerp to `alpha = 1` over the next few frames, giving a smooth fade-in rather than a pop.

---

## Why the approaches differ

|                 | Guide lines                     | Note sprites                        |
|-----------------|---------------------------------|-------------------------------------|
| Cost per object | Low (plain graphics)            | High (filters, listeners, children) |
| Total count     | Fixed - whole song built once   | Unbounded in theory                 |
| Strategy        | Keep all, toggle `visible`      | Allocate on enter, destroy on exit  |
| Per-frame cost  | O(1) neighbor walk              | O(log n) binary search + O(Δ) alloc |

The guiding principle is the same in both cases: **only pay for what is on screen**. The implementations differ because guide lines are cheap enough to keep around, while note sprites are expensive enough to warrant true garbage collection.