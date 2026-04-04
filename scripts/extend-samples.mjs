#!/usr/bin/env node
/**
 * extend-samples.mjs
 *
 * Sample extender for synrecordia instrument folders.
 *
 * Reads a samples folder (e.g. public/samples/recorder), discovers version
 * sub-folders from its index.json, then for each version reads its index.json
 * to get all notes and their audio files.
 *
 * For every file shorter than --min-duration the script:
 *   1. Decodes the audio to a lossless temp WAV (sample-accurate processing).
 *   2. Analyzes the mono waveform to find upward zero crossings near the
 *      attack-end and release-start positions → clean, click-free loop points.
 *   3. Extracts three segments: attack (0→loopStart), body (loopStart→loopEnd),
 *      release (loopEnd→end).
 *   4. Builds an FFmpeg filtergraph:
 *        attack + [body × N, each pair joined by acrossfade] + release
 *      then trims the result to --min-duration and applies a fade-out.
 *   5. Re-encodes to the output path (MP3 / OGG / WAV auto-detected from ext).
 *
 * Requires: ffmpeg (with ffprobe) on PATH.
 *
 * Usage (from the project root):
 *   node scripts/extend-samples.mjs public/samples/recorder [options]
 *
 * Options:
 *   --min-duration <s>     Minimum output duration in seconds        (default: 8)
 *   --attack-ratio <0-1>   Fraction of duration to treat as attack   (default: 0.15)
 *   --release-ratio <0-1>  Fraction of duration to treat as release  (default: 0.20)
 *   --crossfade <s>        Crossfade at each loop boundary, seconds  (default: 0.05)
 *   --fade-out <s>         Fade-out applied to the tail              (default: 1.5)
 *   --output-dir <path>    Write extended files here
 *                          (default: <folder>-extended next to input folder)
 *   --in-place             Overwrite original files (use with caution)
 *   --versions <v1,v2>     Only process these versions (comma-separated)
 *   --dry-run              Preview actions without writing any audio
 *   --quality <0-9>        MP3 VBR quality for output (default: 2, lower = better)
 *   --zero-cross-window <s> Search window around target for zero crossings (default: 0.08)
 */

import { spawnSync } from "child_process";
import fsp from "fs/promises";
import fs from "fs";
import path from "path";
import os from "os";

// ─── ANSI colours ─────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  grey: "\x1b[90m",
};
const col = (c, s) => `${c}${s}${C.reset}`;

// ─── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    folderPath: null,
    minDuration: 8,
    attackRatio: 0.15,
    releaseRatio: 0.2,
    crossfade: 0.05,
    fadeOut: 1.5,
    outputDir: null, // null → <folder>-extended
    inPlace: false,
    versions: null, // null → all
    dryRun: false,
    quality: 2,
    zeroCrossWindow: 0.08,
    phaseWindow: 0.04,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--min-duration":
        opts.minDuration = parseFloat(args[++i]);
        break;
      case "--attack-ratio":
        opts.attackRatio = parseFloat(args[++i]);
        break;
      case "--release-ratio":
        opts.releaseRatio = parseFloat(args[++i]);
        break;
      case "--crossfade":
        opts.crossfade = parseFloat(args[++i]);
        break;
      case "--fade-out":
        opts.fadeOut = parseFloat(args[++i]);
        break;
      case "--output-dir":
        opts.outputDir = args[++i];
        break;
      case "--in-place":
        opts.inPlace = true;
        break;
      case "--versions":
        opts.versions = args[++i].split(",").map((v) => v.trim());
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--quality":
        opts.quality = parseInt(args[++i], 10);
        break;
      case "--zero-cross-window":
        opts.zeroCrossWindow = parseFloat(args[++i]);
        break;
      case "--phase-window":
        opts.phaseWindow = parseFloat(args[++i]);
        break;
      default:
        if (!a.startsWith("--")) opts.folderPath = a;
    }
  }

  return opts;
}

