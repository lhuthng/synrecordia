import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { GlowFilter } from "pixi-filters";
import fingeringChart from "../assets/references/fingering-chart.json";

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 400;

const noteNameToMidi = (name) => {
  const match = name.match(/^([A-G])(#?)(-?\d+)$/);
  if (!match) return 0;
  const [, letter, sharp, octaveStr] = match;
  const octave = Number(octaveStr);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter] ?? 0;
  return (octave + 1) * 12 + base + (sharp ? 1 : 0);
};

const getHighestNote = (notes) => {
  if (Array.isArray(notes)) {
    return notes.reduce((best, current) => {
      return noteNameToMidi(current) > noteNameToMidi(best) ? current : best;
    }, notes[0]);
  }
  return notes;
};

const selectFingering = (noteName, system, preferSystem) => {
  const map = fingeringChart?.systems?.[system] ?? {};
  const entry = map[noteName];
  if (!entry) return null;
  if (typeof entry === "string") return entry;

  if (entry[preferSystem]) return entry[preferSystem];
  if (entry.I) return entry.I;
  const firstKey = Object.keys(entry)[0];
  return firstKey ? entry[firstKey] : null;
};

const getBeatsPerBar = (timeSignature) => {
  if (!timeSignature || typeof timeSignature !== "string") return 4;
  const [numeratorText, denominatorText] = timeSignature.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);

  if (!numerator || !denominator) return 4;

  return numerator * (4 / denominator);
};

const cssColorToPixiHex = (value, fallback) => {
  if (!value || typeof value !== "string") return fallback;
  const color = value.trim();

  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return Number.parseInt(color.slice(1), 16);
  }

  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [r, g, b] = color.slice(1).split("");
    return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
  }

  const rgbMatch = color.match(
    /^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(?:[01](?:\.\d+)?|\.\d+))?\s*\)$/i,
  );
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbMatch[1])));
    const g = Math.max(0, Math.min(255, Number(rgbMatch[2])));
    const b = Math.max(0, Math.min(255, Number(rgbMatch[3])));
    return (r << 16) + (g << 8) + b;
  }

  return fallback;
};

const getFingeringColors = () => {
  const fallbackFull = 0x2ecc71;
  const fallbackHalf = 0x3498db;

  if (typeof window === "undefined") {
    return { 1: fallbackFull, h: fallbackHalf };
  }

  const styles = getComputedStyle(document.documentElement);
  const full = cssColorToPixiHex(
    styles.getPropertyValue("--color-note-full"),
    fallbackFull,
  );
  const half = cssColorToPixiHex(
    styles.getPropertyValue("--color-note-half"),
    fallbackHalf,
  );

  return { 1: full, h: half };
};

const NUM_HOLES = 8;
const NOTE_GLOW_PADDING = 16;
const HOLE_SIZE = { x: 12, y: 18 };

// 7 gaps between 8 holes (multipliers of size.y)
// [thumb→L1, L1→L2, L2→L3, L3→L4, L4→R1, R1→R2, R2→R3]
const FINGERING_GAPS = [2, 0.25, 0.25, 2, 0.25, 0.25, 0.25];

const getHolePositions = (rectHeight) => {
  const positions = [0];
  for (let i = 0; i < FINGERING_GAPS.length; i += 1) {
    const prev = positions[positions.length - 1];
    positions.push(prev + rectHeight + FINGERING_GAPS[i] * rectHeight);
  }
  return positions;
};

const drawFingering = (container, fingering, size, xPadding, colors) => {
  const rectWidth = size.x * 1.2;
  const rectHeight = size.y;
  const positions = getHolePositions(rectHeight);
  const totalHeight = positions[NUM_HOLES - 1] + rectHeight;

  for (let i = 0; i < NUM_HOLES; i += 1) {
    const y = positions[i];

    const state = fingering[i];
    if (!state || state === "0") continue;
    const color = colors[state];
    if (!color) continue;

    const segment = new PIXI.Graphics();
    segment.roundRect(xPadding, y, rectWidth - xPadding, rectHeight, 4);
    segment.fill({ color });
    segment.filters = [
      new GlowFilter({
        distance: 8,
        outerStrength: 1.05,
        innerStrength: 0.15,
        color,
        quality: 0.2,
        knockout: false,
      }),
    ];
    container.addChild(segment);
  }

  return {
    width: rectWidth,
    height: totalHeight,
  };
};

