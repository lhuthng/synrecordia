/**
 * GuitarMapper — DP-based guitar fretboard mapper.
 *
 * Finds the globally-optimal sequence of string/fret assignments for every
 * note in a track using a Viterbi-style forward DP over quantised time-slices.
 *
 * All scoring, candidate generation, and technique-inference logic lives here.
 * The public API is the `GuitarMapper` class and the `mapTrack` convenience
 * function.
 */

import { noteToMidi } from "./theory.js";
import { getOpenMidis } from "./tunings.js";

// ─────────────────────────────────────────────────────────────────────────────
// SCORING PRESETS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All weight/penalty/bonus values for each mode.
 * `leftHandWeight`/`rightHandWeight` in the preset are the defaults;
 * constructor options override them when non-null.
 */
const PRESETS = {
  balanced: {
    leftHandWeight:       0.5,
    rightHandWeight:      0.5,
    fretSpanPenalty:     15,
    movementPenalty:      3,
    stringSwitchPenalty:  1,
    barreBonus:           5,
    sweetSpotLow:         0,
    sweetSpotHigh:       12,
    sweetSpotBonus:       2,
    highFretPenalty:      2,
    lowStringHighFretMult: 2,
    openStringBonus:      3,
    stringGapPenalty:     2,
    rightHandJumpPenalty: 1.5,
    letRingBonus:         4,
    mutePenalty:          3,
    prePositionBonus:     2,
    legatoThreshold:      0.5,
  },
  comfort: {
    leftHandWeight:       0.8,
    rightHandWeight:      0.3,
    fretSpanPenalty:     20,
    movementPenalty:      5,
    stringSwitchPenalty:  1,
    barreBonus:           5,
    sweetSpotLow:         0,
    sweetSpotHigh:       12,
    sweetSpotBonus:       2,
    highFretPenalty:      2,
    lowStringHighFretMult: 2,
    openStringBonus:      3,
    stringGapPenalty:     2,
    rightHandJumpPenalty: 1.5,
    letRingBonus:         2,
    mutePenalty:          1.5,
    prePositionBonus:     2,
    legatoThreshold:      0.5,
  },
  sustain: {
    leftHandWeight:       0.3,
    rightHandWeight:      0.8,
    fretSpanPenalty:     10,
    movementPenalty:      1.5,
    stringSwitchPenalty:  1,
    barreBonus:           5,
    sweetSpotLow:         0,
    sweetSpotHigh:       12,
    sweetSpotBonus:       2,
    highFretPenalty:      2,
    lowStringHighFretMult: 2,
    openStringBonus:      6,
    stringGapPenalty:     3,
    rightHandJumpPenalty: 1.5,
    letRingBonus:         8,
    mutePenalty:          6,
    prePositionBonus:     4,
    legatoThreshold:      0.5,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE — FRETBOARD BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a Map from MIDI pitch → Array<{string, fret}> for the given tuning.
 * String indices are 0-based internally (0 = highest-pitched string).
 * Capo shifts the open-string pitches up and reduces available fret count.
 *
 * @param {number[]} openMidis  MIDI pitch of each open string (index 0 = highest).
 * @param {number}   maxFret    Highest fret to include.
 * @param {number}   capo       Capo fret position.
 * @returns {Map<number, {string:number, fret:number}[]>}
 */
function buildPitchMap(openMidis, maxFret, capo = 0) {
  const map = new Map();
  for (let s = 0; s < openMidis.length; s++) {
    const capoBase = openMidis[s] + capo;
    for (let f = 0; f <= maxFret - capo; f++) {
      const pitch = capoBase + f;
      if (!map.has(pitch)) map.set(pitch, []);
      map.get(pitch).push({ string: s, fret: f });
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE — ACTION PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a raw actions array into an ordered array of time-slices.
 *
 *
 * Each action may carry a single `pitch` or a `pitches` array (chords).
 * Notes within the same quantised beat window are merged into one slice.
 * Duplicate pitches within a slice are deduplicated (first occurrence wins).
 *
 * @param {object[]} actions   Raw actions array from a song track.
 * @param {number}   quantRes  Quantisation grid in beats (e.g. 0.125).
 * @returns {{ time:number, notes:{ pitch:number, noteName:string, duration:number, velocity:number }[] }[]}
 */
function parseActions(actions, quantRes = 0.125) {
  const quantize = (t) => Math.round(t / quantRes) * quantRes;
  const sliceMap = new Map();

  for (const action of actions) {
    if (action.type !== "note") continue;

    const rawPitches = action.pitches
      ? action.pitches
      : action.pitch != null
        ? [action.pitch]
        : [];

    for (const raw of rawPitches) {
      const midi = noteToMidi(String(raw));
      const qt   = quantize(action.time);
      const key  = qt.toFixed(6);

      if (!sliceMap.has(key)) sliceMap.set(key, { time: qt, notes: [] });
      sliceMap.get(key).notes.push({
        pitch:    midi,
        noteName: String(raw),
        duration: action.duration,
        velocity: action.velocity,
      });
    }
  }

  // Deduplicate pitches within each slice (keep first occurrence)
  for (const slice of sliceMap.values()) {
    const seen = new Set();
    slice.notes = slice.notes.filter((n) => {
      if (seen.has(n.pitch)) return false;
      seen.add(n.pitch);
      return true;
    });
  }

  return [...sliceMap.values()].sort((a, b) => a.time - b.time);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE — CANDIDATE GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate every valid fingering for a slice using backtracking with pruning.
 *
 * A "fingering" is an Array<{string, fret}> aligned 1-to-1 with slice.notes.
 *
 * Hard constraints (enforced during generation, not post-filtered):
 *   • No two notes may use the same string.
 *   • The span between the lowest and highest fretted (non-open) notes must
 *     not exceed cfg.maxHandSpan.
 *
 * @param {{ time:number, notes:object[] }} slice
 * @param {Map}    pitchMap
 * @param {object} cfg
 * @returns {{string:number, fret:number}[][]}
 */
function generateCandidates(slice, pitchMap, cfg) {
  const posOptions = slice.notes.map((n) => pitchMap.get(n.pitch) ?? []);

  // Any note with zero available positions → slice is unplayable under this tuning
  if (posOptions.some((opts) => opts.length === 0)) return [];

  const candidates = [];

  function bt(idx, partial) {
    if (idx === posOptions.length) {
      candidates.push(partial.slice());
      return;
    }

    for (const pos of posOptions[idx]) {
      // Constraint: unique string
      if (partial.some((p) => p.string === pos.string)) continue;

      // Constraint: fret span (fretted notes only)
      if (pos.fret > 0) {
        const frettedSoFar = partial.filter((p) => p.fret > 0).map((p) => p.fret);
        if (frettedSoFar.length > 0) {
          const lo = Math.min(...frettedSoFar, pos.fret);
          const hi = Math.max(...frettedSoFar, pos.fret);
          if (hi - lo > cfg.maxHandSpan) continue;
        }
      }

      partial.push(pos);
      bt(idx + 1, partial);
      partial.pop();
    }
  }

  bt(0, []);
  return candidates;
}

/**
 * Try cfg.maxHandSpan first; if it yields nothing, retry with a relaxed span
 * (+4 extra frets).  Handles wide voicings that are stretchy but playable.
 *
 * @param {{ time:number, notes:object[] }} slice
 * @param {Map}    pitchMap
 * @param {object} cfg
 * @returns {{string:number, fret:number}[][]}
 */
function generateCandidatesFallback(slice, pitchMap, cfg) {
  let cands = generateCandidates(slice, pitchMap, cfg);
  if (cands.length === 0) {
    cands = generateCandidates(slice, pitchMap, { ...cfg, maxHandSpan: cfg.maxHandSpan + 4 });
    if (cands.length > 0) {
      console.warn(
        `  ⚠  t=${slice.time.toFixed(3)}: relaxed hand span ` +
        `to fit [${slice.notes.map((n) => n.noteName).join(", ")}]`,
      );
    }
  }
  return cands;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE — SCORING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Intrinsic (context-free) score for a single fingering shape.
 *
 * Left-hand components:
 *   • Fret-span compactness    — penalise wide chord shapes.
 *   • Sweet-spot position      — bonus for low/mid frets, penalty for high.
 *   • Barre economy            — bonus when multiple notes share a fret.
 *
 * Right-hand components:
 *   • Open-string bonus        — open strings ring freely.
 *   • Adjacent-string gap      — penalise skipped strings within a chord.
 *
 * @param {{string:number, fret:number}[]} fingering
 * @param {object} cfg
 * @returns {number}
 */
function shapeScore(fingering, cfg) {
  const lhW = cfg.leftHandWeight;
  const rhW = cfg.rightHandWeight;

  const allFrets     = fingering.map((p) => p.fret);
  const frettedFrets = fingering.filter((p) => p.fret > 0).map((p) => p.fret);
  const strings      = fingering.map((p) => p.string).sort((a, b) => a - b);

  let score = 0;

  // ── LH: fret-span compactness ─────────────────────────────────────────────
  if (frettedFrets.length >= 2) {
    const span = Math.max(...frettedFrets) - Math.min(...frettedFrets);
    score -= span * cfg.fretSpanPenalty * lhW;
  }

  // ── LH: sweet-spot position bonus / high-fret penalty ────────────────────
  const avgFret = allFrets.reduce((a, b) => a + b, 0) / allFrets.length;
  if (avgFret >= cfg.sweetSpotLow && avgFret <= cfg.sweetSpotHigh) {
    score += cfg.sweetSpotBonus * lhW;
  } else if (avgFret > cfg.sweetSpotHigh) {
    let pen = (avgFret - cfg.sweetSpotHigh) * cfg.highFretPenalty;
    // Extra multiplier when high frets fall on thick (bass) strings
    const hasHighFretOnLowString = fingering.some(
      (p) => p.fret > cfg.sweetSpotHigh && p.string >= Math.floor(cfg.numStrings * 0.6),
    );
    if (hasHighFretOnLowString) pen *= cfg.lowStringHighFretMult;
    score -= pen * lhW;
  }

  // ── LH: barre-chord economy ───────────────────────────────────────────────
  if (frettedFrets.length >= 2) {
    const fretCounts = {};
    for (const f of frettedFrets) fretCounts[f] = (fretCounts[f] ?? 0) + 1;
    const maxShared = Math.max(...Object.values(fretCounts));
    if (maxShared > 1) score += (maxShared - 1) * cfg.barreBonus * lhW;
  }

  // ── RH: open-string bonus ─────────────────────────────────────────────────
  const openCount = fingering.filter((p) => p.fret === 0).length;
  score += openCount * cfg.openStringBonus * rhW;

  // ── RH: adjacent-string gap penalty ──────────────────────────────────────
  if (strings.length > 1) {
    let gaps = 0;
    for (let i = 1; i < strings.length; i++) gaps += strings[i] - strings[i - 1] - 1;
    score -= gaps * cfg.stringGapPenalty * rhW;
  }

  return score;
}

/**
 * Score the transition from prevFing (slice i-1) to currFing (slice i).
 *
 * Left-hand components:
 *   • Hand-position shift        — penalise large avg-fret jumps along the neck.
 *   • String-set change          — penalise adding/removing strings between shapes.
 *   • Diagonal-span impossibility — heavy deterrent if combined span is too wide.
 *
 * Right-hand components:
 *   • Let-ring reward            — reward leaving a sustaining string untouched.
 *   • Mute penalty               — penalise cutting a long note by reusing its string.
 *   • Right-hand jump penalty    — penalise large centre-of-strings movement.
 *   • Pre-position reward        — reward when a single note pre-positions the RH.
 *
 * @param {{string:number, fret:number}[]} prevFing
 * @param {{string:number, fret:number}[]} currFing
 * @param {{ time:number, notes:object[] }} prevSlice
 * @param {{ time:number, notes:object[] }} currSlice
 * @param {object} cfg
 * @returns {number}
 */
function transitionScore(prevFing, currFing, prevSlice, currSlice, cfg) {
  const lhW = cfg.leftHandWeight;
  const rhW = cfg.rightHandWeight;

  const timeDelta   = currSlice.time - prevSlice.time;
  const prevStrings = new Set(prevFing.map((p) => p.string));
  const currStrings = new Set(currFing.map((p) => p.string));

  let score = 0;

  // ── LH: hand-position shift ───────────────────────────────────────────────
  const avgPrev = prevFing.reduce((s, p) => s + p.fret, 0) / prevFing.length;
  const avgCurr = currFing.reduce((s, p) => s + p.fret, 0) / currFing.length;
  score -= Math.abs(avgCurr - avgPrev) * cfg.movementPenalty * lhW;

  // ── LH: string-set change penalty ────────────────────────────────────────
  const added   = [...currStrings].filter((s) => !prevStrings.has(s)).length;
  const removed = [...prevStrings].filter((s) => !currStrings.has(s)).length;
  score -= (added + removed) * cfg.stringSwitchPenalty * lhW;

  // ── LH: diagonal-span impossibility ──────────────────────────────────────
  const prevFretted = prevFing.filter((p) => p.fret > 0).map((p) => p.fret);
  const currFretted = currFing.filter((p) => p.fret > 0).map((p) => p.fret);
  if (prevFretted.length > 0 && currFretted.length > 0) {
    const all      = [...prevFretted, ...currFretted];
    const diagSpan = Math.max(...all) - Math.min(...all);
    if (diagSpan > cfg.maxHandSpan + 2) score -= 300 * lhW;
  }

  // ── RH: let-ring reward & mute penalty ───────────────────────────────────
  for (let i = 0; i < prevFing.length; i++) {
    const prevPos  = prevFing[i];
    const prevNote = prevSlice.notes[i];
    if (!prevNote) continue;

    if (!currStrings.has(prevPos.string)) {
      // String is free → note can continue sustaining
      if (prevNote.duration > timeDelta * 0.5) {
        score += cfg.letRingBonus * rhW;
      }
    } else {
      // String is reused → previous note is cut short
      if (prevNote.duration > timeDelta * 1.1) {
        score -= cfg.mutePenalty * rhW;
      }
    }
  }

  // ── RH: jump penalty ─────────────────────────────────────────────────────
  const prevCenter =
    (Math.min(...prevFing.map((p) => p.string)) +
     Math.max(...prevFing.map((p) => p.string))) / 2;
  const currCenter =
    (Math.min(...currFing.map((p) => p.string)) +
     Math.max(...currFing.map((p) => p.string))) / 2;
  score -= Math.abs(currCenter - prevCenter) * cfg.rightHandJumpPenalty * rhW;

  // ── RH: pre-position reward ───────────────────────────────────────────────
  // Single note → chord: if the single note is already on a chord string,
  // the right hand is pre-positioned.
  if (prevFing.length === 1 && currFing.length > 1) {
    if (currStrings.has(prevFing[0].string)) {
      score += cfg.prePositionBonus * rhW;
    }
  }

  // Chord → single note: half reward when the single string was in the chord.
  if (prevFing.length > 1 && currFing.length === 1) {
    if (prevStrings.has(currFing[0].string)) {
      score += cfg.prePositionBonus * 0.5 * rhW;
    }
  }

  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE — DP SOLVER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the globally-optimal fingering sequence using Viterbi / forward DP.
 *
 * dp[i][j] = highest total score achievable when slice i uses candidate j.
 *
 * Initialise:  dp[first][j] = shapeScore(cand[first][j])
 * Transition:  dp[i][j] = max_k { dp[prev][k] + shapeScore(cand[i][j])
 *                                              + transitionScore(cand[prev][k], cand[i][j]) }
 *
 * Unplayable slices (no candidates even after relaxed span) are skipped
 * transparently; the DP jumps over them and they receive null in the result.
 *
 * @param {{ time:number, notes:object[] }[]} slices
 * @param {Map}    pitchMap
 * @param {object} cfg
 * @returns {({string:number, fret:number}[] | null)[]}  One entry per slice.
 */
function dpSolve(slices, pitchMap, cfg) {
  const n = slices.length;

  // ── Step 1: generate candidates for every slice ───────────────────────────
  const allCandidates = slices.map((slice) => {
    const cands = generateCandidatesFallback(slice, pitchMap, cfg);
    if (cands.length === 0) {
      console.warn(
        `  ✗  t=${slice.time.toFixed(3)}: no valid fingering for ` +
        `[${slice.notes.map((nn) => nn.noteName).join(", ")}]`,
      );
    }
    return cands;
  });

  // Indices of slices that have at least one candidate
  const reachable = allCandidates
    .map((c, i) => (c.length > 0 ? i : -1))
    .filter((i) => i >= 0);

  if (reachable.length === 0) {
    console.warn("  ✗  No playable notes found for this track / tuning combination.");
    return new Array(n).fill(null);
  }

  // ── Step 2: allocate DP tables ────────────────────────────────────────────
  // dpScore[i][j]  best cumulative score to reach slice i with candidate j
  // dpPrev[i][j]   predecessor { sliceIdx, candIdx } | null  (null = first slice)
  const dpScore = allCandidates.map((c) => new Float64Array(c.length).fill(-Infinity));
  const dpPrev  = allCandidates.map((c) => new Array(c.length).fill(null));

  // ── Step 3: initialise first reachable slice ──────────────────────────────
  const firstIdx = reachable[0];
  for (let j = 0; j < allCandidates[firstIdx].length; j++) {
    dpScore[firstIdx][j] = shapeScore(allCandidates[firstIdx][j], cfg);
  }

  // ── Step 4: forward pass ──────────────────────────────────────────────────
  for (let ri = 1; ri < reachable.length; ri++) {
    const i     = reachable[ri];
    const prev  = reachable[ri - 1];
    const nCurr = allCandidates[i].length;
    const nPrev = allCandidates[prev].length;

    for (let j = 0; j < nCurr; j++) {
      const currShape = shapeScore(allCandidates[i][j], cfg);

      for (let k = 0; k < nPrev; k++) {
        if (dpScore[prev][k] === -Infinity) continue;

        const trans = transitionScore(
          allCandidates[prev][k],
          allCandidates[i][j],
          slices[prev],
          slices[i],
          cfg,
        );

        const total = dpScore[prev][k] + currShape + trans;
        if (total > dpScore[i][j]) {
          dpScore[i][j] = total;
          dpPrev[i][j]  = { sliceIdx: prev, candIdx: k };
        }
      }
    }
  }

  // ── Step 5: find the best terminal state ──────────────────────────────────
  const lastIdx  = reachable[reachable.length - 1];
  let bestScore  = -Infinity;
  let bestJ      = -1;

  for (let j = 0; j < allCandidates[lastIdx].length; j++) {
    if (dpScore[lastIdx][j] > bestScore) {
      bestScore = dpScore[lastIdx][j];
      bestJ     = j;
    }
  }

  if (bestJ === -1) {
    console.warn("  ✗  DP produced no valid path.");
    return new Array(n).fill(null);
  }

  // ── Step 6: backtrack to recover the optimal path ─────────────────────────
  const result = new Array(n).fill(null);
  let cur = { sliceIdx: lastIdx, candIdx: bestJ };

  while (cur !== null) {
    const { sliceIdx, candIdx } = cur;
    result[sliceIdx] = allCandidates[sliceIdx][candIdx];
    cur = dpPrev[sliceIdx][candIdx]; // null at the first reachable slice
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE — TECHNIQUE INFERENCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infer playing technique for each note from its fretboard context.
 *
 * Rules (applied to notes on the same string in consecutive slices):
 *   • timeDelta >= legatoThreshold → pick  (too slow for legato)
 *   • currFret > prevFret          → hammer-on
 *   • currFret < prevFret          → pull-off
 *   • currFret === prevFret        → pick  (re-attack same note)
 *   • Different string / first note → pick
 *
 * @param {{ time:number, notes:object[] }[]}                slices
 * @param {({string:number, fret:number}[] | null)[]}        fingerings
 * @param {object}                                           cfg
 * @returns {string[][]}  techniques[sliceIdx][noteIdx]
 */
function inferTechniques(slices, fingerings, cfg) {
  const techniques = slices.map((s) => s.notes.map(() => "pick"));

  for (let i = 1; i < slices.length; i++) {
    const currFing = fingerings[i];
    const prevFing = fingerings[i - 1];
    if (!currFing || !prevFing) continue;

    const timeDelta = slices[i].time - slices[i - 1].time;
    if (timeDelta >= cfg.legatoThreshold) continue;

    for (let ni = 0; ni < currFing.length; ni++) {
      const currPos = currFing[ni];

      // Find a note on the same string in the previous slice
      const prevPosIdx = prevFing.findIndex((p) => p.string === currPos.string);
      if (prevPosIdx === -1) continue; // different string → pick

      const prevPos = prevFing[prevPosIdx];

      // Simultaneous / grace notes → pick
      if (timeDelta < 0.01) continue;

      if (currPos.fret > prevPos.fret) {
        techniques[i][ni] = "hammer-on";
      } else if (currPos.fret < prevPos.fret) {
        techniques[i][ni] = "pull-off";
      }
      // Equal fret on same string → leave as "pick"
    }
  }

  return techniques;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — GuitarMapper CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DP-based guitar fretboard mapper.
 *
 * @example
 * const mapper = new GuitarMapper({ tuning: 'DROP_D', mode: 'sustain' });
 * const result = mapper.map(track.actions);
 */
export default class GuitarMapper {
  /**
   * @param {object}  [options]
   * @param {string}  [options.tuning='STANDARD']      Tuning key (see tunings.js).
   * @param {number}  [options.capo=0]                 Capo fret.
   * @param {number}  [options.maxFret=24]             Highest usable fret.
   * @param {number}  [options.maxHandSpan=4]          Max fret span in a chord shape.
   * @param {string}  [options.mode='balanced']        'balanced' | 'comfort' | 'sustain'.
   * @param {number|null} [options.leftHandWeight=null]  Override preset LH weight.
   * @param {number|null} [options.rightHandWeight=null] Override preset RH weight.
   * @param {number}  [options.quantRes=0.125]         Beat quantisation grid.
   */
  constructor({
    tuning          = "STANDARD",
    capo            = 0,
    maxFret         = 24,
    maxHandSpan     = 4,
    mode            = "balanced",
    leftHandWeight  = null,
    rightHandWeight = null,
    quantRes        = 0.125,
  } = {}) {
    const resolvedMode = PRESETS[mode] ? mode : "balanced";
    const preset       = PRESETS[resolvedMode];

    this._cfg = {
      ...preset,
      tuning:     tuning.toUpperCase().replace(/-/g, "_"),
      capo,
      maxFret,
      maxHandSpan,
      mode:       resolvedMode,
      quantRes,
      numStrings: 0, // set from tuning in map()
    };

    if (leftHandWeight  !== null) this._cfg.leftHandWeight  = leftHandWeight;
    if (rightHandWeight !== null) this._cfg.rightHandWeight = rightHandWeight;
  }

  /**
   * Map a track's actions to optimal string/fret assignments.
   *
   * Actions with `type !== "note"` are silently ignored.
   *
   * @param {object[]} actions  Raw actions array from a song track.
   * @returns {{
   *   tuning:          string,
   *   capo:            number,
   *   mode:            string,
   *   leftHandWeight:  number,
   *   rightHandWeight: number,
   *   slices: Array<{
   *     time:  number,
   *     notes: Array<{ pos: [number, number], technique: string }> | null
   *   }>
   * }}
   */
  map(actions) {
    const cfg = { ...this._cfg };

    const openMidis  = getOpenMidis(cfg.tuning);
    cfg.numStrings   = openMidis.length;

    const slices     = parseActions(actions, cfg.quantRes);
    const pitchMap   = buildPitchMap(openMidis, cfg.maxFret, cfg.capo);
    const fingerings = dpSolve(slices, pitchMap, cfg);
    const techniques = inferTechniques(slices, fingerings, cfg);

    return {
      tuning:          cfg.tuning,
      capo:            cfg.capo,
      mode:            cfg.mode,
      leftHandWeight:  cfg.leftHandWeight,
      rightHandWeight: cfg.rightHandWeight,
      slices: slices.map((slice, i) => {
        const fing = fingerings[i];
        if (!fing) {
          return { time: slice.time, notes: null };
        }
        return {
          time:  slice.time,
          notes: fing.map((pos, ni) => ({
            pos:       [pos.string + 1, pos.fret],  // 1-based string number
            technique: techniques[i]?.[ni] ?? "pick",
          })),
        };
      }),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC — CONVENIENCE EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-shot convenience wrapper: create a mapper, run it, return the result.
 *
 * @param {object[]} actions  Raw actions array from a song track.
 * @param {object}   [options]  Same options as the GuitarMapper constructor.
 * @returns {ReturnType<GuitarMapper["map"]>}
 */
export function mapTrack(actions, options) {
  return new GuitarMapper(options).map(actions);
}