function printUsage() {
  console.error(
    [
      "",
      col(C.bold, "Usage:"),
      "  node scripts/extend-samples.mjs <samples-folder> [options]",
      "",
      col(C.bold, "Arguments:"),
      "  <samples-folder>          Path to the instrument folder (e.g. public/samples/recorder)",
      "",
      col(C.bold, "Options:"),
      "  --min-duration <s>        Minimum output duration in seconds        (default: 8)",
      "  --attack-ratio <0-1>      Fraction of duration to treat as attack   (default: 0.15)",
      "  --release-ratio <0-1>     Fraction of duration to treat as release  (default: 0.20)",
      "  --crossfade <s>           Crossfade at each loop boundary, seconds  (default: 0.05)",
      "  --fade-out <s>            Fade-out applied to the tail              (default: 1.5)",
      "  --output-dir <path>       Write extended files here                 (default: <folder>-extended)",
      "  --in-place                Overwrite original files  ⚠ use with caution",
      "  --versions <v1,v2,...>    Only process these versions (comma-separated)",
      "  --dry-run                 Preview actions without writing any audio",
      "  --quality <0-9>           MP3 VBR quality for output               (default: 2)",
      "  --zero-cross-window <s>   Search window for zero-crossing snapping  (default: 0.08)",
      "  --phase-window <s>        Search window for phase-matched loop-end   (default: 0.04)",
      "",
    ].join("\n"),
  );
}

// ─── Pre-flight checks ────────────────────────────────────────────────────────

function requireTool(name) {
  const r = spawnSync(name, ["-version"], { encoding: "utf8" });
  if (r.error) {
    console.error(
      col(C.red, `✖  ${name} not found on PATH. Please install ffmpeg.`),
    );
    process.exit(1);
  }
}

// ─── Audio info ───────────────────────────────────────────────────────────────

/**
 * Returns the duration of an audio file in seconds via ffprobe, or null.
 */
function getDuration(filePath) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", filePath],
    { encoding: "utf8" },
  );

  if (r.error || r.status !== 0) return null;

  try {
    const info = JSON.parse(r.stdout);
    const dur = parseFloat(info?.format?.duration);
    return Number.isFinite(dur) ? dur : null;
  } catch {
    return null;
  }
}

// ─── Waveform decoding ────────────────────────────────────────────────────────

/**
 * Decodes an audio file to a mono Float32Array at the given sample rate.
 * Returns null on failure.
 * Suitable for zero-crossing analysis – does NOT produce the output audio.
 *
 * @param {string} filePath  – any ffmpeg-supported format (WAV is fastest)
 * @param {number} sampleRate
 * @returns {Float32Array|null}
 */
