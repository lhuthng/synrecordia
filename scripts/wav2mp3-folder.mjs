#!/usr/bin/env node
/**
 * synrecordia/scripts/wav2mp3-folder.mjs
 *
 * Lightweight Node.js helper to convert all .wav files in a samples folder
 * (organized by "versions" listed in a top-level index.json) to .mp3 and
 * update per-version index.json files to point at the .mp3 filenames.
 *
 * Usage:
 *   node wav2mp3-folder.mjs [rootDir]
 *   node wav2mp3-folder.mjs /path/to/public/samples/piano --bitrate=192k --delete-original --overwrite
 *
 * Options:
 *   --bitrate=192k       MP3 target bitrate (ffmpeg accepts "192k"; lame accepts "192")
 *   --delete-original    Remove .wav files after successful conversion
 *   --overwrite          Overwrite existing .mp3 output files
 *   --concurrency=4      Number of parallel conversions
 *   --dry-run            Don't actually run conversions or write files; just report
 *   --verbose            More logging
 *   --help               Show help
 *
 * Notes:
 *  - Prefers `ffmpeg` if available, falls back to `lame` (both must be in PATH).
 *  - Backs up each modified index.json as `index.json.bak` before writing.
 *  - Only updates JSON entries that currently reference `.wav` filenames and whose
 *    conversion succeeded (unless --dry-run).
 *
 * Written to be dependency-free (Node builtin modules only).
 */

import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from "fs/promises";
import { spawn } from "child_process";
import { delimiter, dirname, join, resolve as resolvePath } from "path";
import { EOL } from "os";

// ── CLI options ───────────────────────────────────────────────────────────────

function parseArgs(args) {
  const opts = {
    root: process.cwd(),
    bitrate: "192k",
    deleteOriginal: false,
    overwrite: false,
    concurrency: 4,
    dryRun: false,
    verbose: false,
  };

  for (const arg of args) {
    if (!arg.startsWith("--") && opts.root === process.cwd()) {
      opts.root = arg;
      continue;
    }
    if (arg === "--delete-original") opts.deleteOriginal = true;
    else if (arg === "--overwrite") opts.overwrite = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--verbose") opts.verbose = true;
    else if (arg.startsWith("--bitrate=")) opts.bitrate = arg.split("=")[1];
    else if (arg.startsWith("--concurrency="))
      opts.concurrency = Math.max(1, Number(arg.split("=")[1]) || 1);
    else if (arg === "--help") opts.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      opts.help = true;
    }
  }
  return opts;
}

function usageExit(code = 0) {
  console.log(
    `Usage: node wav2mp3-folder.mjs [rootDir] [--bitrate=192k] [--delete-original] [--overwrite] [--concurrency=4] [--dry-run] [--verbose]`,
  );
  process.exit(code);
}

// ── Logging ───────────────────────────────────────────────────────────────────

let verbose = false;

function log(...xs) {
  if (verbose) console.log(...xs);
}
function info(...xs) {
  console.log(...xs);
}

// ── System utilities ──────────────────────────────────────────────────────────

async function which(cmd) {
  const paths = (process.env.PATH || "").split(delimiter);
  const exts =
    process.platform === "win32" && process.env.PATHEXT
      ? process.env.PATHEXT.split(";")
      : [""];
  for (const p of paths) {
    const candidate = join(p, cmd);
    for (const ext of exts) {
      try {
        await access(candidate + ext);
        return candidate + ext;
      } catch (e) {
        /* continue */
      }
    }
  }
  return null;
}

async function detectConverter() {
  const ffmpegPath = await which("ffmpeg");
  if (ffmpegPath) return { name: "ffmpeg", path: ffmpegPath };
  const lamePath = await which("lame");
  if (lamePath) return { name: "lame", path: lamePath };
  return null;
}

function runProcess(cmd, args, optsSpawn = {}) {
  return new Promise((resolve, reject) => {
    const ps = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...optsSpawn,
    });
    let stdout = "",
      stderr = "";
    ps.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    ps.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    ps.on("error", (err) => reject(err));
    ps.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr, code });
      else
        reject(
          new Error(
            `Command "${cmd} ${args.join(" ")}" exited ${code}\n${stderr}`,
          ),
        );
    });
  });
}

// ── File utilities ────────────────────────────────────────────────────────────

