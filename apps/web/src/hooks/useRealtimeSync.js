import { useCallback, useEffect, useRef } from "react";
import { fetchSongIndex } from "../libs/songs.js";

/**
 * useRealtimeSync — bridges usePlayer state to/from a room.
 *
 * Host mode: watches the player and pushes discrete actions (song, BPM,
 * play/pause, seek) to the room config.
 *
 * Member mode: applies incoming host config to the player and follows along.
 * Members never push (the relay rejects non-host config), so this hook is a
 * pure follower on their side.
 *
 * @param {object} player — return value of usePlayer()
 * @param {object} room   — return value of useRoom()
 */
export default function useRealtimeSync(player, room) {
  const { isHost, isFollowing, latestConfig, updateConfig } = room;

  // Keep a stable ref to the player so effects can read the latest player state
  // without re-running on every render (usePlayer returns a fresh object).
  // Ref is assigned in an effect (mutating it during render is disallowed by the
  // React compiler); running it first keeps downstream effects in sync each pass.
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  });

  // The last config this client pushed (host) — used to diff and avoid loops.
  const lastPushRef = useRef({
    songId: null,
    bpm: player.bpm,
    playing: false,
    beat: 0,
  });

  const push = useCallback(
    (patch) => {
      const next = { ...lastPushRef.current, ...patch };
      lastPushRef.current = next;
      updateConfig(next);
    },
    [updateConfig],
  );

  // ── Host: push song changes ────────────────────────────────────────────────
  useEffect(() => {
    if (!isHost) return;
    const songId = player.song?.id;
    if (songId && songId !== lastPushRef.current.songId) {
      lastPushRef.current.songId = songId;
      push({ songId, playing: false, beat: 0 });
    }
  }, [isHost, player.song?.id, push]);

  // ── Host: push BPM changes ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isHost) return;
    if (player.bpm !== lastPushRef.current.bpm) {
      push({ bpm: player.bpm });
    }
  }, [isHost, player.bpm, push]);

  // ── Host: push play/pause ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isHost) return;
    if (player.isPlaying && !lastPushRef.current.playing) {
      push({ playing: true, beat: player.currentBeat });
    } else if (!player.isPlaying && lastPushRef.current.playing) {
      push({ playing: false });
    }
  }, [isHost, player.isPlaying, player.currentBeat, push]);

  // ── Host: push seeks while paused (scrub / restart) ────────────────────────
  useEffect(() => {
    if (!isHost || player.isPlaying) return;
    if (player.currentBeat !== lastPushRef.current.beat) {
      push({ beat: player.currentBeat });
    }
  }, [isHost, player.isPlaying, player.currentBeat, push]);

  // ── Member: load a song by id ──────────────────────────────────────────────
  const loadingRef = useRef(null);
  const loadSongById = useCallback(async (id) => {
    if (loadingRef.current === id) return;
    loadingRef.current = id;
    try {
      const index = await fetchSongIndex();
      const meta = (Array.isArray(index) ? index : []).find((s) => s.id === id);
      if (!meta) return;
      const res = await fetch(`/songs/${meta.file}`);
      if (!res.ok) return;
      const songData = await res.json();
      if (loadingRef.current === id) playerRef.current.selectSong(songData);
    } finally {
      if (loadingRef.current === id) loadingRef.current = null;
    }
  }, []);

  // ── Member: apply host config ──────────────────────────────────────────────
  useEffect(() => {
    if (!isFollowing || !latestConfig) return;
    const p = playerRef.current;
    const cfg = latestConfig;

    if (cfg.songId && cfg.songId !== p.song?.id) {
      loadSongById(cfg.songId).catch(() => {});
    }
    if (cfg.bpm && cfg.bpm !== p.bpm) {
      p.handleBpmChange(cfg.bpm);
    }
    if (typeof cfg.playing === "boolean") {
      if (cfg.playing) {
        if (typeof cfg.beat === "number") p.handleScrub(cfg.beat);
        p.startPlayback();
      } else {
        p.pausePlayback();
      }
    } else if (typeof cfg.beat === "number") {
      p.handleScrub(cfg.beat);
    }
  }, [isFollowing, latestConfig, loadSongById]);

  return { loadSongById };
}
