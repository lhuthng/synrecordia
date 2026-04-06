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
      "  --crossfade <s>           Loop crossfade duration; also sets phase-analysis window  (default: 0.05)",
      "  --fade-out <s>            Fade-out applied to the tail              (default: 1.5)",
      "  --output-dir <path>       Write extended files here                 (default: <folder>-extended)",
      "  --in-place                Overwrite original files  ⚠ use with caution",
      "  --versions <v1,v2,...>    Only process these versions (comma-separated)",
      "  --dry-run                 Preview actions without writing any audio",
      "  --quality <0-9>           MP3 VBR quality for output               (default: 2)",
      "  --zero-cross-window <s>   Search window for zero-crossing snapping  (default: 0.08)",
      "  --phase-window <s>        ±Search window for phase-matched loop-end snap  (default: 0.04)",
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

// ─── RMS energy helper ────────────────────────────────────────────────────────

/**
 * Returns the RMS amplitude of a waveform slice.
 * Used to measure how much the body's amplitude has decayed between
 * loopStart and loopEnd so the gain-ramp compensation can equalise them.
 *
 * @param {Float32Array} samples
 * @param {number}       startSec
 * @param {number}       endSec
 * @param {number}       sampleRate
 * @returns {number}
 */
function computeRMS(samples, startSec, endSec, sampleRate) {
  const s = Math.max(0, Math.round(startSec * sampleRate));
  const e = Math.min(samples.length, Math.round(endSec * sampleRate));
  if (e <= s) return 0;
  let sum = 0;
  for (let i = s; i < e; i++) sum += samples[i] ** 2;
  return Math.sqrt(sum / (e - s));
}

// ─── Phase-matched loop-end detection ────────────────────────────────────────

/**
 * Finds a refined loop-end time near `targetEnd` where the TAIL of the body
 * waveform is in phase with — and has a similar amplitude to — the HEAD of
 * the body waveform at `loopStart`.
 *
 * During the acrossfade crossfade the filter mixes:
 *   body_N  [ loopEnd - crossfade … loopEnd ]    (fading out)
 *   body_N+1[ loopStart … loopStart + crossfade ](fading in)
 *
 * The analysis window is set to the FULL crossfade duration (not a short
 * sub-window) so the entire blend region is phase-matched, eliminating the
 * cancellation that causes the audible volume dip.
 *
 * Scoring = 0.7 × normalised_cross_correlation + 0.3 × amplitude_match
 *
 * @param {Float32Array} samples
 * @param {number}       sampleRate
 * @param {number}       loopStart          seconds – finalised loop start
 * @param {number}       targetEnd          seconds – ratio-based ideal loop end
 * @param {number}       searchWindowSec    ±seconds to scan around targetEnd
 * @param {number}       crossfadeSec       crossfade duration (= analysis window)
 * @returns {{ time: number, score: number }}
 */
function findPhaseMatchedLoopEnd(
  samples,
  sampleRate,
  loopStart,
  targetEnd,
  searchWindowSec = 0.04,
  crossfadeSec = 0.05,
) {
  const winLen = Math.round(crossfadeSec * sampleRate);
  const startIdx = Math.round(loopStart * sampleRate);
  const targetIdx = Math.round(targetEnd * sampleRate);
  const halfSearch = Math.round(searchWindowSec * sampleRate);

  if (startIdx + winLen >= samples.length) return { time: targetEnd, score: 0 };

  // Pre-compute reference window statistics (head of body at loopStart)
  let refSumSq = 0;
  for (let j = 0; j < winLen; j++) {
    refSumSq += samples[startIdx + j] ** 2;
  }
  const refRMS = Math.sqrt(refSumSq / winLen);
  if (refSumSq < 1e-12) return { time: targetEnd, score: 0 }; // near-silence

  const minEnd = Math.max(startIdx + winLen * 2, targetIdx - halfSearch);
  const maxEnd = Math.min(samples.length - 1, targetIdx + halfSearch);

  let bestScore = -Infinity;
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

    // Normalised cross-correlation: +1 = perfect in-phase, -1 = anti-phase
    const normCorr = crossSum / (Math.sqrt(refSumSq * candSumSq) + 1e-10);

    // Amplitude match: 1.0 when tail RMS = head RMS, 0.0 when very different
    const candRMS = Math.sqrt(candSumSq / winLen);
    const ampRatio = candRMS / (refRMS + 1e-10);
    const ampScore = 1 - Math.min(1, Math.abs(ampRatio - 1));

    // Combined score: phase is primary, amplitude is secondary
    const score = 0.7 * normCorr + 0.3 * ampScore;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = candEnd;
    }
  }

  return { time: bestIdx / sampleRate, score: bestScore };
}

