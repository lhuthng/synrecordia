#!/usr/bin/env python3
"""
fl_sample_slicer.py
===================
Slice an FL Studio master WAV export into individual note MP3 samples
and generate the index.json required by Synrecordia.

USAGE
-----
  # Basic (uses all defaults — matches fl_midi_generator.py defaults):
  python fl_sample_slicer.py my_export.wav

  # Chromatic mode, stereo, 192 kbps:
  python fl_sample_slicer.py my_export.wav --mode chromatic --stereo --bitrate 192k

  # Custom timing (e.g. 120 BPM, 2-beat slots):
  python fl_sample_slicer.py my_export.wav --bpm 120 --interval 2 --duration 1.8

  # Trim leading silence automatically:
  python fl_sample_slicer.py my_export.wav --trim-silence

REQUIREMENTS
------------
  - Python 3.8+
  - ffmpeg  (brew install ffmpeg  /  https://ffmpeg.org/download.html)

OUTPUT
------
  <output-dir>/
    A0v1.mp3
    C1v1.mp3
    Ds1v1.mp3
    ...
    index.json          ← drop this folder into public/samples/{instrument}/{version}/

  Then create/update  public/samples/{instrument}/index.json :
    { "versions": ["my-version"], "default": "my-version" }
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import NamedTuple

# ──────────────────────────────────────────────────────────────────────────────
# Note definitions
# ──────────────────────────────────────────────────────────────────────────────


class Note(NamedTuple):
    """One entry in a sample pack."""

    json_key: str  # key used in index.json  e.g. "D#3"
    file_stem: str  # MP3 filename stem        e.g. "Ds3v1"


# Salamander-style: A, C, D#, F# per octave — 30 notes total.
# Matches the Salamander Grand Piano v2 layout exactly.
SALAMANDER_NOTES: list[Note] = [
    Note("A0", "A0v1"),
    Note("C1", "C1v1"),
    Note("D#1", "Ds1v1"),
    Note("F#1", "Fs1v1"),
    Note("A1", "A1v1"),
    Note("C2", "C2v1"),
    Note("D#2", "Ds2v1"),
    Note("F#2", "Fs2v1"),
    Note("A2", "A2v1"),
    Note("C3", "C3v1"),
    Note("D#3", "Ds3v1"),
    Note("F#3", "Fs3v1"),
    Note("A3", "A3v1"),
    Note("C4", "C4v1"),
    Note("D#4", "Ds4v1"),
    Note("F#4", "Fs4v1"),
    Note("A4", "A4v1"),
    Note("C5", "C5v1"),
    Note("D#5", "Ds5v1"),
    Note("F#5", "Fs5v1"),
    Note("A5", "A5v1"),
    Note("C6", "C6v1"),
    Note("D#6", "Ds6v1"),
    Note("F#6", "Fs6v1"),
    Note("A6", "A6v1"),
    Note("C7", "C7v1"),
    Note("D#7", "Ds7v1"),
    Note("F#7", "Fs7v1"),
    Note("A7", "A7v1"),
    Note("C8", "C8v1"),
]

# Chromatic: every semitone C1 → C8 (85 notes).
_DISPLAY = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FILENAME = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]

CHROMATIC_NOTES: list[Note] = [
    Note(
        json_key=f"{_DISPLAY[n % 12]}{(n // 12) - 1}",
        file_stem=f"{_FILENAME[n % 12]}{(n // 12) - 1}v1",
    )
    for n in range(24, 109)  # C1 (MIDI 24) → C8 (MIDI 108)
]


# ──────────────────────────────────────────────────────────────────────────────
# Defaults — keep in sync with fl_midi_generator.py
# ──────────────────────────────────────────────────────────────────────────────

DEFAULT_BPM = 60.0  # beats per minute used in FL Studio
DEFAULT_INTERVAL = 4.0  # beats between consecutive note onsets
DEFAULT_DURATION = 3.0  # seconds to keep per slice  (< slot length → discards tail)
DEFAULT_OFFSET = 0.0  # seconds before the very first note
DEFAULT_BITRATE = "128k"  # MP3 quality: 96k / 128k / 192k / 256k / 320k
DEFAULT_OUT = "output"


# ──────────────────────────────────────────────────────────────────────────────
# ffmpeg helpers
# ──────────────────────────────────────────────────────────────────────────────


def check_ffmpeg() -> None:
    """Abort early if ffmpeg is not on PATH."""
    if shutil.which("ffmpeg") is None:
        print(
            "\n  ❌  ffmpeg not found on PATH.\n"
            "      macOS  :  brew install ffmpeg\n"
            "      Windows:  https://ffmpeg.org/download.html\n"
            "      Linux  :  sudo apt install ffmpeg\n",
            file=sys.stderr,
        )
        sys.exit(1)


def get_audio_duration(path: str) -> float | None:
    """Return the total duration of an audio file in seconds using ffprobe."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception:
        pass
    return None


