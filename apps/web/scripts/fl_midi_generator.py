#!/usr/bin/env python3
"""
fl_midi_generator.py
====================
Generate a MIDI template file for FL Studio sample-recording sessions.

Each note is placed at a fixed time interval so that — after you render the
project to WAV — the companion script fl_sample_slicer.py can cut the
recording into perfectly-timed individual note files.

No external packages required; uses only Python's standard library.

USAGE
-----
  python fl_midi_generator.py                          # Salamander-style, defaults
  python fl_midi_generator.py --mode chromatic         # every semitone C1→C8
  python fl_midi_generator.py --bpm 120 --interval 2  # faster (2 sec/note at 120 BPM)
  python fl_midi_generator.py --out my_session.mid

Then in FL Studio:
  1. File → Import → MIDI file → select the generated .mid
  2. Confirm BPM matches (default: 60)
  3. Load your instrument in the channel that opened
  4. File → Export → Wave file  (WAV, 32-bit float, 44100 Hz, no tails)
  5. Run:  python fl_sample_slicer.py <exported_file.wav>
"""

import argparse
import struct
import sys

# ──────────────────────────────────────────────────────────────────────────────
# Note definitions
# ──────────────────────────────────────────────────────────────────────────────

# Salamander-style: every minor third (A, C, D#, F#) across the full range.
# Matches the Salamander Grand Piano v2 sampling grid exactly.
# Format: (label_for_display, MIDI_note_number)
SALAMANDER_NOTES = [
    ("A0", 21),
    ("C1", 24),
    ("D#1", 27),
    ("F#1", 30),
    ("A1", 33),
    ("C2", 36),
    ("D#2", 39),
    ("F#2", 42),
    ("A2", 45),
    ("C3", 48),
    ("D#3", 51),
    ("F#3", 54),
    ("A3", 57),
    ("C4", 60),
    ("D#4", 63),
    ("F#4", 66),
    ("A4", 69),
    ("C5", 72),
    ("D#5", 75),
    ("F#5", 78),
    ("A5", 81),
    ("C6", 84),
    ("D#6", 87),
    ("F#6", 90),
    ("A6", 93),
    ("C7", 96),
    ("D#7", 99),
    ("F#7", 102),
    ("A7", 105),
    ("C8", 108),
]

# Chromatic: every semitone C1→C8 (all 85 notes in the standard piano range).
# Higher quality at the cost of a longer recording session.
_CHROMATIC_DISPLAY = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
CHROMATIC_NOTES = [
    (f"{_CHROMATIC_DISPLAY[n % 12]}{(n // 12) - 1}", n)
    for n in range(24, 109)  # C1 (MIDI 24) → C8 (MIDI 108)
]


# ──────────────────────────────────────────────────────────────────────────────
# MIDI encoding helpers
# ──────────────────────────────────────────────────────────────────────────────


def _vlq(value: int) -> bytes:
    """Encode a non-negative integer as a MIDI variable-length quantity."""
    if value < 0:
        raise ValueError(f"VLQ value must be >= 0, got {value}")
    groups = [value & 0x7F]
    value >>= 7
    while value > 0:
        groups.insert(0, (value & 0x7F) | 0x80)
        value >>= 7
    return bytes(groups)


def _make_tempo_event(bpm: float) -> bytes:
    """Return a Set Tempo meta-event (FF 51 03 tt tt tt)."""
    tempo_us = round(60_000_000 / bpm)  # microseconds per quarter-note
    if not (1 <= tempo_us <= 0xFFFFFF):
        raise ValueError(f"BPM {bpm} yields tempo {tempo_us} µs which is out of range.")
    return bytes([0xFF, 0x51, 0x03]) + tempo_us.to_bytes(3, "big")


def _make_track(events: list[tuple[int, bytes]]) -> bytes:
    """
    Build a complete MTrk chunk from a list of (absolute_tick, raw_bytes) events.
    Automatically appends an End-of-Track meta-event.
    """
    # Sort by tick; meta events (0xFF …) sort before channel events at same tick
    events = sorted(events, key=lambda e: (e[0], 0 if e[1][0] == 0xFF else 1))

    # Append End-of-Track
    last_tick = events[-1][0] if events else 0
    events.append((last_tick, bytes([0xFF, 0x2F, 0x00])))

    body = bytearray()
    prev_tick = 0
    for tick, data in events:
        delta = tick - prev_tick
        prev_tick = tick
        body += _vlq(delta)
        body += data

    return b"MTrk" + struct.pack(">I", len(body)) + bytes(body)


def build_midi(
    notes: list[tuple[str, int]],
    bpm: float = 60.0,
    ticks_per_beat: int = 480,
    beats_per_slot: float = 4.0,
    hold_beats: float = 2.0,
    velocity: int = 100,
) -> bytes:
    """
    Build a Type-0 MIDI file.

    Parameters
    ----------
    notes          : list of (label, midi_note) — label is only used for comments
    bpm            : tempo to embed in the MIDI file
    ticks_per_beat : MIDI resolution (480 is standard)
    beats_per_slot : how many beats between consecutive note onsets
    hold_beats     : how many beats each note is held before note-off
    velocity       : MIDI note-on velocity (1–127)
    """
    slot_ticks = round(beats_per_slot * ticks_per_beat)
    hold_ticks = round(hold_beats * ticks_per_beat)

    events: list[tuple[int, bytes]] = []

    # Tempo at tick 0
    events.append((0, _make_tempo_event(bpm)))

    for i, (_label, midi_note) in enumerate(notes):
        on_tick = i * slot_ticks
        off_tick = on_tick + hold_ticks

        if not (0 <= midi_note <= 127):
            raise ValueError(f"MIDI note {midi_note} is out of range (0–127).")
        if not (1 <= velocity <= 127):
            raise ValueError(f"Velocity {velocity} is out of range (1–127).")

        events.append((on_tick, bytes([0x90, midi_note, velocity])))  # note on
        events.append((off_tick, bytes([0x80, midi_note, 0])))  # note off

    track = _make_track(events)

    # Type-0 MIDI header (single track)
    header = (
        b"MThd"
        + struct.pack(">I", 6)  # header chunk length (always 6)
        + struct.pack(">H", 0)  # format 0 — single track
        + struct.pack(">H", 1)  # number of tracks
        + struct.pack(">H", ticks_per_beat)  # resolution
    )

    return header + track


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Generate a MIDI template for FL Studio sample-pack recording.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
MODES
  salamander  30 notes: A, C, D#, F# per octave  (A0 → C8)
              The sampler pitch-shifts ±1.5 semitones to fill gaps.
              Fastest to record; matches Salamander Grand Piano layout.

  chromatic   85 notes: every semitone  (C1 → C8)
              Highest quality — no pitch-shifting artefacts.
              Takes ~3× longer to record.