function decodeToMono(filePath, sampleRate = 44100) {
  const r = spawnSync(
    "ffmpeg",
    [
      "-i",
      filePath,
      "-f",
      "f32le",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "pipe:1",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 300 * 1024 * 1024, // 300 MB – plenty for a few-second clip
    },
  );

  if (!r.stdout || r.stdout.length === 0) return null;

  const buf = r.stdout;
  // Node Buffer shares the underlying ArrayBuffer; slice to own it cleanly.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

// ─── Zero-crossing detection ──────────────────────────────────────────────────

/**
 * Finds the nearest upward zero crossing (negative→positive) to targetTime
 * within a search window of ±windowSec/2.
 *
 * Falls back to any zero crossing if no upward one is found, and then falls
 * back to targetTime itself if nothing is found at all.
 *
 * @param {Float32Array} samples
 * @param {number}       sampleRate
 * @param {number}       targetTime  seconds
 * @param {number}       windowSec   total search window size in seconds
 * @returns {number}  refined time in seconds
 */
function findZeroCrossing(samples, sampleRate, targetTime, windowSec = 0.08) {
  const targetIdx = Math.round(targetTime * sampleRate);
  const halfWindow = Math.round((windowSec / 2) * sampleRate);
  const start = Math.max(0, targetIdx - halfWindow);
  const end = Math.min(samples.length - 2, targetIdx + halfWindow);

  let bestUpIdx = -1,
    bestUpDist = Infinity;
  let bestAnyIdx = -1,
    bestAnyDist = Infinity;

  for (let i = start; i <= end; i++) {
    const isUpward = samples[i] <= 0 && samples[i + 1] > 0;
    const isDown = samples[i] >= 0 && samples[i + 1] < 0;
    const isCross = isUpward || isDown;

    if (!isCross) continue;

    const dist = Math.abs(i - targetIdx);

    if (isUpward && dist < bestUpDist) {
      bestUpDist = dist;
      bestUpIdx = i;
    }
    if (dist < bestAnyDist) {
      bestAnyDist = dist;
      bestAnyIdx = i;
    }
  }

  if (bestUpIdx >= 0) return bestUpIdx / sampleRate;
  if (bestAnyIdx >= 0) return bestAnyIdx / sampleRate;
  return targetTime; // no crossing found – use the raw estimate
}

// ─── Phase-matched loop-end detection ────────────────────────────────────────

/**
 * Finds a refined loop-end time near `targetEnd` where the *tail* of the body
 * waveform phase-matches the *head* of the body waveform (at `loopStart`).
 *
 * During the acrossfade crossfade the filter mixes:
 *   body1[ loopEnd-D … loopEnd ]    (fading out)
 *   body2[ loopStart … loopStart+D ](fading in)
 *
 * If those two windows are in phase they add constructively → smooth sustain.
 * If they are anti-phase they cancel → the audible volume dip the user hears.
 *
 * We search a ±searchWindowSec window around targetEnd for the candidate
 * `candEnd` where samples[ candEnd-W … candEnd ] has the highest normalised
 * cross-correlation with samples[ loopStart … loopStart+W ].
 *
 * @param {Float32Array} samples
 * @param {number}       sampleRate
 * @param {number}       loopStart          seconds – finalized loop start
 * @param {number}       targetEnd          seconds – ratio-based ideal loop end
 * @param {number}       searchWindowSec    ±seconds to scan (default 0.04)
 * @param {number}       analysisWindowSec  comparison window length (default 0.02)
 * @returns {number}  refined loop-end in seconds
 */
function findPhaseMatchedLoopEnd(
  samples,
  sampleRate,
  loopStart,
  targetEnd,
  searchWindowSec = 0.04,
  analysisWindowSec = 0.02,
) {
  const winLen = Math.round(analysisWindowSec * sampleRate);
  const startIdx = Math.round(loopStart * sampleRate);
  const targetIdx = Math.round(targetEnd * sampleRate);
  const halfSearch = Math.round(searchWindowSec * sampleRate);

  // Pre-compute sum-of-squares for the reference window at loopStart.
  if (startIdx + winLen >= samples.length) return targetEnd;

  let refSumSq = 0;
  for (let j = 0; j < winLen; j++) {
    refSumSq += samples[startIdx + j] ** 2;
  }
  if (refSumSq < 1e-12) return targetEnd; // near-silence, bail out

  // Search for candEnd such that:
  //   samples[ candEnd-winLen … candEnd ]  ≈  samples[ startIdx … startIdx+winLen ]
  const minEnd = Math.max(startIdx + winLen * 2, targetIdx - halfSearch);
  const maxEnd = Math.min(samples.length - 1, targetIdx + halfSearch);

  let bestCorr = -Infinity;
  let bestIdx = targetIdx;

  for (let candEnd = minEnd; candEnd <= maxEnd; candEnd++) {
    const candStart = candEnd - winLen;
    if (candStart < 0) continue;

    let crossSum = 0;
    let candSumSq = 0;
    for (let j = 0; j < winLen; j++) {
      const ref = samples[startIdx + j];
      const cand = samples[candStart + j];
      crossSum += ref * cand;
      candSumSq += cand * cand;
    }

    // Normalised cross-correlation (audio is AC so mean ≈ 0)
    const normCorr = crossSum / (Math.sqrt(refSumSq * candSumSq) + 1e-10);
    if (normCorr > bestCorr) {
      bestCorr = normCorr;
      bestIdx = candEnd;
    }
  }

  return bestIdx / sampleRate;
}

// ─── Loop point detection ─────────────────────────────────────────────────────

/**
 * Determines loop start and end times for a sample.
 *
 * Strategy:
 *   - loopStart: snapped to the nearest upward zero-crossing near
 *                attackRatio × duration.
 *   - loopEnd:   phase-matched to loopStart via cross-correlation, searched
 *                near (1 − releaseRatio) × duration.  This ensures the
 *                waveform tail of the body is in the same phase as its head,
 *                so the acrossfade blend is constructive rather than cancelling.
 *
 * Falls back gracefully if waveform decoding fails.
 *
 * @param {string} wavPath
 * @param {number} duration
 * @param {number} attackRatio
 * @param {number} releaseRatio
 * @param {number} zeroCrossWindow  search window for zero-crossing (loopStart)
 * @param {number} phaseWindow      search window for phase-matching (loopEnd)
 * @returns {{ loopStart: number, loopEnd: number }}
 */
function findLoopPoints(
  wavPath,
  duration,
  attackRatio,
  releaseRatio,
  zeroCrossWindow,
  phaseWindow = 0.04,
) {
  const ANALYSIS_SR = 44100;
  const rawLoopStart = duration * attackRatio;
  const rawLoopEnd = duration * (1 - releaseRatio);

  const samples = decodeToMono(wavPath, ANALYSIS_SR);

  if (!samples || samples.length === 0) {
    // Graceful fallback: no waveform available
    return { loopStart: rawLoopStart, loopEnd: rawLoopEnd };
  }

  // loopStart: snap to nearest upward zero-crossing for a clean body entry
  const loopStart = findZeroCrossing(
    samples,
    ANALYSIS_SR,
    rawLoopStart,
    zeroCrossWindow,
  );

  // loopEnd: phase-match the body tail to the body head so the acrossfade
  // crossfade region is constructive (same phase) rather than cancelling.
  const loopEnd = findPhaseMatchedLoopEnd(
    samples,
    ANALYSIS_SR,
    loopStart,
    rawLoopEnd,
    phaseWindow,
  );

  return { loopStart, loopEnd };
}

// ─── Segment extraction ───────────────────────────────────────────────────────

/**
 * Extracts a time slice from an audio file to a lossless PCM WAV.
 *
 * Using `startTime` placed *after* `-i` gives FFmpeg frame-accurate (slow-seek)
 * behaviour – necessary for correctness; our clips are short so the cost is
 * negligible.
 *
 * @param {string}      inputPath
 * @param {number|null} startTime  – null or ≤ 0 means "from beginning"
 * @param {number|null} endTime    – null means "to end"; else start + duration
 * @param {string}      outputPath – must end in .wav
 * @returns {boolean}
 */
function extractSegment(inputPath, startTime, endTime, outputPath) {
  const args = ["-y", "-i", inputPath];

  const hasStart = startTime != null && startTime > 0.001;

  if (hasStart) {
    args.push("-ss", startTime.toFixed(6));
    if (endTime != null) {
      // -t (duration) is relative to the seek point and is accurate
      args.push("-t", (endTime - startTime).toFixed(6));
    }
  } else if (endTime != null) {
    // No seek – just trim from the start
    args.push("-t", endTime.toFixed(6));
  }

  // Output as lossless 16-bit PCM WAV
  args.push("-acodec", "pcm_s16le", outputPath);

  const r = spawnSync("ffmpeg", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return r.status === 0;
}

// ─── FFmpeg filtergraph builder ───────────────────────────────────────────────

/**
 * Builds the FFmpeg -filter_complex string for:
 *   [0]=attack  +  [1..N]=body (N copies)  +  [N+1]=release
 *
 * Body copies are chained with `acrossfade` (crossfade between each pair).
 * The attack→body and body→release junctions are stitched with `concat`
 * (they are already sample-continuous, having been cut at the same loop
 * boundary, so no crossfade is needed at those edges).
 *
 * The assembled stream is then:
 *   • atrim  → clamped to targetDuration
 *   • afade  → fade-out over the last fadeOut seconds
 *
 * @param {number} numBodyCopies
 * @param {number} crossfade       seconds
 * @param {number} targetDuration  seconds
 * @param {number} fadeOut         seconds
 * @returns {string}
 */
function buildFiltergraph(numBodyCopies, crossfade, targetDuration, fadeOut) {
  const parts = [];
  const releaseIdx = numBodyCopies + 1; // input index of release.wav
  const fadeStart = Math.max(0, targetDuration - fadeOut);
  const xfStr = crossfade.toFixed(6);

  // ── Chain body copies with acrossfade ────────────────────────────────────
  // Input indices:  0=attack, 1..N=body copies, N+1=release
  let bodyChainLabel;

  if (numBodyCopies === 1) {
    // Single body copy – no crossfade needed, use input [1] directly
    bodyChainLabel = "1";
  } else {
    let prevLabel = "1";
    for (let i = 1; i < numBodyCopies; i++) {
      const inputIdx = i + 1; // body copy i+1 is at input index i+1
      const outLabel = i === numBodyCopies - 1 ? "bodies" : `bc${i}`;
      parts.push(
        `[${prevLabel}][${inputIdx}]acrossfade=d=${xfStr}:c1=qsin:c2=qsin[${outLabel}]`,
      );
      prevLabel = outLabel;
    }
    bodyChainLabel = "bodies";
  }

  // ── Concat: attack + chained bodies + release ─────────────────────────────
  parts.push(
    `[0][${bodyChainLabel}][${releaseIdx}]concat=n=3:v=0:a=1[concatted]`,
  );

  // ── Trim to target duration ───────────────────────────────────────────────
  parts.push(`[concatted]atrim=0:${targetDuration.toFixed(6)}[trimmed]`);

  // ── Fade out at the tail ──────────────────────────────────────────────────
  parts.push(
    `[trimmed]afade=t=out:st=${fadeStart.toFixed(6)}:d=${fadeOut.toFixed(6)}[out]`,
  );

  return parts.join(";");
}

// ─── Codec args ───────────────────────────────────────────────────────────────

function codecArgsFor(ext, quality) {
  switch (ext.toLowerCase()) {
    case ".mp3":
      return ["-codec:a", "libmp3lame", "-q:a", String(quality)];
    case ".ogg":
      return ["-codec:a", "libvorbis", "-q:a", "5"];
    case ".flac":
      return ["-codec:a", "flac"];
    case ".m4a":
      return ["-codec:a", "aac", "-b:a", "192k"];
    case ".aiff":
      return ["-codec:a", "pcm_s16be"];
    case ".wav":
    default:
      return ["-codec:a", "pcm_s16le"];
  }
}

// ─── Core: extend one sample ──────────────────────────────────────────────────

/**
 * Processes a single audio file, extending it to at least minDuration seconds.
 *
 * @returns {{ status: 'ok'|'skipped'|'dry-run'|'error', ... }}
 */
async function extendSample(inputPath, outputPath, opts) {
  const {
    minDuration,
    attackRatio,
    releaseRatio,
    crossfade,
    fadeOut,
    quality,
    dryRun,
    zeroCrossWindow,
    phaseWindow,
  } = opts;

  // ── 1. Get duration ──────────────────────────────────────────────────────
  const duration = getDuration(inputPath);

  if (duration == null) {
    return {
      status: "error",
      reason: "Could not read duration (ffprobe failed)",
    };
  }

  if (duration >= minDuration) {
    return {
      status: "skipped",
      reason: `already ${duration.toFixed(2)}s ≥ ${minDuration}s`,
    };
  }

  // ── 2. Find loop points via zero-crossing analysis ───────────────────────
  // We'll decode to a temp WAV first for sample-accurate extraction later.
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "extend-sample-"));

  try {
    const decodedWav = path.join(tmpDir, "decoded.wav");

    // Decode source to lossless WAV – fixes MP3 encoder-delay offsets and
    // makes all subsequent segment extractions frame-accurate.
    const decodeResult = spawnSync(
      "ffmpeg",
      ["-y", "-i", inputPath, "-acodec", "pcm_s16le", decodedWav],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

    if (decodeResult.status !== 0) {
      return { status: "error", reason: "Failed to decode source to WAV" };
    }

    // Analyse waveform to snap loop boundaries to zero crossings
    let { loopStart, loopEnd } = findLoopPoints(
      decodedWav,
      duration,
      attackRatio,
      releaseRatio,
      zeroCrossWindow,
      phaseWindow,
    );

    // Safety clamps: ensure at least 50 ms from edges and a sane body size
    const MIN_EDGE = 0.05;
    loopStart = Math.max(MIN_EDGE, Math.min(loopStart, duration - MIN_EDGE));
    loopEnd = Math.max(
      loopStart + MIN_EDGE * 2,
      Math.min(loopEnd, duration - MIN_EDGE),
    );

    const bodyDuration = loopEnd - loopStart;

    // Body must be longer than the crossfade (both sides) so acrossfade works
    if (bodyDuration <= crossfade * 2) {
      return {
        status: "error",
        reason:
          `Body too short (${bodyDuration.toFixed(3)}s) for crossfade (${crossfade}s). ` +
          `Try --crossfade with a smaller value or --attack-ratio / --release-ratio.`,
      };
    }

    // ── 3. Calculate number of body copies needed ─────────────────────────
    // After N copies the assembled duration (before trim) is:
    //   duration + (N - 1) × (bodyDuration - crossfade)
    // We need this ≥ minDuration, so:
    //   N ≥ 1 + (minDuration - duration) / (bodyDuration - crossfade)
    const effectiveBodyDur = bodyDuration - crossfade;
    const numBodyCopies = Math.max(
      1,
      Math.ceil(1 + (minDuration - duration) / effectiveBodyDur),
    );
    const estimatedDuration = duration + (numBodyCopies - 1) * effectiveBodyDur;

    process.stdout.write(
      col(
        C.grey,
        `\n      loop: ${loopStart.toFixed(3)}s – ${loopEnd.toFixed(3)}s` +
          ` (body=${bodyDuration.toFixed(3)}s, ×${numBodyCopies} copies` +
          ` → ~${estimatedDuration.toFixed(2)}s)`,
      ),
    );

    if (dryRun) {
      return {
        status: "dry-run",
        estimatedDuration,
        numBodyCopies,
        inputDuration: duration,
      };
    }

    // ── 4. Extract segments ───────────────────────────────────────────────
    const attackPath = path.join(tmpDir, "attack.wav");
    const bodyPath = path.join(tmpDir, "body.wav");
    const releasePath = path.join(tmpDir, "release.wav");

    // attack: 0 → loopStart
    if (!extractSegment(decodedWav, null, loopStart, attackPath)) {
      return { status: "error", reason: "Failed to extract attack segment" };
    }

    // body: loopStart → loopEnd
    if (!extractSegment(decodedWav, loopStart, loopEnd, bodyPath)) {
      return {
        status: "error",
        reason: "Failed to extract body (loop) segment",
      };
    }

    // release: loopEnd → end
    if (!extractSegment(decodedWav, loopEnd, null, releasePath)) {
      return { status: "error", reason: "Failed to extract release segment" };
    }

    // ── 5. Build FFmpeg command ───────────────────────────────────────────
    const filtergraph = buildFiltergraph(
      numBodyCopies,
      crossfade,
      minDuration,
      fadeOut,
    );

    const ffmpegArgs = ["-y"];

    // Inputs: [0]=attack, [1..N]=body (N identical references), [N+1]=release
    ffmpegArgs.push("-i", attackPath);
    for (let i = 0; i < numBodyCopies; i++) {
      ffmpegArgs.push("-i", bodyPath);
    }
    ffmpegArgs.push("-i", releasePath);

    ffmpegArgs.push("-filter_complex", filtergraph);
    ffmpegArgs.push("-map", "[out]");

    // Output codec determined by extension
    const ext =
      path.extname(outputPath).toLowerCase() ||
      path.extname(inputPath).toLowerCase();
    ffmpegArgs.push(...codecArgsFor(ext, quality));

    // If writing in-place, encode to a temp file first then move
    const writingInPlace = path.resolve(outputPath) === path.resolve(inputPath);
    const encodeTarget = writingInPlace
      ? path.join(tmpDir, `out${ext}`)
      : outputPath;

    ffmpegArgs.push(encodeTarget);

    // Ensure the output directory exists
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });

    // ── 6. Run FFmpeg ─────────────────────────────────────────────────────
    const r = spawnSync("ffmpeg", ffmpegArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (r.status !== 0) {
      // Surface the last few hundred bytes of stderr for diagnosis
      const errSnippet = (r.stderr || "").split("\n").slice(-12).join("\n");
      process.stdout.write("\n");
      console.error(col(C.red, "      FFmpeg error:"));
      console.error(col(C.grey, errSnippet));
      return { status: "error", reason: "FFmpeg encoding failed" };
    }

    // Move temp file over original when writing in-place
    if (writingInPlace) {
      await fsp.copyFile(encodeTarget, outputPath);
    }

    // Verify output
    const outDuration = getDuration(outputPath);

    return {
      status: "ok",
      inputDuration: duration,
      outputDuration: outDuration,
      numBodyCopies,
    };
  } finally {
    // Always clean up temp dir
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// ─── Folder scanner ───────────────────────────────────────────────────────────

async function processSamplesFolder(folderPath, opts) {
  // ── Read root index.json ─────────────────────────────────────────────────
  const rootIndexPath = path.join(folderPath, "index.json");
  let rootIndex;

  try {
    rootIndex = JSON.parse(await fsp.readFile(rootIndexPath, "utf8"));
  } catch (err) {
    console.error(
      col(C.red, `✖  Cannot read ${rootIndexPath}: ${err.message}`),
    );
    process.exit(1);
  }

  const allVersions = rootIndex.versions;
  if (!Array.isArray(allVersions) || allVersions.length === 0) {
    console.error(
      col(C.red, `✖  No "versions" array found in ${rootIndexPath}`),
    );
    process.exit(1);
  }

  // Filter versions if --versions was supplied
  const versions = opts.versions
    ? opts.versions.filter((v) => {
        const ok = allVersions.includes(v);
        if (!ok)
          console.warn(col(C.yellow, `  ⚠  Unknown version "${v}" (skipped)`));
        return ok;
      })
    : allVersions;

  if (versions.length === 0) {
    console.error(
      col(
        C.yellow,
        `⚠  No matching versions. Available: ${allVersions.join(", ")}`,
      ),
    );
    process.exit(0);
  }

  // ── Determine output base directory ─────────────────────────────────────
  let outputBase;
  if (opts.inPlace) {
    outputBase = folderPath;
  } else if (opts.outputDir) {
    outputBase = path.resolve(opts.outputDir);
  } else {
    // Default: <folder>-extended   e.g. public/samples/recorder-extended
    outputBase = folderPath.replace(/\/+$/, "") + "-extended";
  }

  // ── Summary header ───────────────────────────────────────────────────────
  console.log("");
  console.log(
    col(C.bold, "extend-samples") + col(C.grey, " – sample extender"),
  );
  console.log(col(C.grey, "─".repeat(60)));
  console.log(`  Folder:       ${folderPath}`);
  console.log(`  Versions:     ${versions.join(", ")}`);
  console.log(`  Min duration: ${opts.minDuration}s`);
  console.log(
    `  Loop method:  zero-crossing  (window ±${((opts.zeroCrossWindow / 2) * 1000).toFixed(0)} ms)`,
  );
  console.log(
    `  Crossfade:    ${(opts.crossfade * 1000).toFixed(0)} ms  (equal-power qsin)`,
  );
  console.log(
    `  Phase window: ±${(opts.phaseWindow * 1000).toFixed(0)} ms  (loop-end matching)`,
  );
  console.log(`  Fade-out:     ${opts.fadeOut}s`);
  if (opts.inPlace) {
    console.log(
      col(C.yellow, "  Mode:         IN-PLACE (originals will be overwritten)"),
    );
  } else {
    console.log(`  Output dir:   ${outputBase}`);
  }
  if (opts.dryRun) {
    console.log(col(C.yellow, "  ⚠  DRY RUN – no files will be written"));
  }
  console.log(col(C.grey, "─".repeat(60)));

  // ── Process each version ─────────────────────────────────────────────────
  let totalOk = 0,
    totalSkipped = 0,
    totalErrors = 0;

  for (const version of versions) {
    const versionDir = path.join(folderPath, version);
    const versionIndexPath = path.join(versionDir, "index.json");

    console.log("");
    console.log(col(C.bold, `Version: ${version}`));

    // Read version index
    let versionIndex;
    try {
      versionIndex = JSON.parse(await fsp.readFile(versionIndexPath, "utf8"));
    } catch (err) {
      console.log(
        col(
          C.yellow,
          `  ⚠  Skipping: cannot read ${versionIndexPath}: ${err.message}`,
        ),
      );
      continue;
    }

    const notes = Object.entries(versionIndex); // [ [note, filename], … ]
    console.log(col(C.grey, `  ${notes.length} notes found`));

    // Copy index.json to output dir if not in-place
    if (!opts.inPlace && !opts.dryRun) {
      const outVersionDir = path.join(outputBase, version);
      await fsp.mkdir(outVersionDir, { recursive: true });
      await fsp.copyFile(
        versionIndexPath,
        path.join(outVersionDir, "index.json"),
      );
    }

    for (const [note, filename] of notes) {
      const inputPath = path.join(versionDir, filename);

      // Verify file exists
      if (!fs.existsSync(inputPath)) {
        console.log(
          `  ${col(C.yellow, "?")}  ${note.padEnd(4)} ${filename}` +
            col(C.grey, " (file not found, skipping)"),
        );
        totalErrors++;
        continue;
      }

      // Determine output path
      const outputPath = opts.inPlace
        ? inputPath
        : path.join(outputBase, version, filename);

      // Show progress line (will be overwritten with result)
      process.stdout.write(
        `  ${col(C.grey, "…")}  ${note.padEnd(4)} ${col(C.grey, filename)}`,
      );

      const result = await extendSample(inputPath, outputPath, opts);

      // Clear the progress line and print result
      const clearLine = "\r" + " ".repeat(100) + "\r";

      switch (result.status) {
        case "skipped":
          process.stdout.write(
            `${clearLine}  ${col(C.grey, "–")}  ${note.padEnd(4)} ` +
              `${col(C.grey, filename)}  ${col(C.grey, result.reason)}\n`,
          );
          totalSkipped++;
          break;

        case "ok":
          process.stdout.write(
            `${clearLine}  ${col(C.green, "✔")}  ${note.padEnd(4)} ` +
              `${col(C.grey, filename)}  ` +
              col(
                C.grey,
                `${result.inputDuration?.toFixed(2)}s → ` +
                  `${result.outputDuration?.toFixed(2)}s  ` +
                  `(×${result.numBodyCopies} body loops)`,
              ) +
              "\n",
          );
          totalOk++;
          break;

        case "dry-run":
          process.stdout.write(
            `${clearLine}  ${col(C.cyan, "~")}  ${note.padEnd(4)} ` +
              `${col(C.grey, filename)}  ` +
              col(
                C.cyan,
                `would extend to ~${result.estimatedDuration?.toFixed(2)}s` +
                  ` (×${result.numBodyCopies} body loops)`,
              ) +
              "\n",
          );
          totalOk++;
          break;

        case "error":
          process.stdout.write(
            `${clearLine}  ${col(C.red, "✖")}  ${note.padEnd(4)} ` +
              `${col(C.grey, filename)}  ` +
              col(C.red, result.reason) +
              "\n",
          );
          totalErrors++;
          break;
      }
    }
  }

  // ── Copy root index.json to output dir ───────────────────────────────────
  if (!opts.inPlace && !opts.dryRun) {
    try {
      await fsp.copyFile(rootIndexPath, path.join(outputBase, "index.json"));
    } catch {
      /* non-fatal */
    }
  }

  // ── Final summary ────────────────────────────────────────────────────────
  console.log("");
  console.log(col(C.grey, "─".repeat(60)));
  console.log(
    `  ${col(C.green, `✔  ${totalOk} extended`)}` +
      `  ${col(C.grey, `–  ${totalSkipped} skipped`)}` +
      (totalErrors > 0 ? `  ${col(C.red, `✖  ${totalErrors} errors`)}` : ""),
  );
  if (!opts.inPlace && !opts.dryRun) {
    console.log(`  Output: ${outputBase}`);
  }
  console.log("");
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.folderPath) {
    printUsage();
    process.exit(1);
  }

  // Validate numeric options
  if (opts.minDuration <= 0) {
    console.error(col(C.red, "✖  --min-duration must be > 0"));
    process.exit(1);
  }
  if (opts.attackRatio <= 0 || opts.attackRatio >= 1) {
    console.error(col(C.red, "✖  --attack-ratio must be between 0 and 1"));
    process.exit(1);
  }
  if (opts.releaseRatio <= 0 || opts.releaseRatio >= 1) {
    console.error(col(C.red, "✖  --release-ratio must be between 0 and 1"));
    process.exit(1);
  }
  if (opts.attackRatio + opts.releaseRatio >= 1) {
    console.error(
      col(C.red, "✖  --attack-ratio + --release-ratio must be < 1"),
    );
    process.exit(1);
  }
  if (opts.crossfade <= 0) {
    console.error(col(C.red, "✖  --crossfade must be > 0"));
    process.exit(1);
  }

  requireTool("ffmpeg");
  requireTool("ffprobe");

  const folderPath = path.resolve(opts.folderPath);

  if (!fs.existsSync(folderPath)) {
    console.error(col(C.red, `✖  Folder not found: ${folderPath}`));
    process.exit(1);
  }

  await processSamplesFolder(folderPath, opts);
}

main().catch((err) => {
  console.error(col(C.red, `\n✖  Unhandled error: ${err.message}`));
  console.error(col(C.grey, err.stack));
  process.exit(1);
});