def detect_silence_end(path: str, threshold_db: float = -50.0) -> float | None:
    """
    Use ffmpeg's silencedetect filter to find where audio drops below
    threshold_db. Returns the timestamp (in seconds) of the last non-silent
    sample, or None if detection fails.
    """
    cmd = [
        "ffmpeg",
        "-i",
        path,
        "-af",
        f"silencedetect=noise={threshold_db}dB:d=0.1",
        "-f",
        "null",
        "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        output = result.stderr  # ffmpeg sends filter output to stderr
        # Find all "silence_start" timestamps — the last one = end of audio
        starts = []
        for line in output.splitlines():
            if "silence_start:" in line:
                try:
                    starts.append(float(line.split("silence_start:")[1].strip()))
                except ValueError:
                    pass
        return starts[-1] if starts else None
    except Exception:
        return None


def slice_note(
    input_file: str,
    start_sec: float,
    duration_sec: float,
    output_path: str,
    bitrate: str,
    channels: int = 1,
    trim_silence: bool = False,
    silence_threshold_db: float = -50.0,
) -> bool:
    """
    Extract one note slice from *input_file* using ffmpeg and write an MP3.

    Parameters
    ----------
    input_file          : source WAV (or any audio ffmpeg can read)
    start_sec           : onset time of this note in the source file
    duration_sec        : how many seconds to extract
    output_path         : destination .mp3 path
    bitrate             : MP3 bit-rate string e.g. "128k"
    channels            : 1 = mono (default, saves ~50% size), 2 = stereo
    trim_silence        : if True, apply a fade-out and trim trailing silence
    silence_threshold_db: threshold used for trailing-silence detection
    """
    audio_filters: list[str] = []

    if trim_silence:
        # Trim trailing silence from the slice
        audio_filters.append(
            f"silenceremove=stop_periods=-1:stop_duration=0.05:stop_threshold={silence_threshold_db}dB"
        )

    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_sec:.6f}",
        "-t",
        f"{duration_sec:.6f}",
        "-i",
        input_file,
        "-ar",
        "44100",
        "-ac",
        str(channels),
        "-b:a",
        bitrate,
        "-map_metadata",
        "-1",  # strip embedded metadata / artwork
        "-id3v2_version",
        "3",
    ]

    if audio_filters:
        cmd += ["-af", ",".join(audio_filters)]

    cmd.append(output_path)

    result = subprocess.run(cmd, capture_output=True)

    if result.returncode != 0:
        snippet = result.stderr.decode(errors="replace")
        # Show only the last few lines to avoid flooding the terminal
        last_lines = "\n".join(snippet.splitlines()[-6:])
        print(
            f"\n    ⚠️  ffmpeg error for {os.path.basename(output_path)}:\n{last_lines}\n"
        )
        return False

    return True


# ──────────────────────────────────────────────────────────────────────────────
# Argument parsing
# ──────────────────────────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Slice an FL Studio WAV export into a Synrecordia sample pack.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
TIMING
  The slicer computes each note's start time as:
      start = OFFSET + (note_index × INTERVAL_beats × 60 / BPM)

  Use the same --bpm, --interval, and --offset values that you used with
  fl_midi_generator.py (or the matching FL Studio project settings).

SLICE DURATION
  --duration should be shorter than the slot (INTERVAL × 60/BPM) so you
  don't bleed into the next note.  A good rule of thumb:
      duration ≈ (slot_seconds × 0.85)  or  (hold_beats × 60/BPM + 0.5 s)