export default function Visualizer({
  song,
  currentBeat = 0,
  durationBeats = 0,
  isPlaying = false,
  bpm = 120,
  fingeringSystem = "recorder",
  baroque = true,
  noteWidth = 70,
  height = DEFAULT_HEIGHT,
  onScrubStart,
  onScrub,
  onNoteClick,
  onPlayPause,
}) {
  const wrapperRef = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_WIDTH);
  const width = canvasWidth;
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const noteSpritesRef = useRef([]);
  const currentBeatRef = useRef(currentBeat);
  const displayBeatRef = useRef(currentBeat);
  const bpmRef = useRef(bpm);
  const isPlayingRef = useRef(isPlaying);
  const lastFrameTimeRef = useRef(0);
  const pixelsPerBeatRef = useRef(noteWidth);
  const barXRef = useRef(0);
  const guideLayerRef = useRef(null);
  const holesLayerRef = useRef(null);
  const notesLayerRef = useRef(null);
  const playBarLayerRef = useRef(null);
  const buildGuidesRef = useRef(null);
  const buildSpritesRef = useRef(null);
  const mouseDownRef = useRef(false);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    if (!wrapperRef.current) return;
    let timeoutId;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const newWidth = Math.floor(entry.contentRect.width);
      if (newWidth > 0) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => setCanvasWidth(newWidth), 80);
      }
    });
    observer.observe(wrapperRef.current);
    return () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
  }, []);

  const hasDraggedRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartBeatRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isHoveringNote, setIsHoveringNote] = useState(false);

  useEffect(() => {
    currentBeatRef.current = currentBeat;
    displayBeatRef.current = currentBeat;
    lastFrameTimeRef.current = performance.now();
  }, [currentBeat]);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const noteEvents = useMemo(() => {
    if (!song || !Array.isArray(song.tracks)) return [];
    const recorderTrack =
      song.tracks.find((track) => track.instrument === "recorder") ??
      song.tracks[0];

    if (!recorderTrack || !Array.isArray(recorderTrack.actions)) return [];

    const prefer = baroque ? "B" : "G";

    return recorderTrack.actions
      .filter((action) => action.type === "note")
      .map((action) => {
        const noteName = getHighestNote(action.pitches ?? action.pitch);
        if (!noteName) return null;
        const fingering = selectFingering(noteName, fingeringSystem, prefer);
        if (!fingering) return null;
        return {
          time: action.time ?? 0,
          duration: action.duration ?? 0,
          note: noteName,
          fingering,
        };
      })
      .filter(Boolean);
  }, [song, fingeringSystem, baroque]);

  useEffect(() => {
    pixelsPerBeatRef.current = noteWidth;
    buildSpritesRef.current?.();
  }, [noteWidth]);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let ticker = null;
    let tick = null;

    const init = async () => {
      const app = new PIXI.Application();
      const canvasEl = document.createElement("canvas");
      await app.init({
        width,
        height,
        backgroundAlpha: 0,
        antialias: true,
        canvas: canvasEl,
      });

      if (cancelled) {
        app.destroy(true, { children: true });
        return;
      }

      appRef.current = app;
      if (containerRef.current) {
        containerRef.current.appendChild(canvasEl);
      }

      const barX = width - 12;
      barXRef.current = barX;
      const beatsPerBar = getBeatsPerBar(song?.timeSignature);
      const guideLayer = new PIXI.Container();
      guideLayerRef.current = guideLayer;
      const holesLayer = new PIXI.Container();
      holesLayerRef.current = holesLayer;
      const notesLayer = new PIXI.Container();
      notesLayerRef.current = notesLayer;
      const playBarLayer = new PIXI.Container();
      playBarLayerRef.current = playBarLayer;

      app.stage.addChild(guideLayer);
      app.stage.addChild(holesLayer);
      app.stage.addChild(notesLayer);
      app.stage.addChild(playBarLayer);

      const holePositions = getHolePositions(HOLE_SIZE.y);
      const holesTop =
        (height - (holePositions[NUM_HOLES - 1] + HOLE_SIZE.y)) / 2;
      for (let i = 0; i < NUM_HOLES; i += 1) {
        const cy = holesTop + holePositions[i] + HOLE_SIZE.y / 2;
        const holeLine = new PIXI.Graphics();
        holeLine.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.15 });
        holeLine.moveTo(0, cy);
        holeLine.lineTo(width, cy);
        holeLine.stroke();
        holesLayer.addChild(holeLine);
      }

      const buildGuides = () => {
        guideLayer.removeChildren();

        const pixelsPerBeat = pixelsPerBeatRef.current || 1;
        const startBar = Math.floor(
          Math.max(0, currentBeatRef.current - width / pixelsPerBeat) /
            beatsPerBar,
        );
        const endBar = Math.ceil(
          (Math.max(durationBeats, currentBeatRef.current) +
            width / pixelsPerBeat) /
            beatsPerBar,
        );

        for (let barIndex = startBar; barIndex <= endBar; barIndex += 1) {
          const barBeat = barIndex * beatsPerBar;
          const barLine = new PIXI.Graphics();
          barLine.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.35 });
          barLine.moveTo(0, 0);
          barLine.lineTo(0, height);
          barLine.stroke();
          guideLayer.addChild(barLine);

          const barLabel = new PIXI.Text({
            text: String(barIndex + 1) + " ",
            style: {
              fill: 0xffffff,
              fontSize: 12,
              fontFamily: "Arial",
              align: "right",
            },
          });
          barLabel.anchor.set(1, 0);
          barLabel.offsetX = -10;
          barLabel.y = 6;
          guideLayer.addChild(barLabel);

          for (let beatIndex = 1; beatIndex < beatsPerBar; beatIndex += 1) {
            const beatBeat = barBeat + beatIndex;
            const beatLine = new PIXI.Graphics();
            beatLine.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.15 });
            beatLine.moveTo(0, 0);
            beatLine.lineTo(0, height);
            beatLine.stroke();
            guideLayer.addChild(beatLine);
            beatLine.beatTime = beatBeat;
          }

          barLine.beatTime = barBeat;
          barLabel.beatTime = barBeat;
        }

        if (playBarLayerRef.current) {
          playBarLayerRef.current.removeChildren();

          const playBar = new PIXI.Graphics();
          playBar.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.9 });
          playBar.moveTo(barX, 0);
          playBar.lineTo(barX, height);
          playBar.stroke();
          playBar.filters = [
            new GlowFilter({
              distance: 14,
              outerStrength: 2.2,
              innerStrength: 0.4,
              color: 0xffffff,
              quality: 0.2,
              knockout: false,
            }),
          ];
          playBarLayerRef.current.addChild(playBar);
        }
      };

      const buildSprites = () => {
        notesLayer.removeChildren();
        noteSpritesRef.current = [];

        const fingeringColors = getFingeringColors();

        noteEvents.forEach((event) => {
          const graphics = new PIXI.Container();
          const durationForWidth = Math.max(event.duration ?? 0, 0);
          const targetWidth = Math.max(
            durationForWidth * (pixelsPerBeatRef.current || 1),
            6,
          );

          const dims = drawFingering(
            graphics,
            event.fingering,
            { x: targetWidth / 1.2, y: HOLE_SIZE.y },
            2,
            fingeringColors,
          );
          const container = new PIXI.Container();

          const scaledGraphicsWidth = dims.width;

          const containerOffsetY = (height - dims.height) / 2;
          const hoverBg = new PIXI.Graphics();
          hoverBg.rect(0, -containerOffsetY, scaledGraphicsWidth, height);
          hoverBg.fill({ color: 0xffffff, alpha: 1 });
          hoverBg.alpha = 0;

          const label = new PIXI.Text({
            text: event.note,
            style: {
              fill: 0xffffff,
              fontSize: 14,
              fontFamily: "Arial",
            },
          });
          label.x = Math.max((scaledGraphicsWidth - label.width) / 2, 0);
          label.y = -22;

          container.addChild(hoverBg);
          container.addChild(label);
          container.addChild(graphics);

          const hoverState = { targetAlpha: 0 };
          container.eventMode = "static";
          container.hitArea = new PIXI.Rectangle(0, 0, dims.width, dims.height);
          container.on("pointerover", () => {
            if (isPlayingRef.current) return;
            hoverState.targetAlpha = 0.07;
            setIsHoveringNote(true);
          });
          container.on("pointerout", () => {
            hoverState.targetAlpha = 0;
            setIsHoveringNote(false);
          });
          container.on("pointerup", () => {
            if (hasDraggedRef.current || isPlayingRef.current) return;
            onNoteClick?.({ note: event.note, duration: event.duration });
          });

          container.y = (height - dims.height) / 2;
          notesLayer.addChild(container);
          noteSpritesRef.current.push({
            container,
            time: event.time,
            width: scaledGraphicsWidth,
            duration: durationForWidth,
            baseWidth: durationForWidth,
            graphics,
            label,
            hoverBg,
            hoverState,
            glowPadding: NOTE_GLOW_PADDING,
          });
        });
      };

      buildGuidesRef.current = buildGuides;
      buildSpritesRef.current = buildSprites;
      buildGuides();
      buildSprites();

      ticker = app.ticker ?? PIXI.Ticker.shared;
      tick = () => {
        const beat = currentBeatRef.current ?? 0;

        guideLayer.children.forEach((child) => {
          if (typeof child.beatTime !== "number") return;
          const x =
            (barXRef.current || barX) +
            (beat - child.beatTime) * (pixelsPerBeatRef.current || 1);
          const rightEdge = x + child.width;
          child.x = x;
          child.visible = rightEdge > 0 && x < width;
        });

        noteSpritesRef.current.forEach((sprite) => {
          const x =
            (barXRef.current || barX) -
            sprite.width +
            (beat - sprite.time) * (pixelsPerBeatRef.current || 1);
          const glowPadding = Number(sprite.glowPadding ?? 0);
          const leftEdgeWithGlow = x - glowPadding;
          const rightEdgeWithGlow = x + sprite.width + glowPadding;
          sprite.container.x = x;
          sprite.container.visible =
            rightEdgeWithGlow > 0 && leftEdgeWithGlow < width;
          if (sprite.hoverBg && sprite.hoverState) {
            sprite.hoverBg.alpha +=
              (sprite.hoverState.targetAlpha - sprite.hoverBg.alpha) * 0.2;
          }
        });
      };
      ticker.add(tick);
    };

    init();

    return () => {
      cancelled = true;
      if (ticker && tick) {
        ticker.remove(tick);
      }
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      noteSpritesRef.current = [];
    };
  }, [noteEvents, width, height, durationBeats, song?.timeSignature]);

  useEffect(() => {
    if (!appRef.current) return;
    appRef.current.renderer.resize(width, height);
  }, [width, height]);

  const handleDragStart = useCallback((e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    dragStartXRef.current = clientX;
    dragStartBeatRef.current = currentBeatRef.current;
    mouseDownRef.current = true;
    hasDraggedRef.current = false;
    isDraggingRef.current = false;
  }, []);

  const handleDragMove = useCallback(
    (e) => {
      if (!mouseDownRef.current) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const deltaX = clientX - dragStartXRef.current;
      if (!isDraggingRef.current) {
        if (Math.abs(deltaX) <= 4) return;
        isDraggingRef.current = true;
        hasDraggedRef.current = true;
        setIsDragging(true);
        onScrubStart?.();
      }
      const deltaBeat = deltaX / (pixelsPerBeatRef.current || 1);
      const newBeat = Math.max(0, dragStartBeatRef.current + deltaBeat);
      onScrub?.(newBeat);
    },
    [onScrub, onScrubStart],
  );

  const handleDragEnd = useCallback(() => {
    mouseDownRef.current = false;
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  const cursor = isDragging
    ? "grabbing"
    : isHoveringNote && !isPlaying
      ? "pointer"
      : "grab";

  return (
    <div ref={wrapperRef} style={{ width: "100%", height }}>
      <div
        ref={containerRef}
        style={{ width, height, cursor }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.code === "Space") {
            e.preventDefault();
            onPlayPause?.();
          }
        }}
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        onTouchStart={handleDragStart}
        onTouchMove={handleDragMove}
        onTouchEnd={handleDragEnd}
      />
    </div>
  );
}