function toMp3Name(wavName) {
  if (wavName.toLowerCase().endsWith(".wav")) {
    return wavName.slice(0, -4) + ".mp3";
  }
  return wavName;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, obj) {
  const data = JSON.stringify(obj, null, 2) + EOL;
  await writeFile(filePath, data, "utf8");
}

async function ensureFileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ── Conversion ────────────────────────────────────────────────────────────────

async function convertFile(
  converter,
  inputPath,
  outputPath,
  bitrate,
  { overwrite = false, dryRun = false } = {},
) {
  if (!overwrite) {
    const exists = await ensureFileExists(outputPath);
    if (exists) {
      log(`Skipping existing: ${outputPath}`);
      return { skipped: true };
    }
  }

  if (dryRun) {
    log(`[dry-run] would convert: ${inputPath} -> ${outputPath}`);
    return { dry: true };
  }

  // Ensure parent dir of output exists
  await mkdir(dirname(outputPath), { recursive: true });

  if (converter.name === "ffmpeg") {
    // ffmpeg -hide_banner -loglevel error -y -i "in.wav" -codec:a libmp3lame -b:a 192k "out.mp3"
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-codec:a",
      "libmp3lame",
      "-b:a",
      bitrate,
      outputPath,
    ];
    log("Running ffmpeg", args.join(" "));
    await runProcess(converter.path, args);
    return { converted: true };
  } else if (converter.name === "lame") {
    // lame -m s -b 192 input.wav output.mp3
    // lame expects numeric bitrate, strip trailing k/K
    const bnum = String(bitrate).replace(/[kK]$/, "");
    const args = ["-m", "s", "-b", bnum, inputPath, outputPath];
    log("Running lame", args.join(" "));
    await runProcess(converter.path, args);
    return { converted: true };
  } else {
    throw new Error("Unsupported converter: " + JSON.stringify(converter));
  }
}

