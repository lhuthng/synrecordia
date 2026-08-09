# Creating a Custom Sample Pack for Synrecordia

A step-by-step guide to recording your own instrument in FL Studio and
packaging it as a sample pack that drops straight into the app.

---

## How it works

Synrecordia's sampler works like this:

```
public/samples/
  {instrument}/
    index.json                  ← lists available versions + the default
    {version}/
      index.json                ← maps note names → MP3 filenames
      A0v1.mp3
      C1v1.mp3
      Ds1v1.mp3
      …
```

When you play a note the app:
1. Looks up the closest recorded note in `index.json`
2. Loads the matching MP3
3. Pitch-shifts it in real time to reach the exact target pitch

This means you **don't have to record every single key** — the sampler
fills the gaps automatically.

---

## Choosing a sampling strategy

| Strategy | Notes recorded | Gap pitch-shifted | Quality | Recording time |
|----------|---------------|------------------|---------|----------------|
| **Salamander** (recommended) | 30 (A, C, D♯, F♯ per octave) | ±1.5 semitones | Very good | ~2 min at 4 s/note |
| **Every other note** | 44 | ±0.5 semitones | Excellent | ~3 min |
| **Chromatic** | 85 (C1→C8) | 0 | Perfect | ~6 min |

Start with **Salamander-style** — it's the same grid used by the
reference piano pack, and the sampler handles the tiny pitch shifts
transparently.

---

## Prerequisites

| Tool | Install |
|------|---------|
| **Python 3.8+** | https://python.org/downloads |
| **ffmpeg** | `brew install ffmpeg` (macOS) · https://ffmpeg.org/download.html |
| **FL Studio** | Any edition with your instrument loaded |

Verify ffmpeg is on your PATH:
```sh
ffmpeg -version
```

---

## Step 1 — Generate the MIDI template

The MIDI generator creates a file with all the notes laid out at perfectly
even intervals. Import it into FL Studio instead of placing notes by hand.

```sh
# Salamander-style (recommended for first pack)
python3 scripts/fl_midi_generator.py --out my_session.mid

# Chromatic (every semitone C1→C8)
python3 scripts/fl_midi_generator.py --mode chromatic --out my_session.mid
```

The script prints a summary like:

```
  ✅  MIDI file written → my_session.mid

  Mode       : salamander  (30 notes)
  Tempo      : 60 BPM
  Slot width : 4 beats  =  4.0 s per note
  Hold time  : 2 beats  =  2.0 s  (then 2.0 s decay/release)
  Total      : ~120 s  (2.0 min)
```

**Keep note of the numbers** — you'll pass them to the slicer in Step 4.

### MIDI options

| Flag | Default | Meaning |
|------|---------|---------|
| `--mode` | `salamander` | Note coverage (salamander / chromatic) |
| `--bpm` | `60` | Tempo embedded in the MIDI |
| `--interval` | `4` | Beats between note starts |
| `--hold` | `2` | Beats each note is held (rest = decay time) |
| `--velocity` | `100` | Note-on velocity (1–127) |
| `--out` | `fl_notes.mid` | Output file path |

> **Tip — long-release instruments (pads, strings, organs):**  
> Increase `--interval` so there's enough room for the tail to decay before
> the next note starts. For example, `--interval 8` gives 8 seconds per slot
> at 60 BPM.

---

## Step 2 — Set up FL Studio

### Import the MIDI

1. Open FL Studio
2. **File → Import → MIDI file** → select `my_session.mid`
3. FL Studio opens a new pattern in the Piano Roll with all the notes
   already placed

### Load your instrument

4. In the **Channel Rack**, click the channel that was created by the import
5. Replace the default plugin with your instrument (VST, sample-based, etc.)
6. Dial in the exact sound you want to capture

### Check the BPM

7. In the top toolbar, confirm the BPM matches what you used with the MIDI
   generator (default: **60**)

> **Why 60 BPM?**  
> At 60 BPM, 1 beat = 1 second, so the timing math is trivially simple and
> easy to verify by ear. Unless you have a reason to change it, stick with 60.

