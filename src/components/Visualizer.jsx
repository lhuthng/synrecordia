import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { ColorMatrixFilter } from "pixi.js";
import { GlowFilter } from "pixi-filters";
import fingeringChart from "../assets/references/fingering-chart.json";

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 400;
export const FADE_MS = 500;

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

const brightenColor = (hex, factor) => {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((hex & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
};

const lerpColor = (from, to, t) => {
  const r = Math.round(
    ((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * t,
  );
  const g = Math.round(
    ((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * t,
  );
  const b = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * t);
  return (r << 16) | (g << 8) | b;
};

const ZONE_COLOR = 0x444444;
const MAX_PARTICLES = 400;
const PARTICLE_RADIUS = 2.5;
const PARTICLE_LIFETIME_MIN = 0.5;
const PARTICLE_LIFETIME_MAX = 0.9;
const PARTICLE_SPAWN_CHANCE = 0.2;

const darken = (hex, factor = 0.7) => {
  const r = Math.round(((hex >> 16) & 0xff) * factor);
  const g = Math.round(((hex >> 8) & 0xff) * factor);
  const b = Math.round((hex & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
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

  return { 1: full, d1: darken(full, 0.8), h: half, dh: darken(half, 0.8) };
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

const HOLE_PLAY_SCALE = 1.18;
const HOLE_SCALE_ALPHA = 0.18;

const drawFingering = (container, fingering, size, xPadding, colors) => {
  const rectWidth = size.x * 1.2;
  const rectHeight = size.y;
  const positions = getHolePositions(rectHeight);
  const totalHeight = positions[NUM_HOLES - 1] + rectHeight;

  container.holeSprites = [];

  for (let i = 0; i < NUM_HOLES; i += 1) {
    const y = positions[i];

    const state = fingering[i];
    if (!state || state === "0") continue;
    const color = colors[state];
    const darkColor = colors["d" + state];
    if (!color) continue;

    const holeContainer = new PIXI.Container();
    holeContainer.x = xPadding;
    holeContainer.y = y + rectHeight / 2;

    const segment = new PIXI.Graphics();
    segment.roundRect(
      0,
      -rectHeight / 2,
      rectWidth - xPadding,
      rectHeight - 2,
      4,
    );
    segment.fill({ color });

    const shadow = new PIXI.Graphics();
    shadow.roundRect(0, -rectHeight / 2, rectWidth - xPadding, rectHeight, 4);
    shadow.fill({ color: darkColor });
    shadow.filters = [
      new GlowFilter({
        distance: 8,
        outerStrength: 1.05,
        innerStrength: 0.15,
        color: darkColor,
        quality: 0.2,
        knockout: false,
      }),
    ];

    holeContainer.addChild(shadow);
    holeContainer.addChild(segment);

    holeContainer.scale.y = 1;

    // add to parent container and record for animation
    container.addChild(holeContainer);
    container.holeSprites.push(holeContainer);
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
  playBarPosition = 0.95,
  onScrubStart,
  onScrub,
  onNoteClick,
  onPlayPause,
  onPlayBarPositionChange,
}) {
  const wrapperRef = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_WIDTH);
  const width = canvasWidth;
  const canvasWidthRef = useRef(canvasWidth);
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const noteSpritesRef = useRef([]);
  const currentBeatRef = useRef(currentBeat);
  const displayBeatRef = useRef(currentBeat);
  // targetBeatRef: holds the external target beat for the visual display.
  // The ticker interpolates `displayBeatRef` toward this target to produce
  // smooth scrolling without snapping when the player updates the beat.
  const targetBeatRef = useRef(currentBeat);
  const bpmRef = useRef(bpm);
  const isPlayingRef = useRef(isPlaying);
  const durationBeatsRef = useRef(durationBeats);
  const lastFrameTimeRef = useRef(0);
  const pixelsPerBeatRef = useRef(noteWidth);
  const barXRef = useRef(0);
  const playBarPositionRef = useRef(playBarPosition);
  const particleLayerRef = useRef(null);
  const particlesRef = useRef([]);
  const particleTextureRef = useRef(null);
  const onNoteClickRef = useRef(onNoteClick);
  const guideLayerRef = useRef(null);
  const holesLayerRef = useRef(null);
  const notesLayerRef = useRef(null);
  const playBarLayerRef = useRef(null);
  // PIXI scroll layer ref
  const scrollLayerRef = useRef(null);
  const buildGuidesRef = useRef(null);
  const buildPlayBarRef = useRef(null);
  const buildSpritesRef = useRef(null);
  const buildZonesRef = useRef(null);
  const mouseDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const playBarHoveredRef = useRef(false);
  const isPlayBarDraggingRef = useRef(false);
  const dragStartPlayBarPositionRef = useRef(0);

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
  const [isHoveringPlayBar, setIsHoveringPlayBar] = useState(false);
  const [isPlayBarDragging, setIsPlayBarDragging] = useState(false);
  const [songState, setSongState] = useState({
    displaySong: song,
    isReady: false,
  });
  const { displaySong, isReady } = songState;

  useEffect(() => {
    if (song?.id && displaySong?.id === song.id) return;

    const t = setTimeout(
      () => setSongState({ displaySong: song, isReady: false }),
      FADE_MS,
    );
    return () => clearTimeout(t);
  }, [song, displaySong?.id]);

  useEffect(() => {
    onNoteClickRef.current = onNoteClick;
  }, [onNoteClick]);

  useEffect(() => {
    currentBeatRef.current = currentBeat;
    targetBeatRef.current = currentBeat;
    if (!isPlayingRef.current) {
      displayBeatRef.current = currentBeat;
    }
    lastFrameTimeRef.current = performance.now();
  }, [currentBeat]);

  useEffect(() => {
    const beatsPerBar = getBeatsPerBar(song?.timeSignature);
    const lastBarBeat =
      beatsPerBar > 0
        ? Math.ceil(durationBeats / beatsPerBar) * beatsPerBar
        : durationBeats;
    durationBeatsRef.current = lastBarBeat;
    buildGuidesRef.current?.();
  }, [durationBeats, song?.timeSignature]);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const noteEvents = useMemo(() => {
    if (!displaySong || !Array.isArray(displaySong.tracks)) return [];
    const recorderTrack =
      displaySong.tracks.find((track) => track.instrument === "recorder") ??
      displaySong.tracks[0];

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
  }, [displaySong, fingeringSystem, baroque]);

  useEffect(() => {
    // snap scroll to new pixel scale
    pixelsPerBeatRef.current = noteWidth;
    buildGuidesRef.current?.();
    buildZonesRef.current?.();
    buildSpritesRef.current?.();

    const scrollLayer = scrollLayerRef.current;
    if (scrollLayer) {
      const bx = barXRef.current || 0;
      const beat = displayBeatRef.current || 0;
      const pxPerBeat = pixelsPerBeatRef.current || 1;
      scrollLayer.x = bx + beat * pxPerBeat;
    }
  }, [noteWidth]);

  useEffect(() => {
    canvasWidthRef.current = canvasWidth;
  }, [canvasWidth]);

  useEffect(() => {
    playBarPositionRef.current = playBarPosition;
    barXRef.current = Math.round(canvasWidth * playBarPosition);
    buildPlayBarRef.current?.();
  }, [playBarPosition, canvasWidth]);

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

      const barX = Math.round(width * playBarPositionRef.current);
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
      const particleLayer = new PIXI.Container();
      particleLayerRef.current = particleLayer;

      const BIG = 1_000_000;

      const ptGfx = new PIXI.Graphics();
      ptGfx.circle(0, 0, PARTICLE_RADIUS);
      ptGfx.fill({ color: 0xffffff });
      particleTextureRef.current = app.renderer.generateTexture(ptGfx);
      ptGfx.destroy();

      const scrollLayer = new PIXI.Container();
      // store scroll layer ref
      scrollLayerRef.current = scrollLayer;
      const zonesLayer = new PIXI.Container();
      const leftZone = new PIXI.Graphics();
      const rightZone = new PIXI.Graphics();
      zonesLayer.addChild(leftZone);
      zonesLayer.addChild(rightZone);
      scrollLayer.addChild(zonesLayer);
      scrollLayer.addChild(guideLayer);
      scrollLayer.addChild(notesLayer);

      app.stage.addChild(holesLayer);
      app.stage.addChild(scrollLayer);
      app.stage.addChild(particleLayer);
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

      const buildZones = () => {
        const pxPerBeat = pixelsPerBeatRef.current || 1;
        const duration = durationBeatsRef.current ?? 0;

        leftZone.clear();
        rightZone.clear();
        if (duration > 0) {
          leftZone.rect(-BIG, 0, BIG, height);
          leftZone.fill({ color: ZONE_COLOR, alpha: 0.35 });
          leftZone.x = -duration * pxPerBeat;

          rightZone.rect(0, 0, BIG, height);
          rightZone.fill({ color: ZONE_COLOR, alpha: 0.35 });
          rightZone.x = 0;
        }
      };

      const buildGuides = () => {
        guideLayer.removeChildren();

        const lastBar = Math.ceil(
          (durationBeatsRef.current ?? 0) / beatsPerBar,
        );
        const startBar = 0;
        const endBar = lastBar;

        const pxPerBeat = pixelsPerBeatRef.current || 1;

        for (let barIndex = startBar; barIndex <= endBar; barIndex += 1) {
          const barBeat = barIndex * beatsPerBar;
          const barLine = new PIXI.Graphics();
          barLine.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.35 });
          barLine.moveTo(0, 0);
          barLine.lineTo(0, height);
          barLine.stroke();
          barLine.x = -barBeat * pxPerBeat;
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
          barLabel.y = 6;
          barLabel.x = -barBeat * pxPerBeat;
          guideLayer.addChild(barLabel);

          for (let beatIndex = 1; beatIndex < beatsPerBar; beatIndex += 1) {
            const beatBeat = barBeat + beatIndex;
            const beatLine = new PIXI.Graphics();
            beatLine.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.15 });
            beatLine.moveTo(0, 0);
            beatLine.lineTo(0, height);
            beatLine.stroke();
            beatLine.x = -beatBeat * pxPerBeat;
            guideLayer.addChild(beatLine);
          }
        }
      };

      const buildPlayBar = () => {
        if (!playBarLayerRef.current) return;
        const removed = playBarLayerRef.current.removeChildren();
        for (const child of removed) {
          child.destroy({ texture: true, children: true });
        }

        const styles = getComputedStyle(document.documentElement);
        const darkStr =
          styles.getPropertyValue("--color-dark").trim() || "#060a0c";
        const darkHex = cssColorToPixiHex(darkStr, 0x060a0c);
        const r = (darkHex >> 16) & 0xff;
        const g = (darkHex >> 8) & 0xff;
        const b = darkHex & 0xff;

        const gradWidth = Math.max(1, width - barXRef.current);
        const gradCanvas = document.createElement("canvas");
        gradCanvas.width = gradWidth;
        gradCanvas.height = 1;
        const ctx = gradCanvas.getContext("2d");
        const grad = ctx.createLinearGradient(0, 0, gradWidth, 0);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 1)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, gradWidth, 1);
        const gradTexture = PIXI.Texture.from(gradCanvas);
        const gradSprite = new PIXI.Sprite(gradTexture);
        gradSprite.x = barXRef.current;
        gradSprite.y = 0;
        gradSprite.width = gradWidth;
        gradSprite.height = height;
        playBarLayerRef.current.addChild(gradSprite);

        const pb = new PIXI.Graphics();
        pb.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.9 });
        pb.moveTo(barXRef.current, 0);
        pb.lineTo(barXRef.current, height);
        pb.stroke();
        pb.filters = [
          new GlowFilter({
            distance: 14,
            outerStrength: 2.2,
            innerStrength: 0.4,
            color: 0xffffff,
            quality: 0.2,
            knockout: false,
          }),
        ];
        pb.eventMode = "static";
        pb.hitArea = new PIXI.Rectangle(barXRef.current - 5, 0, 10, height);
        pb.on("pointerover", () => {
          playBarHoveredRef.current = true;
          setIsHoveringPlayBar(true);
        });
        pb.on("pointerout", () => {
          playBarHoveredRef.current = false;
          setIsHoveringPlayBar(false);
        });
        playBarLayerRef.current.addChild(pb);
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

          const holePositions = getHolePositions(HOLE_SIZE.y);
          const containerY = (height - dims.height) / 2;
          const activeHoles = [];
          for (let i = 0; i < NUM_HOLES; i += 1) {
            const state = event.fingering[i];
            if (!state || state === "0") continue;
            const color = fingeringColors[state];
            if (!color) continue;
            activeHoles.push({
              y: containerY + holePositions[i] + HOLE_SIZE.y / 2,
              color: brightenColor(color, 1.2),
            });
          }

          const container = new PIXI.Container();
          const brightnessFilter = new ColorMatrixFilter();
          graphics.filters = [brightnessFilter];
          const brightnessState = { current: 1.0, target: 1.0 };

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
            onNoteClickRef.current?.({
              note: event.note,
              duration: event.duration,
            });
          });

          container.x =
            -scaledGraphicsWidth - event.time * (pixelsPerBeatRef.current || 1);
          container.y = containerY;
          notesLayer.addChild(container);
          noteSpritesRef.current.push({
            container,
            time: event.time,
            width: scaledGraphicsWidth,
            duration: durationForWidth,
            baseWidth: durationForWidth,
            graphics,
            brightnessFilter,
            brightnessState,
            label,
            hoverBg,
            hoverState,
            activeHoles,
            // holeSprites references come from `drawFingering` (attached to graphics)
            holeSprites: graphics.holeSprites || [],
            glowPadding: NOTE_GLOW_PADDING,
          });
        });
        requestAnimationFrame(() => {
          if (!cancelled) setSongState((prev) => ({ ...prev, isReady: true }));
        });
      };

      buildGuidesRef.current = buildGuides;
      buildPlayBarRef.current = buildPlayBar;
      buildSpritesRef.current = buildSprites;
      buildZonesRef.current = buildZones;
      buildGuides();
      buildZones();
      buildPlayBar();
      buildSprites();

      ticker = app.ticker ?? PIXI.Ticker.shared;
      tick = (ticker) => {
        const now = performance.now();
        const elapsed = (now - lastFrameTimeRef.current) / 1000;
        const targetBeat = isPlayingRef.current
          ? (currentBeatRef.current ?? 0) +
            elapsed * ((bpmRef.current ?? 120) / 60)
          : (currentBeatRef.current ?? 0);
        const LERP_SPEED = 8;
        const lerpAlpha = 1 - Math.exp(-LERP_SPEED * Math.max(0, elapsed));
        const externalTarget = targetBeatRef.current ?? targetBeat;
        const resolvedTarget = Math.max(targetBeat, externalTarget);
        displayBeatRef.current +=
          (resolvedTarget - displayBeatRef.current) * lerpAlpha;
        const beat = displayBeatRef.current;
        lastFrameTimeRef.current = now;

        const pxPerBeat = pixelsPerBeatRef.current || 1;
        const bx = barXRef.current || barX;
        const scrollX = bx + beat * pxPerBeat;

        const desiredX = scrollX;
        const currentX = typeof scrollLayer.x === "number" ? scrollLayer.x : 0;
        const diff = desiredX - currentX;
        const ABS_SNAP_THRESHOLD = 120;
        if (Math.abs(diff) > ABS_SNAP_THRESHOLD) {
          scrollLayer.x = desiredX;
        } else {
          const SMOOTH_ALPHA = 0.18;
          scrollLayer.x = currentX + diff * SMOOTH_ALPHA;
        }
        const actualScrollX = scrollLayer.x;

        guideLayer.children.forEach((child) => {
          const screenX = actualScrollX + child.x;
          child.visible = screenX > -2 && screenX < width;
        });

        noteSpritesRef.current.forEach((sprite) => {
          const screenX = actualScrollX + sprite.container.x;
          const glowPadding = Number(sprite.glowPadding ?? 0);
          const leftEdgeWithGlow = screenX - glowPadding;
          const rightEdgeWithGlow = screenX + sprite.width + glowPadding;
          const isVisible = rightEdgeWithGlow > 0 && leftEdgeWithGlow < width;
          sprite.container.visible = isVisible;
          if (!isVisible) return;

          const isActive =
            beat >= sprite.time && beat < sprite.time + sprite.duration;

          if (sprite.hoverBg && sprite.hoverState) {
            sprite.hoverBg.alpha +=
              (sprite.hoverState.targetAlpha - sprite.hoverBg.alpha) * 0.2;
          }
          if (sprite.brightnessFilter && sprite.brightnessState) {
            sprite.brightnessState.target = isActive ? 1.2 : 1.0;
            sprite.brightnessState.current +=
              (sprite.brightnessState.target - sprite.brightnessState.current) *
              0.25;
            sprite.brightnessFilter.brightness(
              sprite.brightnessState.current,
              false,
            );
          }

          const isActiveForHoles =
            beat >= sprite.time && beat < sprite.time + sprite.duration;
          if (sprite.holeSprites?.length) {
            sprite.holeSprites.forEach((hole) => {
              const target = isActiveForHoles ? HOLE_PLAY_SCALE : 1.0;
              hole.scale.y += (target - hole.scale.y) * HOLE_SCALE_ALPHA;
            });
          }

          if (
            sprite.activeHoles?.length &&
            particleLayerRef.current &&
            particleTextureRef.current
          ) {
            if (
              isActive &&
              isPlayingRef.current &&
              particlesRef.current.length < MAX_PARTICLES
            ) {
              sprite.activeHoles.forEach(({ y, color }) => {
                if (Math.random() > PARTICLE_SPAWN_CHANCE) return;
                if (particlesRef.current.length >= MAX_PARTICLES) return;
                const spr = new PIXI.Sprite(particleTextureRef.current);
                spr.anchor.set(0.5);
                spr.tint = 0xffffff;
                const spawnX = barXRef.current + (Math.random() - 0.5) * 10;
                const spawnY = y + (Math.random() - 0.5) * 5;
                spr.x = spawnX;
                spr.y = spawnY;
                particleLayerRef.current.addChild(spr);
                particlesRef.current.push({
                  spr,
                  x: spawnX,
                  y: spawnY,
                  vx: -(Math.random() * 3 + 1),
                  vy: (Math.random() - 0.5) * 2,
                  age: 0,
                  lifetime:
                    PARTICLE_LIFETIME_MIN +
                    Math.random() *
                      (PARTICLE_LIFETIME_MAX - PARTICLE_LIFETIME_MIN),
                  targetColor: color,
                });
              });
            }
          }
        });

        for (let i = particlesRef.current.length - 1; i >= 0; i -= 1) {
          const p = particlesRef.current[i];
          const dtSeconds = (ticker?.deltaMS ?? 16.67) / 1000;
          p.age += dtSeconds;
          const t = Math.min(1, p.age / p.lifetime);
          p.spr.tint = lerpColor(p.targetColor, 0xffffff, t);
          p.spr.alpha = 1 - t;
          p.x += p.vx * dtSeconds * 60;
          p.y += p.vy * dtSeconds * 60;

          p.spr.x = p.x;
          p.spr.y = p.y;
          if (p.age >= p.lifetime) {
            p.spr.destroy();
            particlesRef.current.splice(i, 1);
          }
        }
      };
      ticker.add(tick);
    };

    init();

    return () => {
      cancelled = true;
      if (ticker && tick) {
        ticker.remove(tick);
      }
      // clear scrollLayerRef
      if (scrollLayerRef.current) {
        scrollLayerRef.current = null;
      }
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      noteSpritesRef.current = [];
      particlesRef.current = [];
      particleTextureRef.current = null;
    };
  }, [noteEvents, width, height, displaySong?.timeSignature]);

  useEffect(() => {
    if (!appRef.current) return;
    appRef.current.renderer.resize(width, height);
  }, [width, height]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e) => {
      e.preventDefault();
      onScrubStart?.();
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      const deltaBeat = delta / (pixelsPerBeatRef.current || 1);
      const newBeat = Math.max(
        0,
        Math.min(
          durationBeatsRef.current || Infinity,
          currentBeatRef.current + deltaBeat,
        ),
      );
      currentBeatRef.current = newBeat;
      onScrub?.(newBeat);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [onScrubStart, onScrub]);

  const handleDragStart = useCallback((e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    dragStartXRef.current = clientX;
    if (playBarHoveredRef.current) {
      isPlayBarDraggingRef.current = true;
      dragStartPlayBarPositionRef.current = playBarPositionRef.current;
      setIsPlayBarDragging(true);
    } else {
      dragStartBeatRef.current = currentBeatRef.current;
      mouseDownRef.current = true;
      hasDraggedRef.current = false;
      isDraggingRef.current = false;
      isPlayBarDraggingRef.current = false;
    }
  }, []);

  const handleDragMove = useCallback(
    (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const deltaX = clientX - dragStartXRef.current;

      if (isPlayBarDraggingRef.current) {
        const newPosition = Math.max(
          0.5,
          Math.min(
            0.99,
            dragStartPlayBarPositionRef.current +
              deltaX / (canvasWidthRef.current || 1),
          ),
        );
        onPlayBarPositionChange?.(newPosition);
        return;
      }

      if (!mouseDownRef.current) return;
      if (!isDraggingRef.current) {
        if (Math.abs(deltaX) <= 4) return;
        isDraggingRef.current = true;
        hasDraggedRef.current = true;
        setIsDragging(true);
        onScrubStart?.();
      }
      const deltaBeat = deltaX / (pixelsPerBeatRef.current || 1);
      const newBeat = Math.max(
        0,
        Math.min(
          durationBeatsRef.current || Infinity,
          dragStartBeatRef.current + deltaBeat,
        ),
      );
      onScrub?.(newBeat);
    },
    [onScrub, onScrubStart, onPlayBarPositionChange],
  );

  const handleDragEnd = useCallback(() => {
    mouseDownRef.current = false;
    isDraggingRef.current = false;
    isPlayBarDraggingRef.current = false;
    setIsDragging(false);
    setIsPlayBarDragging(false);
  }, []);

  const cursor =
    isPlayBarDragging || isHoveringPlayBar
      ? "ew-resize"
      : isDragging
        ? "grabbing"
        : isHoveringNote && !isPlaying
          ? "pointer"
          : "grab";

  if (!song) {
    return (
      <div
        className="text-main"
        ref={wrapperRef}
        style={{
          width: "100%",
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 14, fontFamily: "monospace" }}>
          Pick a song to get started
        </span>
      </div>
    );
  }

  return (
    <div
      className="bg-dark overflow-x-hidden"
      ref={wrapperRef}
      style={{ width: "100%", height }}
    >
      <div
        className="focus:outline-none"
        ref={containerRef}
        style={{
          width,
          height,
          cursor,
          opacity: isReady && song?.id === displaySong?.id ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease`,
        }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.code === "Space") {
            e.preventDefault();
            onPlayPause?.();
          }
        }}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        onPointerLeave={handleDragEnd}
      />
    </div>
  );
}
