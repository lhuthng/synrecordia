#!/usr/bin/env node
/**
 * synrecordia/scripts/generate-sitemap.mjs
 *
 * Reads `public/songs/index.json` and writes `public/sitemap.xml`.
 *
 * Usage:
 *   node scripts/generate-sitemap.mjs [BASE_URL]
 *
 * If BASE_URL is not provided, the script will fall back to:
 *   https://synrecordia.netlify.app
 *
 * The script will:
 * - Read `public/songs/index.json` (expected to be an array of song metadata
 *   objects that include at least `id` and/or `file` fields).
 * - For each song, add a sitemap `<url>` entry for:
 *   - A human-friendly page URL `/?song=<id>` (if `id` exists)
 *   - The song JSON asset `/songs/<file>` (if `file` exists)
 *   - Use the song file's filesystem mtime as `<lastmod>` when possible.
 * - Always include the site root `/`.
 *
 * The generated sitemap is written to `public/sitemap.xml`.
 */

import fs from "fs/promises";
import path from "path";

const DEFAULT_BASE = "https://synrecordia.netlify.app";

function ensureSlash(str) {
  if (!str) return "";
  return str.endsWith("/") ? str.slice(0, -1) : str;
}

function formatDateISO(date) {
  // sitemap expects W3C Datetime - use YYYY-MM-DD (we include date only)
  // Optionally could use full datetime; YYYY-MM-DD is sufficient.
  return date.toISOString().split("T")[0];
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  try {
    const argv = process.argv.slice(2);
    const baseArg = argv[0] || process.env.SITEMAP_BASE || DEFAULT_BASE;
    const base = ensureSlash(baseArg);

    const publicDir = path.resolve(process.cwd(), "public");
    const songsIndexPath = path.join(publicDir, "songs", "index.json");
    const sitemapPath = path.join(publicDir, "sitemap.xml");

    const urls = new Map(); // url => { lastmod?, priority? }

    // Always include the site root
    urls.set(base + "/", { priority: "1.0" });

    const hasIndex = await fileExists(songsIndexPath);
    if (!hasIndex) {
      console.warn(`Warning: ${songsIndexPath} not found. Writing sitemap with root only.`);
    } else {
      const raw = await fs.readFile(songsIndexPath, "utf8");
      let list;
      try {
        list = JSON.parse(raw);
      } catch (err) {
        console.warn(`Warning: failed to parse ${songsIndexPath}: ${err.message}`);
        list = [];
      }

      if (!Array.isArray(list)) {
        console.warn(`Warning: ${songsIndexPath} does not contain an array. Ignoring.`);
        list = [];
      }

      for (const meta of list) {
        // meta may contain { id, title, file, ... }
        // 1) add a human-friendly page URL (query param) if id exists
        if (meta?.id) {
          const pageUrl = `${base}/?song=${encodeURIComponent(String(meta.id))}`;
          if (!urls.has(pageUrl)) urls.set(pageUrl, { priority: "0.8" });
        }

        // 2) add the raw song json asset URL if file exists
        if (meta?.file) {
          const fileUrl = `${base}/songs/${encodeURIComponent(String(meta.file))}`;
          // attempt to read file mtime for lastmod
          const songFilePath = path.join(publicDir, "songs", String(meta.file));
          let lastmod;
          try {
            const stat = await fs.stat(songFilePath);
            lastmod = formatDateISO(stat.mtime);
          } catch {
            lastmod = undefined;
          }
          if (!urls.has(fileUrl)) urls.set(fileUrl, { lastmod, priority: "0.6" });
        }
      }
    }

    // Build XML
    const header = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    const footer = `</urlset>\n`;

    let body = "";
    for (const [loc, meta] of urls) {
      body += "  <url>\n";
      body += `    <loc>${escapeXml(loc)}</loc>\n`;
      if (meta?.lastmod) body += `    <lastmod>${escapeXml(meta.lastmod)}</lastmod>\n`;
      if (meta?.priority) body += `    <priority>${escapeXml(meta.priority)}</priority>\n`;
      body += "  </url>\n";
    }

    const xml = header + body + footer;

    // Ensure public dir exists
    await fs.mkdir(publicDir, { recursive: true });
    await fs.writeFile(sitemapPath, xml, "utf8");
    console.log(`Wrote sitemap to ${sitemapPath} (${urls.size} entries)`);
  } catch (err) {
    console.error("Error generating sitemap:", err && err.message ? err.message : String(err));
    process.exitCode = 2;
  }
}

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
    .replaceAll('"', "&quot;");
}

if (import.meta.url === `file://${process.argv[1]}` || typeof process !== "undefined") {
  // Run when invoked directly
  // (the condition is a practical check; in most Node versions the script will run)
  main();
}
