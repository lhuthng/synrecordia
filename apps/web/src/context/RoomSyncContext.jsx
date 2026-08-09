/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { motion as Motion, AnimatePresence } from "motion/react";
import { useRealtimeRoom } from "../hooks/useRealtimeRoom";

const RoomSyncContext = createContext(null);

let logId = 0;

/** Describe a config diff as a short human-readable room-log line. */
function describeConfigChange(prev, next) {
  const parts = [];
  if (next.songId && next.songId !== prev?.songId) {
    parts.push("changed song");
  }
  if (next.bpm && next.bpm !== prev?.bpm) {
    parts.push(`set BPM to ${next.bpm}`);
  }
  if (typeof next.playing === "boolean" && next.playing !== prev?.playing) {
    parts.push(next.playing ? "started playback" : "paused");
  } else if (
    typeof next.beat === "number" &&
    !next.playing &&
    next.beat !== prev?.beat
  ) {
    parts.push(`seeked to beat ${Math.round(next.beat)}`);
  }
  if (parts.length === 0) parts.push("updated settings");
  return parts.join(", ");
}

export function RoomSyncProvider({ children }) {
  const [session, setSession] = useState(null); // { roomId, role, name }
  const [latestConfig, setLatestConfig] = useState(null);
  const [log, setLog] = useState([]);
  const [toast, setToast] = useState(null);
  const configRef = useRef(null);
  const toastTimerRef = useRef(null);

  const pushLog = useCallback((text, kind = "info") => {
    setLog((l) => [...l.slice(-49), { id: ++logId, text, kind, at: Date.now() }]);
  }, []);

  const showToast = useCallback((text) => {
    setToast({ id: ++logId, text });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const room = useRealtimeRoom({
    roomId: session?.roomId ?? undefined,
    role: session?.role ?? "member",
    name: session?.name ?? "guest",
    onConfig: (cfg) => {
      const prev = configRef.current;
      setLatestConfig(cfg);
      configRef.current = cfg;
      const msg = describeConfigChange(prev, cfg);
      pushLog(msg);
      showToast(msg);
    },
    onBroadcast: (data) => {
      const text = typeof data === "string" ? data : JSON.stringify(data);
      pushLog(`message: ${text}`, "broadcast");
    },
    onLeave: (data) => {
      const text = typeof data === "string" ? data : "host left; room closed";
      pushLog(text, "warning");
    },
  });

  const { send } = room;

  const joinRoom = useCallback((roomId, role, name) => {
    setLog([]);
    setLatestConfig(null);
    configRef.current = null;
    setSession({ roomId, role, name });
  }, []);

  const leaveRoom = useCallback(() => {
    send("leave", {});
    setSession(null);
    setLatestConfig(null);
    configRef.current = null;
    setLog([]);
  }, [send]);

  const isInRoom = session !== null;
  const isHost = session !== null ? room.isHost : false;
  const isFollowing = isInRoom && !isHost;

  // Seed latestConfig from the state snapshot so a newly joined member resyncs
  // to the host's current config without needing a fresh config push.
  useEffect(() => {
    if (room.state?.config && configRef.current === null) {
      configRef.current = room.state.config;
      setLatestConfig(room.state.config);
    }
  }, [room.state]);

  const members = useMemo(() => {
    if (!room.state?.members) return [];
    return Object.values(room.state.members);
  }, [room.state]);

  const value = {
    isInRoom,
    isHost,
    isFollowing,
    roomId: session?.roomId ?? null,
    status: room.status,
    error: room.error,
    members,
    log,
    latestConfig,
    myMemberId: room.myMemberId,
    updateConfig: room.updateConfig,
    joinRoom,
    leaveRoom,
  };

  return (
    <RoomSyncContext.Provider value={value}>
      {children}

      {/* Global "host changed something" toast */}
      <AnimatePresence>
        {toast && (
          <Motion.div
            key={toast.id}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] pointer-events-none"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
          >
            <div className="flex items-center gap-2 rounded-lg bg-note-half border-2 border-note-full-dark px-3 py-2 text-sm font-semibold text-main shadow-lg">
              <span aria-hidden>♪</span>
              <span className="capitalize">{toast.text}</span>
            </div>
          </Motion.div>
        )}
      </AnimatePresence>
    </RoomSyncContext.Provider>
  );
}

export function useRoom() {
  const ctx = useContext(RoomSyncContext);
  if (!ctx) {
    throw new Error("useRoom must be used within <RoomSyncProvider>");
  }
  return ctx;
}
