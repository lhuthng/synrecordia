#!/usr/bin/env node
/**
 * sampler-structure-helper.mjs
 *
 * Scans a directory tree for index.json files that contain an array of sample
 * filenames and transforms each one into a note-keyed object compatible with
 * Tone.js: { "C4": "C4v1.mp3", "D#4": "Ds4v1.mp3", ... }.
 *
 * Usage:
 *   node scripts/sampler-structure-helper.mjs <path-to-parent-folder>
 */

import fs from "fs";
import path from "path";

// ── Pitch helpers ─────────────────────────────────────────────────────────────

/**
 * Extracts a Tone.js-compatible note key from a sample filename.
 * Matches patterns like A4, Gs6, Db3, C#5 inside the filename.
 *
 * @param {string} filename
 * @returns {string|null} e.g. "A4", "G#6" or null if no note found
 */
function filenameToNoteKey(filename) {
  // ([A-G])   — note letter
  // (s|b|#)?  — optional sharp (s or #) or flat (b)
  // (\d)      — octave number
  const match = filename.match(/([A-G])(s|b|#)?(\d)/i);
  if (!match) return null;

  const note = match[1].toUpperCase();
  const octave = match[3];
  let accidental = match[2] ? match[2].toLowerCase() : "";

  // Standardize 's' → '#' for Tone.js
  if (accidental === "s") accidental = "#";

  return `${note}${accidental}${octave}`;
}

// ── Transformation ────────────────────────────────────────────────────────────

/**
 * Converts an array of sample filenames into a note-keyed object.
 * Filenames that do not match the note pattern are silently skipped.
 *
 * @param {string[]} filenames
 * @returns {Record<string, string>}
 */
function transformSampleArray(filenames) {
  const result = {};
  for (const filename of filenames) {
    const key = filenameToNoteKey(filename);
    if (key) result[key] = filename;
  }
  return result;
}

// ── Directory walk ────────────────────────────────────────────────────────────

/**
 * Recursively walks `dir`, finds every index.json containing an array, and
 * replaces it with the note-keyed object produced by transformSampleArray.
 *
 * @param {string} dir
 */
function processDirectory(dir) {
  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const entryPath = path.join(dir, entry);
    const stat = fs.statSync(entryPath);

    if (stat.isDirectory()) {
      if (entry !== "node_modules" && entry !== ".git") {
        processDirectory(entryPath);
      }
    } else if (entry === "index.json") {
      try {
        const raw = fs.readFileSync(entryPath, "utf8");
        const json = JSON.parse(raw);

        if (Array.isArray(json)) {
          const transformed = transformSampleArray(json);
          fs.writeFileSync(entryPath, JSON.stringify(transformed, null, 2));
          console.log(`Transformed: ${entryPath}`);
        }
      } catch (err) {
        console.error(`Error in ${entryPath}: ${err.message}`);
      }
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

function main() {
  const targetDir = process.argv[2];

  if (!targetDir) {
    console.error(
      "Usage: node scripts/sampler-structure-helper.mjs <path-to-parent-folder>",
    );
    process.exit(1);
  }

  const fullPath = path.resolve(targetDir);

  if (!fs.existsSync(fullPath)) {
    console.error(`Directory not found: ${fullPath}`);
    process.exit(1);
  }

  console.log(`Scanning: ${fullPath}`);
  processDirectory(fullPath);
  console.log("Done.");
}

main();
