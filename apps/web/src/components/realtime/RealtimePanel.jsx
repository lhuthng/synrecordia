import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion as Motion } from "motion/react";
import DuoButton from "../ui/DuoButton";
import { useRoom } from "../../context/RoomSyncContext";

const STATUS_META = {
  idle: { label: "Idle", cls: "bg-main/40" },
  connecting: { label: "Connecting…", cls: "bg-yellow-400" },
  open: { label: "Connected", cls: "bg-note-full" },
  closed: { label: "Reconnecting…", cls: "bg-yellow-400" },
  error: { label: "Error", cls: "bg-accent-pink" },
};

function InRoomView({ onClose }) {
  const room = useRoom();
  const status = STATUS_META[room.status] ?? STATUS_META.idle;

  const members = room.members;
  const hostId = members.find((m) => m.role === "host")?.memberId;

  return (
    <div className="grid gap-3">
      {/* Room header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${status.cls}`} />
            <span className="font-bold uppercase text-main text-base">
              {room.isHost ? "Hosting" : "Following"}
            </span>
          </div>
          <div className="font-mono text-sm text-main/70 truncate">
            /ws/{room.roomId}
          </div>
        </div>
        <DuoButton
          padding="px-3 py-1.5"
          background="bg-accent-pink/90"
          shadowBackground="bg-accent-pink-dark"
          border="border-accent-pink-dark"
          text="text-dark"
          onClick={() => {
            room.leaveRoom();
            onClose();
          }}
        >
          Leave
        </DuoButton>
      </div>

      {room.error && (
        <p className="text-sm text-accent-pink break-words">
          {typeof room.error === "string"
            ? room.error
            : JSON.stringify(room.error)}
        </p>
      )}

      {/* Members */}
      <section>
        <h3 className="text-sm font-bold uppercase text-main/70 mb-2">
          Members ({members.length})
        </h3>
        {members.length === 0 ? (
          <p className="text-sm text-main/40">Waiting for state…</p>
        ) : (
          <ul className="space-y-1.5">
            {members.map((m) => {
              const isMe = m.memberId === room.myMemberId;
              const isHost = m.role === "host";
              return (
                <li
                  key={m.memberId}
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border-2 text-base ${
                    isMe
                      ? "bg-note-full/20 border-note-full/60"
                      : "bg-note-half border-note-half-dark"
                  }`}
                >
                  <span className="font-semibold text-main truncate">
                    {m.name || "guest"}
                    {isMe && <span className="text-main/50 ml-1">(you)</span>}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-note-full text-dark">
                    {isHost ? "host" : "member"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {hostId && room.myMemberId !== hostId && (
          <p className="mt-2 text-sm text-main/50">
            You&apos;re following the host — playback controls are locked.
          </p>
        )}
      </section>

      {/* Room log */}
      <section className="border-t border-note-half-dark pt-2">
        <h3 className="text-sm font-bold uppercase text-main/70 mb-2">
          Room activity
        </h3>
        {room.log.length === 0 ? (
          <p className="text-sm text-main/40">No activity yet.</p>
        ) : (
          <ul className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-0.5">
            {room.log.map((entry) => (
              <li key={entry.id} className="text-sm text-main/75 flex gap-2">
                <span className="text-main/40 shrink-0 font-mono">
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
                <span className="truncate">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function JoinForm({ onClose }) {
  const room = useRoom();
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [create, setCreate] = useState(true);

  const submit = (e) => {
    e.preventDefault();
    if (!roomId.trim()) return;
    room.joinRoom(roomId.trim(), create ? "host" : "member", name.trim());
    onClose();
  };

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-main/40" />
        <span className="font-bold uppercase text-main text-base">
          Live room
        </span>
      </div>
      <p className="text-sm text-main/70">
        Create a room to host (everyone follows you), or join one by its id.
      </p>

      <label className="grid gap-1.5">
        <span className="text-sm font-bold uppercase text-main">
          Your name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="bg-note-half border-2 border-note-half-dark rounded-xl px-3 py-2 text-base text-main placeholder:text-main focus:outline-main"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-bold uppercase text-main">
          Room id
        </span>
        <input
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="e.g. jam-2026"
          className="bg-note-half border-2 border-note-half-dark rounded-xl px-3 py-2 text-base text-main placeholder:text-main focus:outline-main"
        />
      </label>

      <div className="flex gap-2">
        {[
          { key: true, label: "Create" },
          { key: false, label: "Join" },
        ].map((opt) => (
          <button
            key={String(opt.key)}
            type="button"
            onClick={() => setCreate(opt.key)}
            className={`flex-1 px-3 py-1.5 rounded-xl border-2 text-sm font-bold uppercase transition-colors cursor-pointer ${
              create === opt.key
                ? "bg-note-full border-note-full-dark text-dark"
                : "bg-transparent border-note-half-dark text-main/60 hover:text-main"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <DuoButton
        padding="px-3 py-2"
        background="bg-note-full"
        shadowBackground="bg-note-full-dark"
        border="border-note-full-dark"
        text="text-dark"
      >
        Enter room
      </DuoButton>
    </form>
  );
}

export default function RealtimePanel() {
  const room = useRoom();
  const [open, setOpen] = useState(false);
  const ref = useRef(null); // trigger wrapper
  const popRef = useRef(null); // popover (portaled to body)
  const [pos, setPos] = useState(null); // { top, right } viewport coords

  // Compute the popover's viewport position from the trigger, and keep it
  // pinned while open (handles resize/scroll).
  useEffect(() => {
    if (!open) return;
    let raf;
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    };
    // Defer the initial measure out of the synchronous effect body.
    raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      const insideTrigger = ref.current?.contains(e.target);
      const insidePop = popRef.current?.contains(e.target);
      if (!insideTrigger && !insidePop) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const triggerLabel = room.isInRoom
    ? room.isHost
      ? "Hosting"
      : "Following"
    : "Rooms";
  const dotCls = room.isInRoom ? "bg-note-full" : "bg-main/30";

  return (
    <div ref={ref} className="relative">
      {/* Raised shadow layer — matches the DuoSelect trigger look */}
      <div className="absolute inset-0 translate-y-0.5 rounded-2xl z-0 bg-note-half-dark" />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative z-10 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-2xl border-2 border-note-half-dark bg-note-half text-main font-bold uppercase tracking-wide cursor-pointer transition-all duration-75 hover:brightness-110 active:translate-y-0.5 focus:outline-main"
      >
        <span className={`inline-block w-2 h-2 rounded-full ${dotCls}`} />
        <span className="hidden sm:inline">{triggerLabel}</span>
        <svg
          viewBox="0 0 24 24"
          className={`w-3.5 h-3.5 fill-none stroke-current stroke-2 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Portaled popover — rendered at <body> level with a high z-index so it
          always stacks above the page content (Player / device button) instead
          of being clipped behind the header's stacking context. */}
      {open &&
        pos &&
        createPortal(
          <Motion.div
            ref={popRef}
            role="dialog"
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-[100] w-80 max-w-[calc(100dvw-2rem)] border-2 border-note-half-dark bg-dark rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.55)] p-4"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            {room.isInRoom ? (
              <InRoomView onClose={() => setOpen(false)} />
            ) : (
              <JoinForm onClose={() => setOpen(false)} />
            )}
          </Motion.div>,
          document.body,
        )}
    </div>
  );
}
