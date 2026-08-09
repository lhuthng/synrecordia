import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useRealtimeRoom — minimal WebSocket room client (feature-flagged).
 *
 * Connects to the relay at /ws/<roomId>, manages reconnection with exponential
 * backoff + jitter, and re-subscribes (rejoin) after ECS task replacement.
 *
 * This is a plumbing stub: it proves the connect/reconnect/state-resync path
 * end-to-end. The full multiplayer UX (host config UI, live sync) is later work.
 *
 * Enabled only when import.meta.env.VITE_ENABLE_REALTIME === "true".
 */
const ENABLED = import.meta.env.VITE_ENABLE_REALTIME === "true";

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;

export function useRealtimeRoom({ roomId, role = "member", name = "" }) {
  const [status, setStatus] = useState("idle"); // idle|connecting|open|closed|error
  const [state, setState] = useState(null); // latest room state snapshot
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const timerRef = useRef(null);
  const connectRef = useRef(null);
  // Keep join metadata in refs so `connect` stays stable (avoids reconnect loops).
  const metaRef = useRef({ name, role, roomId });
  useEffect(() => {
    metaRef.current = { name, role, roomId };
  }, [name, role, roomId]);

  const buildUrl = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/${metaRef.current.roomId}`;
  }, []);

  const send = useCallback((type, data) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const roomId = metaRef.current.roomId;
    ws.send(JSON.stringify({ type, roomId, data }));
    return true;
  }, []);

  const connect = useCallback(() => {
    if (!ENABLED || !metaRef.current.roomId) return;
    setStatus("connecting");
    const ws = new WebSocket(buildUrl());
    wsRef.current = ws;
    const roomId = metaRef.current.roomId;

    ws.onopen = () => {
      retryRef.current = 0; // reset backoff on successful connect
      setStatus("open");
      setError(null);
      send("join", { name: metaRef.current.name, role: metaRef.current.role });
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "state") setState(msg.data);
        if (msg.type === "error") setError(msg.data);
        if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong", roomId }));
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => setStatus("error");

    ws.onclose = () => {
      wsRef.current = null;
      // Exponential backoff + jitter, then rejoin (resync from Redis snapshot).
      const delay = Math.min(RETRY_BASE_MS * 2 ** retryRef.current, RETRY_MAX_MS) +
        Math.floor(Math.random() * 500);
      retryRef.current += 1;
      setStatus("closed");
      timerRef.current = setTimeout(() => connectRef.current && connectRef.current(), delay);
    };
  }, [buildUrl, send]);

  useEffect(() => {
    if (!ENABLED) return;
    connectRef.current = connect;
    connect();
    return () => {
      connectRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null; // avoid scheduling reconnect during unmount
        ws.close();
      }
      wsRef.current = null;
    };
  }, [connect]);

  // Host can push config; server only accepts this from the actual host.
  const updateConfig = useCallback(
    (config) => send("config", config),
    [send],
  );

  return { status, state, error, send, updateConfig };
}