async function processVersion(converter, rootDir, version, options) {
  const versionDir = join(rootDir, version);
  const indexPath = join(versionDir, "index.json");

  if (!(await ensureFileExists(indexPath))) {
    info(`No index.json in ${versionDir}, skipping.`);
    return { version, converted: 0, skipped: 0 };
  }

  log(`Processing version ${version} (index: ${indexPath})`);
  const mapping = await readJson(indexPath);
  if (typeof mapping !== "object" || mapping === null) {
    info(`index.json in ${versionDir} is not an object, skipping.`);
    return { version, converted: 0, skipped: 0 };
  }

  // Gather tasks: key -> filename
  const tasks = [];
  for (const [key, fname] of Object.entries(mapping)) {
    if (typeof fname === "string" && fname.toLowerCase().endsWith(".wav")) {
      const inputPath = join(versionDir, fname);
      const outName = toMp3Name(fname);
      const outputPath = join(versionDir, outName);
      tasks.push({ key, fname, inputPath, outName, outputPath });
    }
  }

  if (tasks.length === 0) {
    log(`No .wav entries found in ${indexPath}`);
    return { version, converted: 0, skipped: 0 };
  }

  info(`Found ${tasks.length} .wav files to convert in ${version}`);

  // Run conversions with concurrency
  const concurrency = options.concurrency || 4;
  let active = 0;
  let idx = 0;
  let convertedCount = 0;
  let skippedCount = 0;
  const results = [];

  async function worker() {
    while (true) {
      let task;
      // Fetch next task atomically
      if (idx < tasks.length) {
        task = tasks[idx++];
      } else break;

      log(`Converting [${version}] ${task.fname} -> ${task.outName}`);
      try {
        const conversion = await convertFile(
          converter,
          task.inputPath,
          task.outputPath,
          options.bitrate,
          { overwrite: options.overwrite, dryRun: options.dryRun },
        );
        if (conversion.converted || conversion.dry) {
          convertedCount++;
          results.push({ task, ok: true });
          // Optionally delete original
          if (
            options.deleteOriginal &&
            !options.dryRun &&
            conversion.converted
          ) {
            try {
              await unlink(task.inputPath);
              log("Deleted original:", task.inputPath);
            } catch (e) {
              log("Failed to delete original:", e.message);
            }
          }
        } else if (conversion.skipped) {
          skippedCount++;
          results.push({ task, ok: false, skipped: true });
        } else {
          results.push({ task, ok: false });
        }
      } catch (e) {
        log(`Conversion failed for ${task.inputPath}:`, e.message);
        results.push({ task, ok: false, error: e });
      }
    }
  }

  // Launch workers
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  // Update index.json: only change entries for tasks that succeeded
  const succeededOutNames = new Set(
    results.filter((r) => r.ok).map((r) => r.task.fname),
  ); // original wav names that succeeded
  if (!options.dryRun) {
    // Backup index.json
    const bakPath = indexPath + ".bak";
    try {
      await copyFile(indexPath, bakPath);
      log(`Backed up ${indexPath} -> ${bakPath}`);
    } catch (e) {
      log(`Warning: failed to backup ${indexPath}: ${e.message}`);
    }

    let changed = false;
    for (const r of results) {
      if (r.ok) {
        const { key, fname, outName } = r.task;
        if (mapping[key] === fname) {
          mapping[key] = outName;
          changed = true;
        } else {
          log(
            `Skipping update for ${key} because mapping changed (was ${mapping[key]})`,
          );
        }
      }
    }
    if (changed) {
      await writeJson(indexPath, mapping);
      info(`Updated ${indexPath} to reference .mp3 files`);
    } else {
      log(`No index.json changes necessary for ${indexPath}`);
    }
  } else {
    log(`[dry-run] would update ${indexPath} for ${convertedCount} entries`);
  }

  return {
    version,
    converted: convertedCount,
    skipped: skippedCount,
    total: tasks.length,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (opts.help) usageExit(0);
  verbose = opts.verbose;

  const converter = await detectConverter();
  if (!converter) {
    console.error(
      "No converter found. Please install ffmpeg (recommended) or lame and ensure it is in your PATH.",
    );
    console.error("On macOS: brew install ffmpeg");
    console.error("On Debian/Ubuntu: sudo apt install ffmpeg");
    process.exit(2);
  }
  info("Using converter:", converter.name);

  const rootDir = resolvePath(opts.root);
  info("Root directory:", rootDir);

  // Read top-level index.json
  const topIndexPath = join(rootDir, "index.json");
  let versions = [];
  if (await ensureFileExists(topIndexPath)) {
    try {
      const top = await readJson(topIndexPath);
      if (Array.isArray(top.versions)) {
        versions = top.versions.slice();
        info(`Found versions in top index.json: ${versions.join(", ")}`);
      }
    } catch (e) {
      log("Failed to read top index.json:", e.message);
    }
  }

  // If no versions found, discover subdirs that contain index.json
  if (versions.length === 0) {
    info(
      'No "versions" in top index.json; searching for subfolders with index.json',
    );
    const dirents = await readdir(rootDir, { withFileTypes: true });
    for (const d of dirents) {
      if (d.isDirectory()) {
        const candidate = join(rootDir, d.name, "index.json");
        if (await ensureFileExists(candidate)) versions.push(d.name);
      }
    }
    info(`Discovered versions: ${versions.join(", ")}`);
  }

  if (versions.length === 0) {
    console.error(
      'No versions found to process. Ensure a top-level index.json with "versions" or subfolders with index.json exist.',
    );
    process.exit(3);
  }

  const results = [];
  for (const ver of versions) {
    try {
      const res = await processVersion(converter, rootDir, ver, {
        bitrate: opts.bitrate,
        deleteOriginal: opts.deleteOriginal,
        overwrite: opts.overwrite,
        concurrency: opts.concurrency,
        dryRun: opts.dryRun,
      });
      results.push(res);
    } catch (e) {
      console.error(`Failed to process version ${ver}:`, e.message);
    }
  }

  // Summary
  let totalConverted = 0,
    totalSkipped = 0,
    totalTasks = 0;
  for (const r of results) {
    totalConverted += r.converted || 0;
    totalSkipped += r.skipped || 0;
    totalTasks += r.total || 0;
  }

  info("--- Summary ---");
  info(`Versions processed: ${results.length}`);
  info(`Total tasks found: ${totalTasks}`);
  info(`Converted: ${totalConverted}`);
  info(`Skipped: ${totalSkipped}`);
  if (opts.dryRun)
    info(
      "Note: dry-run was enabled; no files were actually written or deleted.",
    );

  info("Done.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