### Mixer / FX tips

- Route the channel through the **Mixer** if you want to add EQ, compression,
  or reverb before capturing. Just remember: whatever you add is baked in.
- Keep **reverb tails shorter** than the silence window between notes (default:
  2 seconds of silence per 4-second slot). A huge reverb tail bleeds into the
  next sample.
- Use **no limiting/clipping** on the master — keep peaks below −1 dBFS so
  the WAV has headroom.

---

## Step 3 — Export from FL Studio

1. **File → Export → Wave file** (not MP3 — we'll convert ourselves)
2. Use these settings:

   | Setting | Value |
   |---------|-------|
   | Format | WAV |
   | Bit depth | **32-bit float** (or 24-bit) |
   | Sample rate | **44100 Hz** |
   | Mode | **Full song** (or render the pattern, not just the selection) |
   | Enable remix export | Off |
   | Split mixer tracks | Off |
   | Tail | **0 ms** (no extra silence added at the end) |

3. Save the file somewhere memorable, e.g. `my_export.wav`

> **Check the file length.**  
> At 60 BPM, 30 Salamander notes × 4 seconds = **120 seconds minimum**.  
> Open the WAV in any audio player and verify it's at least that long before
> continuing.

---

## Step 4 — Slice with the script

The slicer reads the master WAV and cuts it into individual note files,
converts each to MP3, and writes `index.json`.

```sh
python3 scripts/fl_sample_slicer.py my_export.wav
```

This uses all the same defaults as the MIDI generator (60 BPM, 4-beat
interval, salamander mode) so no extra flags are needed if you kept the
defaults.

### If you changed the MIDI generator settings

Pass the same values here:

```sh
python3 scripts/fl_sample_slicer.py my_export.wav \
  --mode     salamander \
  --bpm      60 \
  --interval 4 \
  --duration 3
```

### Slicer options

| Flag | Default | Meaning |
|------|---------|---------|
| `--mode` | `salamander` | Must match the MIDI generator mode |
| `--bpm` | `60` | BPM of the FL Studio project |
| `--interval` | `4` | Beats between note starts |
| `--duration` | `3` | Seconds to keep per slice |
| `--offset` | `0` | Seconds before the first note |
| `--out` | `output` | Output directory |
| `--stereo` | off | Keep stereo (default: convert to mono) |
| `--bitrate` | `128k` | MP3 quality (96k / 128k / 192k / 320k) |
| `--trim-silence` | off | Strip trailing silence automatically |
| `--version-suffix` | `v1` | Suffix on every filename (`A4v1.mp3`) |
| `--instrument` | `` | Printed in the install commands at the end |
| `--dry-run` | off | Preview the plan without writing any files |

### Choosing `--duration`

`--duration` is how many seconds each slice is kept. It must be **less than
the slot length** (`interval × 60 / BPM`) or slices will bleed into each
other.

A safe default formula:

```
duration = hold_beats × (60 / BPM) + 0.5
         = 2 × 1 + 0.5  =  2.5 s   (at 60 BPM, 2-beat hold)
```

If your instrument has a sharp attack and fast decay, you can use `--trim-silence`
to automatically remove silence at the end of each slice.

### Dry run first

Preview what the slicer will do without touching any files:

```sh
python3 scripts/fl_sample_slicer.py my_export.wav --dry-run
```

Sample output:

```
  [01/30]  A0     0.00s – 3.00s  →  A0v1.mp3
  [02/30]  C1     4.00s – 7.00s  →  C1v1.mp3
  [03/30]  D#1    8.00s – 11.00s →  Ds1v1.mp3
  …
```

Verify the timing looks right before committing.

---

## Step 5 — Install in Synrecordia

The slicer creates an `output/` directory (or whatever you passed to `--out`):

```
output/
  A0v1.mp3
  C1v1.mp3
  Ds1v1.mp3
  …
  index.json
```

### 1. Copy the version folder

```
public/samples/{instrument}/{version}/
```

Example — you've made a Rhodes electric piano pack called "my-rhodes":

```
public/samples/rhodes/my-rhodes/
  A0v1.mp3
  C1v1.mp3
  …
  index.json
```

### 2. Create the top-level index

Create `public/samples/rhodes/index.json`:

```json
{
  "versions": ["my-rhodes"],
  "default": "my-rhodes"
}
```

If you later record a second version (e.g. a different velocity or mic
position), add it to `versions`:

```json
{
  "versions": ["my-rhodes", "my-rhodes-bright"],
  "default": "my-rhodes"
}
```

### 3. Wire up the instrument in the app

The instrument name in the app corresponds to the folder name under
`public/samples/`. If you want the app to know about "rhodes", you'll need
to add it to wherever instruments are registered in the codebase (check the
`InstrumentManager` component).

### 4. Test

```sh
npm run dev
```

Open the app, select your instrument, and play notes. Listen for:

- **Clicks or pops** at the start or end of samples (adjust `--duration` or
  use `--trim-silence`)
- **Pitch drift** between adjacent notes (usually a sign the FL Studio BPM
  didn't match the slicer's `--bpm`)
- **Uneven volume** between notes (add a limiter in the FL Studio mixer before
  exporting, or normalize manually)

---

## Troubleshooting

### Slices sound cut off too early

Increase `--duration`. At 60 BPM with a 4-beat slot you have up to 3.9 s
before you hit the next note.

### Slices bleed into the next note

Either:
- Decrease `--duration` (leave more room)
- Increase `--interval` in the MIDI generator (record with more silence
  between notes) and pass the same value to the slicer

### Notes are in the wrong order / pitch

The MIDI file and slicer must use the **same `--mode`** (`salamander` or
`chromatic`). If you recorded different notes, edit the `SALAMANDER_NOTES`
list at the top of `fl_sample_slicer.py` to match exactly what you recorded.

### The first note starts too late / too early

Measure the actual onset in an audio editor and pass the offset in seconds
via `--offset`. For example, if FL Studio added 0.5 s of silence before note 1:

```sh
python scripts/fl_sample_slicer.py my_export.wav --offset 0.5
```

### MP3 files are too large

Lower the bitrate:

```sh
python scripts/fl_sample_slicer.py my_export.wav --bitrate 96k
```

For piano/keys, `96k` mono is transparent. For very percussive transients
or wide stereo pads you might prefer `192k`.

---

## Quick-reference cheat sheet

```sh
# 1. Generate MIDI template (salamander, 60 BPM, 4 s/note)
python3 scripts/fl_midi_generator.py --out session.mid

# 2. [FL Studio] Import MIDI → load instrument → export WAV at 44100 Hz

# 3. Preview the slice plan
python3 scripts/fl_sample_slicer.py my_export.wav --dry-run

# 4. Slice + convert to MP3
python3 scripts/fl_sample_slicer.py my_export.wav \
  --out output/my-instrument-v1 \
  --instrument my-instrument \
  --bitrate 128k

# 5. Copy output into the project
#    → public/samples/my-instrument/my-instrument-v1/
#    → create public/samples/my-instrument/index.json

# 6. npm run dev → test in browser
```

---

## File naming reference

The index.json maps **note names** (as the sampler sees them) to
**filenames**. Sharps are written with `s` in filenames to stay
filesystem-safe:

| Note | JSON key | Filename stem |
|------|----------|---------------|
| A0 | `"A0"` | `A0v1` |
| C1 | `"C1"` | `C1v1` |
| D♯1 | `"D#1"` | `Ds1v1` |
| F♯1 | `"F#1"` | `Fs1v1` |
| C4 (middle C) | `"C4"` | `C4v1` |
| A4 (concert A) | `"A4"` | `A4v1` |

The `v1` suffix is the velocity layer tag. If you later record multiple
dynamics (soft, medium, loud) you can use `v1`, `v2`, `v3` etc. and extend
the sampler to pick the right layer at runtime.