TIMING TIPS
  - Default: BPM=60, interval=4 beats → 4 seconds per note slot.
  - Hold=2 beats → 2 seconds of sustain, then 2 seconds of release/decay.
  - If your instrument has a very long tail, increase --interval.
  - Keep BPM=60 for the simplest slicer math (1 beat = 1 second).
        """,
    )
    p.add_argument(
        "--out",
        "-o",
        default="fl_notes.mid",
        help="Output MIDI file path  (default: fl_notes.mid)",
    )
    p.add_argument(
        "--mode",
        "-m",
        choices=["salamander", "chromatic"],
        default="salamander",
        help="Note coverage mode  (default: salamander)",
    )
    p.add_argument(
        "--bpm",
        "-b",
        type=float,
        default=60.0,
        help="Tempo to embed in the MIDI file  (default: 60)",
    )
    p.add_argument(
        "--interval",
        "-i",
        type=float,
        default=4.0,
        help="Beats between consecutive note starts  (default: 4)",
    )
    p.add_argument(
        "--hold",
        "-H",
        type=float,
        default=2.0,
        help="Beats each note is held before note-off  (default: 2)",
    )
    p.add_argument(
        "--velocity",
        "-v",
        type=int,
        default=100,
        help="MIDI note-on velocity 1–127  (default: 100 ≈ forte)",
    )
    p.add_argument(
        "--ticks",
        "-t",
        type=int,
        default=480,
        help="MIDI ticks per beat / resolution  (default: 480)",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()

    # Validate
    if args.bpm <= 0:
        print("Error: --bpm must be positive.", file=sys.stderr)
        sys.exit(1)
    if args.interval <= 0:
        print("Error: --interval must be positive.", file=sys.stderr)
        sys.exit(1)
    if args.hold <= 0 or args.hold >= args.interval:
        print(
            f"Error: --hold ({args.hold}) must be > 0 and < --interval ({args.interval}).",
            file=sys.stderr,
        )
        sys.exit(1)
    if not (1 <= args.velocity <= 127):
        print("Error: --velocity must be 1–127.", file=sys.stderr)
        sys.exit(1)

    notes = SALAMANDER_NOTES if args.mode == "salamander" else CHROMATIC_NOTES

    midi_bytes = build_midi(
        notes,
        bpm=args.bpm,
        ticks_per_beat=args.ticks,
        beats_per_slot=args.interval,
        hold_beats=args.hold,
        velocity=args.velocity,
    )

    with open(args.out, "wb") as fh:
        fh.write(midi_bytes)

    sec_per_slot = args.interval * 60.0 / args.bpm
    total_sec = len(notes) * sec_per_slot
    hold_sec = args.hold * 60.0 / args.bpm

    print()
    print(f"  ✅  MIDI file written → {args.out}")
    print()
    print(f"  Mode       : {args.mode}  ({len(notes)} notes)")
    print(f"  Tempo      : {args.bpm} BPM")
    print(f"  Slot width : {args.interval} beats  =  {sec_per_slot:.1f} s per note")
    print(
        f"  Hold time  : {args.hold} beats  =  {hold_sec:.1f} s  (then {sec_per_slot - hold_sec:.1f} s decay/release)"
    )
    print(f"  Total      : ~{total_sec:.0f} s  ({total_sec / 60:.1f} min)")
    print()
    print("  ── FL Studio steps ──────────────────────────────────────────────")
    print(f"  1. File → Import → MIDI file → select  {args.out}")
    print(f"  2. Confirm the project BPM is {args.bpm:.0f}")
    print("  3. In the new channel, load your instrument (VST / sampler / etc.)")
    print("  4. File → Export → Wave file")
    print("     • Format : WAV  32-bit float")
    print("     • Sample rate : 44100 Hz")
    print("     • Mode : Full song  (or render the pattern region only)")
    print("     • Leave tails OFF (or set tail to 0 ms)")
    print("  5. Note the output path, then run:")
    print()
    print("     python fl_sample_slicer.py <exported.wav> \\")
    print(
        f"       --mode {args.mode} --bpm {args.bpm:.0f} --interval {args.interval} --duration {hold_sec + 1.0:.1f}"
    )
    print()
    print("  ─────────────────────────────────────────────────────────────────")
    print()

    # Print note list for reference
    print("  Notes that will be recorded (in order):")
    cols = 6
    for i, (label, midi) in enumerate(notes):
        sep = "\n  " if i % cols == 0 else "  "
        print(f"{sep}{label:5s}(#{midi:3d})", end="")
    print("\n")


if __name__ == "__main__":
    main()