OUTPUT STRUCTURE
  output-dir/
    A0v1.mp3
    C1v1.mp3
    ...
    index.json

  Copy this folder to:
    public/samples/{instrument}/{version}/

  Then create / update:
    public/samples/{instrument}/index.json
    { "versions": ["version-name"], "default": "version-name" }
        """,
    )

    p.add_argument(
        "input",
        help="Master WAV file exported from FL Studio",
    )
    p.add_argument(
        "--out",
        "-o",
        default=DEFAULT_OUT,
        help=f"Output directory  (default: {DEFAULT_OUT!r})",
    )
    p.add_argument(
        "--mode",
        "-m",
        choices=["salamander", "chromatic"],
        default="salamander",
        help="Note layout — must match the mode used in fl_midi_generator.py  (default: salamander)",
    )
    p.add_argument(
        "--bpm",
        "-b",
        type=float,
        default=DEFAULT_BPM,
        help=f"BPM of the FL Studio project  (default: {DEFAULT_BPM})",
    )
    p.add_argument(
        "--interval",
        "-i",
        type=float,
        default=DEFAULT_INTERVAL,
        help=f"Beats between consecutive note starts  (default: {DEFAULT_INTERVAL})",
    )
    p.add_argument(
        "--duration",
        "-d",
        type=float,
        default=DEFAULT_DURATION,
        help=f"Seconds to extract per note slice  (default: {DEFAULT_DURATION})",
    )
    p.add_argument(
        "--offset",
        "-s",
        type=float,
        default=DEFAULT_OFFSET,
        help=f"Seconds before the very first note  (default: {DEFAULT_OFFSET})",
    )
    p.add_argument(
        "--stereo",
        action="store_true",
        help="Keep stereo output (default: convert to mono to save ~50%% file size)",
    )
    p.add_argument(
        "--bitrate",
        "-q",
        default=DEFAULT_BITRATE,
        help=f"MP3 bit-rate, e.g. 96k / 128k / 192k / 320k  (default: {DEFAULT_BITRATE!r})",
    )
    p.add_argument(
        "--trim-silence",
        action="store_true",
        help="Apply ffmpeg silenceremove filter to strip trailing silence from each slice",
    )
    p.add_argument(
        "--silence-db",
        type=float,
        default=-50.0,
        help="Silence threshold in dBFS used with --trim-silence  (default: -50.0)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the plan without actually running ffmpeg or writing files",
    )
    p.add_argument(
        "--version-suffix",
        default="v1",
        help="Version tag appended to every file stem, e.g. 'v1' → A4v1.mp3  (default: v1)",
    )
    p.add_argument(
        "--instrument",
        default="",
        help="Instrument name used to print the final installation commands  (optional)",
    )

    return p.parse_args()


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────


def main() -> None:
    args = parse_args()

    # ── Validate inputs ───────────────────────────────────────────────────────
    if args.bpm <= 0:
        sys.exit("Error: --bpm must be positive.")
    if args.interval <= 0:
        sys.exit("Error: --interval must be positive.")
    if args.duration <= 0:
        sys.exit("Error: --duration must be positive.")
    if args.offset < 0:
        sys.exit("Error: --offset must be >= 0.")

    input_path = args.input
    if not os.path.isfile(input_path):
        sys.exit(f"Error: input file not found: {input_path!r}")

    check_ffmpeg()

    # ── Resolve note list (apply version suffix override) ─────────────────────
    base_notes = SALAMANDER_NOTES if args.mode == "salamander" else CHROMATIC_NOTES

    # Replace the hardcoded "v1" suffix with the user's choice
    notes: list[Note] = [
        Note(n.json_key, n.file_stem.replace("v1", args.version_suffix))
        for n in base_notes
    ]

    # ── Timing math ───────────────────────────────────────────────────────────
    sec_per_beat = 60.0 / args.bpm
    interval_sec = args.interval * sec_per_beat
    channels = 2 if args.stereo else 1

    # Sanity check: does duration fit inside the slot?
    if args.duration >= interval_sec:
        print(
            f"\n  ⚠️  Warning: --duration ({args.duration}s) >= slot length ({interval_sec:.2f}s).\n"
            f"     Slices will bleed into the next note. Consider reducing --duration.\n"
        )

    # ── Report the plan ───────────────────────────────────────────────────────
    total_sec = args.offset + len(notes) * interval_sec
    file_duration = get_audio_duration(input_path)

    print()
    print("  🎹  Sample Pack Slicer")
    print(f"  {'─' * 54}")
    print(f"  Input       : {input_path}")
    if file_duration is not None:
        needed_flag = " ✅" if file_duration >= total_sec else " ⚠️  FILE TOO SHORT!"
        print(
            f"  File length : {file_duration:.1f}s  (need ≥ {total_sec:.1f}s){needed_flag}"
        )
    print(f"  Mode        : {args.mode}  ({len(notes)} notes)")
    print(f"  BPM         : {args.bpm}  →  {interval_sec:.2f}s per slot")
    print(f"  Slice len   : {args.duration}s")
    print(f"  Offset      : {args.offset}s")
    print(f"  Output      : {args.out}/")
    print(f"  Channels    : {'stereo' if channels == 2 else 'mono'}")
    print(f"  Bitrate     : {args.bitrate}")
    print(
        f"  Trim silence: {'yes  (threshold ' + str(args.silence_db) + ' dBFS)' if args.trim_silence else 'no'}"
    )
    if args.dry_run:
        print("\n  ⚡  DRY RUN — no files will be written.\n")
    print()

    if args.dry_run:
        for i, note in enumerate(notes):
            start = args.offset + i * interval_sec
            end = start + args.duration
            print(
                f"  [{i + 1:02d}/{len(notes)}]  "
                f"{note.json_key:5s}  "
                f"{start:7.2f}s – {end:.2f}s  →  {note.file_stem}.mp3"
            )
        print(f"\n  {len(notes)} slices planned. Remove --dry-run to execute.\n")
        return

    # ── Create output directory ───────────────────────────────────────────────
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── Slice loop ────────────────────────────────────────────────────────────
    index: dict[str, str] = {}
    errors: list[str] = []

    for i, note in enumerate(notes):
        start = args.offset + i * interval_sec
        filename = f"{note.file_stem}.mp3"
        out_path = str(out_dir / filename)

        progress = f"[{i + 1:02d}/{len(notes)}]"
        print(
            f"  {progress}  {note.json_key:5s}  @ {start:7.2f}s  →  {filename}",
            end="",
            flush=True,
        )

        success = slice_note(
            input_file=input_path,
            start_sec=start,
            duration_sec=args.duration,
            output_path=out_path,
            bitrate=args.bitrate,
            channels=channels,
            trim_silence=args.trim_silence,
            silence_threshold_db=args.silence_db,
        )

        if success:
            size_kb = os.path.getsize(out_path) / 1024
            print(f"  ({size_kb:.0f} KB)")
            index[note.json_key] = filename
        else:
            print("  ❌ FAILED")
            errors.append(note.json_key)

    # ── Write index.json ──────────────────────────────────────────────────────
    index_path = out_dir / "index.json"
    with open(index_path, "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=2)
        fh.write("\n")

    # ── Summary ───────────────────────────────────────────────────────────────
    ok_count = len(notes) - len(errors)
    total_kb = sum(
        os.path.getsize(str(out_dir / f"{n.file_stem}.mp3")) / 1024
        for n in notes
        if n.json_key not in errors
    )

    print()
    print(f"  {'─' * 54}")
    if not errors:
        print(
            f"  ✅  {ok_count}/{len(notes)} notes  •  index.json  •  {total_kb:.0f} KB total"
        )
    else:
        print(
            f"  ⚠️  {ok_count}/{len(notes)} notes OK  •  {len(errors)} failed: {', '.join(errors)}"
        )
    print()

    # ── Installation instructions ─────────────────────────────────────────────
    folder_name = out_dir.name
    instrument = args.instrument or "<instrument>"
    version_name = folder_name

    print("  ── Install into Synrecordia ─────────────────────────────────")
    print()
    print("  1. Copy output folder into the project:")
    print(f"       public/samples/{instrument}/{version_name}/")
    print()
    print(f"  2. Create (or update)  public/samples/{instrument}/index.json :")
    print()
    print("       {{")
    print(f'         "versions": ["{version_name}"],')
    print(f'         "default":  "{version_name}"')
    print("       }}")
    print()
    print("  3. Restart the dev server and select your instrument in the app.")
    print()


if __name__ == "__main__":
    main()