// ─── Loop point detection ─────────────────────────────────────────────────────

/**
 * Determines loop start and end times for a sample.
 *
 * Accepts a pre-decoded mono Float32Array so the caller can reuse the same
 * buffer for subsequent RMS computation without decoding the file twice.
 *
 * Strategy:
 *   - loopStart: snapped to the nearest upward zero-crossing near
 *                attackRatio × duration.
 *   - loopEnd:   found by searching ±phaseWindow around the ratio-based target,
 *                scored by BOTH phase correlation and amplitude similarity over
 *                a window equal to the crossfade duration.  Using the full
 *                crossfade duration as the analysis window ensures the entire
 *                blend region is in phase, eliminating the cancellation dip.
 *
 * @param {Float32Array|null} samples     pre-decoded mono audio (or null for fallback)
 * @param {number}            sampleRate
 * @param {number}            duration
 * @param {number}            attackRatio
 * @param {number}            releaseRatio
 * @param {number}            zeroCrossWindow  search window for zero-crossing (loopStart)
 * @param {number}            phaseWindow      ±search window for phase matching (loopEnd)
 * @param {number}            crossfade        crossfade duration → analysis window size
 * @returns {{ loopStart: number, loopEnd: number, phaseScore: number|null }}
 */
function findLoopPoints(
  samples,
  sampleRate,
  duration,
  attackRatio,
  releaseRatio,
  zeroCrossWindow,
  phaseWindow = 0.04,
  crossfade = 0.05,
) {
  const rawLoopStart = duration * attackRatio;
  const rawLoopEnd = duration * (1 - releaseRatio);

  if (!samples || samples.length === 0) {
    return { loopStart: rawLoopStart, loopEnd: rawLoopEnd, phaseScore: null };
  }

  // loopStart: snap to nearest upward zero-crossing for a clean body entry
  const loopStart = findZeroCrossing(
    samples,
    sampleRate,
    rawLoopStart,
    zeroCrossWindow,
  );

  // loopEnd: phase-match the body tail to the body head so the acrossfade
  // crossfade region is constructive (same phase) rather than cancelling.
  const { time: loopEnd, score: phaseScore } = findPhaseMatchedLoopEnd(
    samples,
    sampleRate,
    loopStart,
    rawLoopEnd,
    phaseWindow,
    crossfade,
  );

  return { loopStart, loopEnd, phaseScore };
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
 * Each body copy optionally has a gain ramp applied (to compensate for natural
 * amplitude decay across the body segment), then the copies are chained with
 * `acrossfade` using the `tri` (linear) curve.
 *
 * Why `tri` instead of `qsin`?
 *   `qsin` (constant-power) is designed for crossfading *uncorrelated* streams
 *   (e.g. DJ transitions). For a looped body the two signals are highly
 *   correlated: at the crossfade midpoint, `qsin` gives +3 dB when in phase
 *   and heavy cancellation when even slightly anti-phase.
 *   `tri` (linear) gives exactly 0 dB for in-phase correlated audio, which is
 *   what a seamless loop needs.
 *
 * The assembled stream is then:
 *   • atrim  → clamped to targetDuration
 *   • afade  → fade-out over the last fadeOut seconds
 *
 * @param {number} numBodyCopies
 * @param {number} crossfade        seconds
 * @param {number} targetDuration   seconds
 * @param {number} fadeOut          seconds
 * @param {number} bodyGainRamp     end-of-body gain multiplier (1.0 = no ramp)
 * @param {number|null} bodyDuration seconds – required when bodyGainRamp ≠ 1.0
 * @returns {string}
 */
function buildFiltergraph(
  numBodyCopies,
  crossfade,
  targetDuration,
  fadeOut,
  bodyGainRamp = 1.0,
  bodyDuration = null,
) {
  const parts = [];
  const releaseIdx = numBodyCopies + 1; // input index of release.wav
  const fadeStart = Math.max(0, targetDuration - fadeOut);
  const xfStr = crossfade.toFixed(6);

  // ── Optional gain ramp per body copy ────────────────────────────────────
  // A linear ramp from 1.0 → bodyGainRamp equalises the amplitude at both
  // ends of the body before the acrossfade blends them.
  const applyRamp = Math.abs(bodyGainRamp - 1.0) > 0.01 && bodyDuration != null;
  const bodyLabels = [];

  for (let i = 1; i <= numBodyCopies; i++) {
    if (applyRamp) {
      const delta = (bodyGainRamp - 1.0).toFixed(6);
      const durStr = bodyDuration.toFixed(6);
      // volume filter with eval=frame: t is the PTS in seconds (0 at body start)
      parts.push(
        `[${i}]volume=volume='1.0+(${delta})*(t/${durStr})':eval=frame[vb${i}]`,
      );
      bodyLabels.push(`vb${i}`);
    } else {
      bodyLabels.push(String(i));
    }
  }

  // ── Chain body copies with acrossfade (tri curve for correlated loops) ──
  // Input indices:  0=attack, 1..N=body copies, N+1=release
  let bodyChainLabel;

  if (numBodyCopies === 1) {
    // Single body copy – no crossfade needed, use its label directly
    bodyChainLabel = bodyLabels[0];
  } else {
    let prevLabel = bodyLabels[0];
    for (let i = 1; i < numBodyCopies; i++) {
      const outLabel = i === numBodyCopies - 1 ? "bodies" : `bc${i}`;
      parts.push(
        `[${prevLabel}][${bodyLabels[i]}]acrossfade=d=${xfStr}:c1=tri:c2=tri[${outLabel}]`,
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

    // Decode to Float32 for analysis (reused for loop-point detection AND
    // body-RMS computation — avoids decoding the file twice).
    const ANALYSIS_SR = 44100;
    const samples = decodeToMono(decodedWav, ANALYSIS_SR);

    // Analyse waveform to snap loop boundaries to zero crossings and find a
    // phase-matched, amplitude-similar loop end.
    let { loopStart, loopEnd, phaseScore } = findLoopPoints(
      samples,
      ANALYSIS_SR,
      duration,
      attackRatio,
      releaseRatio,
      zeroCrossWindow,
      phaseWindow,
      crossfade,
    );

    // Safety clamps: ensure at least 50 ms from edges and a sane body size
    const MIN_EDGE = 0.05;
    loopStart = Math.max(MIN_EDGE, Math.min(loopStart, duration - MIN_EDGE));
    loopEnd = Math.max(
      loopStart + MIN_EDGE * 2,
      Math.min(loopEnd, duration - MIN_EDGE),
    );

    const bodyDuration = loopEnd - loopStart;

    // ── Body gain ramp: compensate for natural amplitude decay ───────────
    // Measure RMS over the crossfade-sized windows at the start and end of
    // the body.  If the body decays, bodyGainRamp > 1 so the gain ramp
    // brings the tail amplitude back up to match the head before blending.
    let bodyGainRamp = 1.0;
    if (samples) {
      const rmsWindow = Math.min(crossfade, bodyDuration / 4);
      const headRMS = computeRMS(
        samples,
        loopStart,
        loopStart + rmsWindow,
        ANALYSIS_SR,
      );
      const tailRMS = computeRMS(
        samples,
        loopEnd - rmsWindow,
        loopEnd,
        ANALYSIS_SR,
      );
      if (headRMS > 1e-6 && tailRMS > 1e-6) {
        // Clamp to ±6 dB to avoid extreme corrections
        bodyGainRamp = Math.max(0.5, Math.min(2.0, headRMS / tailRMS));
      }
    }

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

    const phaseLabel =
      phaseScore != null ? ` phase=${phaseScore.toFixed(2)}` : "";
    const rampLabel =
      Math.abs(bodyGainRamp - 1.0) > 0.01
        ? ` gain-ramp×${bodyGainRamp.toFixed(2)}`
        : "";
    process.stdout.write(
      col(
        C.grey,
        `\n      loop: ${loopStart.toFixed(3)}s – ${loopEnd.toFixed(3)}s` +
          ` (body=${bodyDuration.toFixed(3)}s, ×${numBodyCopies} copies` +
          ` → ~${estimatedDuration.toFixed(2)}s)` +
          phaseLabel +
          rampLabel,
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
      bodyGainRamp,
      bodyDuration,
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
    `  Crossfade:    ${(opts.crossfade * 1000).toFixed(0)} ms  (linear/tri, phase-matched)`,
  );
  console.log(
    `  Phase window: ±${(opts.phaseWindow * 1000).toFixed(0)} ms  (analysis window = crossfade duration)`,
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
