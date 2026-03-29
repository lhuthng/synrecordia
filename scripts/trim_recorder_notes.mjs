#!/usr/bin/env node
// synrecordia/scripts/trim_recorder_notes.mjs
// ESM script to trim overlapping notes and collapse multi-note actions.
// Usage:
//   node synrecordia/scripts/trim_recorder_notes.mjs <file-or-dir> [--in-place] [--backup]

import { promises as fsp } from "fs";
import fs from "fs";
import path from "path";

function noteNameToMidi(name) {
  if (name == null) return NaN;
  if (typeof name === "number") return name;
  if (typeof name === "string") {
    const s = name.trim();
    if (/^-?\d+$/.test(s)) return Number(s);
    const m = s.match(/^([A-G])(#?)(-?\d+)$/i);
    if (!m) return NaN;
    const [, letterRaw, sharp, octaveStr] = m;
    const letter = letterRaw.toUpperCase();
    const octave = Number(octaveStr);
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter] ?? 0;
    return (octave + 1) * 12 + base + (sharp ? 1 : 0);
  }
  return NaN;
}

function pickHighest(pitches) {
  if (!Array.isArray(pitches) || pitches.length === 0) return null;
  let best = null;
  let bestMidi = -Infinity;
  for (const p of pitches) {
    const m = noteNameToMidi(p);
    if (!Number.isNaN(m) && m > bestMidi) {
      bestMidi = m;
      best = p;
    }
  }
  // fallback: if no valid midi found, return first
  return best ?? pitches[0];
}

async function processFile(filePath, opts = { inPlace: false, makeBackup: false }) {
  let raw;
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch (err) {
    console.error(`Failed to read ${filePath}:`, err.message);
    return;
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    console.error(`Invalid JSON ${filePath}:`, err.message);
    return;
  }

  if (!doc || !Array.isArray(doc.tracks)) {
    console.error(`No tracks array in ${filePath}`);
    return;
  }

  const trackIndex = doc.tracks.findIndex((t) => t && t.instrument === "recorder");
  const useIndex = trackIndex === -1 ? 0 : trackIndex;
  const track = doc.tracks[useIndex];
  if (!track || !Array.isArray(track.actions)) {
    console.error(`No usable actions in track ${useIndex} of ${filePath}`);
    return;
  }

  const actions = track.actions;

  // 1) Collapse multi-note actions (pitches -> pitch with highest)
  let collapsed = 0;
  for (const a of actions) {
    if (!a || a.type !== "note") continue;
    if (Array.isArray(a.pitches) && a.pitches.length > 0) {
      const chosen = pickHighest(a.pitches);
      if (chosen != null) {
        a.pitch = chosen;
        delete a.pitches;
        collapsed += 1;
      }
    } else if (Array.isArray(a.pitch) && a.pitch.length > 0) {
      const chosen = pickHighest(a.pitch);
      if (chosen != null) {
        a.pitch = chosen;
        collapsed += 1;
      }
    }
  }

  // 2) Collect note actions sorted by start time then original index
  const noteItems = [];
  for (let i = 0; i < actions.length; i += 1) {
    const a = actions[i];
    if (!a || a.type !== "note") continue;
    const time = Number(a.time);
    if (!Number.isFinite(time)) continue;
    const dur = Number(a.duration);
    noteItems.push({ idx: i, time, duration: Number.isFinite(dur) ? dur : 0 });
  }
  noteItems.sort((x, y) => (x.time - y.time) || (x.idx - y.idx));

  // 3) Trim overlaps based on temporal ordering
  const removeIdx = new Set();
  let trimmed = 0;
  for (let k = 0; k < noteItems.length - 1; k += 1) {
    const cur = noteItems[k];
    // find the next note that hasn't been removed (using the ordered list)
    const next = noteItems[k + 1];
    if (!cur || !next) continue;
    const curEnd = cur.time + (Number.isFinite(cur.duration) ? cur.duration : 0);
    const nextStart = next.time;
    if (curEnd > nextStart) {
      const newDur = Math.max(0, nextStart - cur.time);
      if (newDur <= 0) {
        removeIdx.add(cur.idx);
      } else {
        const a = actions[cur.idx];
        if (a) {
          a.duration = newDur;
          trimmed += 1;
        }
      }
    }
  }

  // Remove zero-duration notes (marked)
  if (removeIdx.size > 0) {
    // Build new actions array preserving order and excluding removed indices
    const newActions = [];
    for (let i = 0; i < actions.length; i += 1) {
      if (removeIdx.has(i)) continue;
      newActions.push(actions[i]);
    }
    // Replace in-place
    track.actions = newActions;
  }

  // Summary
  const removed = removeIdx.size;
  console.log(`File: ${filePath}`);
  console.log(`  Track processed: index=${useIndex} instrument=${track.instrument || "unknown"}`);
  console.log(`  Multi-note actions collapsed: ${collapsed}`);
  console.log(`  Notes trimmed (duration shortened): ${trimmed}`);
  console.log(`  Notes removed (zero duration): ${removed}`);

  // Write result
  if (opts.inPlace) {
    if (opts.makeBackup) {
      const bak = `${filePath}.bak`;
      try {
        await fsp.writeFile(bak, raw, "utf8");
        console.log(`  Backup written: ${bak}`);
      } catch (err) {
        console.error(`  Failed to write backup ${bak}:`, err.message);
        return;
      }
    }
    try {
      await fsp.writeFile(filePath, JSON.stringify(doc, null, 2), "utf8");
      console.log(`  Overwrote: ${filePath}`);
    } catch (err) {
      console.error(`  Failed to write ${filePath}:`, err.message);
    }
  } else {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const out = path.join(dir, `${base}.trimmed.json`);
    try {
      await fsp.writeFile(out, JSON.stringify(doc, null, 2), "utf8");
      console.log(`  Written: ${out}`);
    } catch (err) {
      console.error(`  Failed to write ${out}:`, err.message);
    }
  }
}

async function processPath(target, opts) {
  try {
    const stat = await fsp.stat(target);
    if (stat.isDirectory()) {
      const names = await fsp.readdir(target);
      for (const n of names) {
        if (!n.toLowerCase().endsWith(".json")) continue;
        await processFile(path.join(target, n), opts);
      }
    } else {
      await processFile(target, opts);
    }
  } catch (err) {
    console.error(`Error processing ${target}:`, err.message);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("Usage: trim_recorder_notes.mjs <file-or-dir> [--in-place] [--backup]");
    process.exit(1);
  }
  const opts = {
    inPlace: argv.includes("--in-place"),
    makeBackup: argv.includes("--backup"),
  };
  const targets = argv.filter((a) => !a.startsWith("--"));
  for (const t of targets) {
    await processPath(t, opts);
  }
}

if (process.argv[1] && path.basename(process.argv[1]).endsWith("trim_recorder_notes.mjs")) {
  main().catch((e) => {
    console.error("Unhandled error:", e);
    process.exit(2);
  });
}
