/**
 * Song catalog loading.
 *
 * Prefers the relay API (`/api/songs`) so the catalog can be served/dynamic
 * from the backend, and transparently falls back to the static
 * `public/songs/index.json` when the relay is unreachable (e.g. plain static
 * hosting or offline dev).
 *
 * The API accepts the same search/filter shape the Directory UI uses:
 *   { search, difficulty, page, limit }
 * and returns a paginated envelope `{ items, total, page, limit, totalPages }`.
 * The static index is a bare array of the same item shape. Both are normalised
 * to a bare array here.
 */
const STATIC_INDEX_URL = "/songs/index.json";

export async function fetchSongIndex({ search, difficulty, page, limit } = {}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (difficulty) params.set("difficulty", difficulty);
  if (page) params.set("page", page);
  if (limit) params.set("limit", limit);
  const qs = params.toString();

  // Prefer the API. On success we trust the result (even an empty page) and do
  // NOT fall back to static — falling back only happens if the relay is
  // unreachable or errors.
  try {
    const res = await fetch(`/api/songs${qs ? `?${qs}` : ""}`);
    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data) ? data : data?.items ?? data?.songs;
      return Array.isArray(list) ? list : [];
    }
  } catch {
    /* relay unreachable — fall back to the static index below */
  }

  const res = await fetch(STATIC_INDEX_URL);
  if (!res.ok) throw new Error("Failed to load song index.");
  return res.json();
}
