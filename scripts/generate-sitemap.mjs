#!/usr/bin/env node
/**
 * synrecordia/scripts/generate-sitemap.mjs
 *
 * Reads `public/songs/index.json` and writes `public/sitemap.xml`.
 *
 * Usage:
 *   node scripts/generate-sitemap.mjs [BASE_URL]
 *
 * Options:
 *   BASE_URL   First positional argument or SITEMAP_BASE env var.
 *              Falls back to https://synrecordia.netlify.app
 *
 * For each song in index.json the sitemap includes:
 *   - A page URL   /?song=<id>    (when `id` is present)
 *   - An asset URL /songs/<file>  (when `file` is present; mtime used for <lastmod>)
 * The site root `/` is always included.
 */

import { promises as fsp } from "fs";
import path from "path";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_BASE = "https://synrecordia.netlify.app";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureTrailingSlashRemoved(str) {
  if (!str) return "";
  return str.endsWith("/") ? str.slice(0, -1) : str;
}

function formatDate(date) {
  // Sitemap W3C Datetime — YYYY-MM-DD is sufficient.
  return date.toISOString().split("T")[0];
}

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
    .replaceAll('"', "&quot;");
}

async function fileExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── Sitemap builder ───────────────────────────────────────────────────────────

function buildSitemapXml(urls) {
  const header =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  const footer = `</urlset>\n`;

  let body = "";
  for (const [loc, meta] of urls) {
    body += "  <url>\n";
    body += `    <loc>${escapeXml(loc)}</loc>\n`;
    if (meta?.lastmod)
      body += `    <lastmod>${escapeXml(meta.lastmod)}</lastmod>\n`;
    if (meta?.priority)
      body += `    <priority>${escapeXml(meta.priority)}</priority>\n`;
    body += "  </url>\n";
  }

  return header + body + footer;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const baseArg = argv[0] || process.env.SITEMAP_BASE || DEFAULT_BASE;
  const base = ensureTrailingSlashRemoved(baseArg);

  const publicDir = path.resolve(process.cwd(), "public");
  const songsIndexPath = path.join(publicDir, "songs", "index.json");
  const sitemapPath = path.join(publicDir, "sitemap.xml");

  const urls = new Map(); // url => { lastmod?, priority? }

  // Always include the site root.
  urls.set(base + "/", { priority: "1.0" });

  if (!(await fileExists(songsIndexPath))) {
    console.warn(
      `Warning: ${songsIndexPath} not found. Writing sitemap with root only.`,
    );
  } else {
    const raw = await fsp.readFile(songsIndexPath, "utf8");
    let list;
    try {
      list = JSON.parse(raw);
    } catch (err) {
      console.warn(
        `Warning: failed to parse ${songsIndexPath}: ${err.message}`,
      );
      list = [];
    }

    if (!Array.isArray(list)) {
      console.warn(
        `Warning: ${songsIndexPath} does not contain an array. Ignoring.`,
      );
      list = [];
    }

    for (const meta of list) {
      // 1) Human-friendly page URL (query param) if id exists.
      if (meta?.id) {
        const pageUrl = `${base}/?song=${encodeURIComponent(String(meta.id))}`;
        if (!urls.has(pageUrl)) urls.set(pageUrl, { priority: "0.8" });
      }

      // 2) Raw song JSON asset URL if file exists.
      if (meta?.file) {
        const fileUrl = `${base}/songs/${encodeURIComponent(String(meta.file))}`;
        const songFilePath = path.join(publicDir, "songs", String(meta.file));
        let lastmod;
        try {
          const stat = await fsp.stat(songFilePath);
          lastmod = formatDate(stat.mtime);
        } catch {
          lastmod = undefined;
        }
        if (!urls.has(fileUrl)) urls.set(fileUrl, { lastmod, priority: "0.6" });
      }
    }
  }

  const xml = buildSitemapXml(urls);
  await fsp.mkdir(publicDir, { recursive: true });
  await fsp.writeFile(sitemapPath, xml, "utf8");
  console.log(`Wrote sitemap to ${sitemapPath} (${urls.size} entries)`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
