import * as PIXI from "pixi.js";
import { ColorMatrixFilter } from "pixi.js";
import {
  NOTE_GLOW_PADDING,
  HOLE_PLAY_SCALE,
  HOLE_SCALE_ALPHA,
  MAX_PARTICLES,
  PARTICLE_LIFETIME_MIN,
  PARTICLE_LIFETIME_MAX,
  PARTICLE_SPAWN_CHANCE,
} from "../../libs/pixi/constants.js";
import {
  cssColorToPixiHex,
  lerpColor,
  darken,
  brightenColor,
} from "../../libs/pixi/colorUtils.js";
import { BaseVisualizerInstrument } from "../core/BaseVisualizerInstrument.js";
import GuitarMapper from "./mapper/GuitarMapper.js";
import { transposeNote } from "../../libs/utils.js";
import { drawGuitarNote } from "../../libs/pixi/geometryUtils.js";

// ── Guitar-specific layout constants ─────────────────────────────────────────
const NUM_STRINGS = 6;
const STRING_PADDING = 0.8; // fraction of height reserved as top+bottom gutter
const NOTE_HEIGHT = 30;
const NOTE_SHADOW_OFFSET = 3;
const MIN_NOTE_WIDTH = 6;
const MIN_LABEL_WIDTH = 18;
const MAX_FRET = 24;
const X_PADDING = 1;

const TECH_PREFIX = { "hammer-on": "h", "pull-off": "p", tap: "t" };

// ── Time-quantisation helpers (align mapper slices to track durations) ────────
const QUANT = 0.125;
const quantize = (t) => Math.round(t / QUANT) * QUANT;

// ── CSS-variable → PIXI colour helpers ───────────────────────────────────────
function cssVar(name, fallback) {
  if (typeof window === "undefined") return fallback;
  return cssColorToPixiHex(
    getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    fallback,
  );
}

function getFretColor(fret) {
  const full = cssVar("--color-note-full", 0x2dd4bf);
  const half = cssVar("--color-note-half", 0xa78bfa);
  return lerpColor(
    full,
    half,
    Math.max(0, Math.min(1, (fret ?? 0) / MAX_FRET)),
  );
}

function getDarkColor() {
  return cssVar("--color-dark", 0x060a0c);
}
function getTextPrimaryColor() {
  return cssVar("--color-text-primary", 0xf8fafc);
}
function getSubColor() {
  return cssVar("--color-sub", 0xf8fafc);
}
function getWhiteColor() {
  return cssVar("--color-playhead", 0xffffff);
}

// String 1 = thinnest (top of neck diagram), string 6 = thickest (bottom).
function stringCenterY(s, height) {
  const pad = STRING_PADDING * height;
  return pad + ((s - 1) / (NUM_STRINGS - 1)) * (height - 2 * pad);
}

/**
 * GuitarVisualizerInstrument
 *
 * Concrete implementation of BaseVisualizerInstrument for the guitar.
 *
 * Responsibilities:
 *   – computeNoteEvents : map track actions to string/fret positions via GuitarMapper
 *   – buildStaticLayer  : draw guitar string guide lines across the canvas
 *   – createSprite      : render a two-layer pill on the correct string line
 *   – onTickSprite      : animate note scale bounce and emit particles
 */
export class GuitarVisualizerInstrument extends BaseVisualizerInstrument {
  // ─── computeNoteEvents ─────────────────────────────────────────────────────

  computeNoteEvents(
    track,
    _fingeringSystem,
    transpose,
    _recorderType,
    instrumentOptions = {},
  ) {
    if (!track || !Array.isArray(track.actions)) return [];

    const {
      mode = "balanced",
      leftHandWeight = null,
      rightHandWeight = null,
    } = instrumentOptions;

    // Transpose all note pitches before mapping so GuitarMapper resolves the
    // correct string/fret positions for the transposed key, and event.note
    // reflects the transposed pitch name shown in labels.
    const actions = transpose
      ? track.actions.map((action) => {
          if (action.type !== "note") return action;
          return {
            ...action,
            ...(action.pitches != null && {
              pitches: action.pitches.map((p) =>
                transposeNote(String(p), transpose),
              ),
            }),
            ...(action.pitch != null && {
              pitch: transposeNote(String(action.pitch), transpose),
            }),
          };
        })
      : track.actions;

    const result = new GuitarMapper({
      mode,
      leftHandWeight,
      rightHandWeight,
    }).map(actions);

    // Build a duration map so each mapper slice can look up the original
    // pitch/duration from the track actions (mapper only stores positions).
    const durationMap = new Map();
    for (const action of actions) {
      if (action.type !== "note") continue;
      const rawPitches = action.pitches
        ? action.pitches
        : action.pitch != null
          ? [action.pitch]
          : [];
      const key = quantize(action.time).toFixed(6);
      if (!durationMap.has(key))
        durationMap.set(key, { notes: [], seen: new Set() });
      const bucket = durationMap.get(key);
      for (const pitch of rawPitches) {
        const ps = String(pitch);
        if (!bucket.seen.has(ps)) {
          bucket.seen.add(ps);
          bucket.notes.push({ pitch: ps, duration: action.duration ?? 0.5 });
        }
      }
    }

    const events = [];
    for (const slice of result.slices) {
      if (!slice.notes) continue;
      const bucket = durationMap.get(slice.time.toFixed(6));
      const srcNotes = bucket?.notes ?? [];
      slice.notes.forEach((mapped, i) => {
        const src = srcNotes[i] ?? null;
        events.push({
          time: slice.time,
          duration: src?.duration ?? 0.5,
          note: src?.pitch ?? "",
          string: mapped.pos[0],
          fret: mapped.pos[1],
          technique: mapped.technique ?? "pick",
        });
      });
    }
    return events;
  }

  // ─── buildStaticLayer ──────────────────────────────────────────────────────

  buildStaticLayer(holesLayer, { width, height }) {
    const white = getWhiteColor();
    for (let s = 1; s <= NUM_STRINGS; s++) {
      const cy = stringCenterY(s, height);
      // Outer strings slightly more opaque; thickness increases toward bass strings.
      const alpha = s === 1 || s === NUM_STRINGS ? 0.8 : 0.5;
      const thickness = 0.5 + (s - 1) * 0.18;
      const line = new PIXI.Graphics();
      line.setStrokeStyle({ width: thickness, color: white, alpha });
      line.moveTo(0, cy).lineTo(width, cy).stroke();
      holesLayer.addChild(line);
    }
  }

  // ─── createSprite ──────────────────────────────────────────────────────────

  createSprite(
    event,
    {
      ppb,
      height,
      notesLayer,
      isPlayingRef,
      hasDraggedRef,
      onNoteClickRef,
      setIsHoveringNote,
      ecoMode = false,
    },
  ) {
    const darkColor = getDarkColor();
    const textColor = getTextPrimaryColor();
    const subColor = getSubColor();

    const color = getFretColor(event.fret ?? 0);
    const shadowColor = darken(color, 0.45);

    const noteWidth = Math.max(
      (event.visualDuration ?? event.duration ?? 0) * ppb,
      MIN_NOTE_WIDTH,
    );
    const cy = stringCenterY(event.string ?? 1, height);
    const containerY = cy - NOTE_HEIGHT / 2;

    // ── Two-layer pill via shared GraphicsContext (shadow + GlowFilter + body) ──
    const graphics = new PIXI.Container();
    const { bodyGraphics } = drawGuitarNote(
      graphics,
      color,
      shadowColor,
      noteWidth,
      NOTE_HEIGHT,
      X_PADDING,
      NOTE_SHADOW_OFFSET,
    );

    // ── Fret / technique label (right-aligned inside body) ───────────────────
    if (noteWidth >= MIN_LABEL_WIDTH) {
      const fretText = `${TECH_PREFIX[event.technique] ?? ""}${event.fret}`;
      const fretLabel = new PIXI.Text({
        text: fretText,
        style: {
          fill: darkColor,
          fontSize: 18,
          fontWeight: "bold",
          fontFamily: "Iosevka Charon",
        },
      });
      fretLabel.x = noteWidth - fretLabel.width - 4;
      fretLabel.y = Math.round((NOTE_HEIGHT - fretLabel.height) / 2);
      bodyGraphics.addChild(fretLabel);
    }

    // ── Brightness filter (non-eco only) ─────────────────────────────────────
    let brightnessFilter = null;
    let brightnessState = null;
    if (!ecoMode) {
      brightnessFilter = new ColorMatrixFilter();
      graphics.filters = [brightnessFilter];
      brightnessState = { current: 1.0, target: 1.0 };
    }

    // ── Note-name label (hover-only, above pill) ─────────────────────────────
    const noteLabelFontSize = noteWidth < 28 ? 9 : 11;
    const noteLabel = new PIXI.Text({
      text: event.note ?? "",
      style: {
        fill: textColor,
        fontSize: noteLabelFontSize,
        fontFamily: "Iosevka Charon",
      },
    });
    noteLabel.x = Math.max((noteWidth - noteLabel.width) / 2, 0);
    noteLabel.y = -(noteLabelFontSize + 5);
    noteLabel.alpha = 0;

    // ── Hover highlight background (full string column height) ───────────────
    const hoverBg = new PIXI.Graphics();
    hoverBg.rect(0, -containerY, noteWidth, height);
    hoverBg.fill({ color: subColor, alpha: 1 });
    hoverBg.alpha = 0;

    // ── Active-note position for particle emission ───────────────────────────
    // Pre-computed once; particles spawn at (barX, activeNote.y) each frame.
    const activeNote = {
      y: cy,
      color: brightenColor(color, 1.2),
    };

    // ── Outer container ──────────────────────────────────────────────────────
    const container = new PIXI.Container();
    container.addChild(hoverBg);
    container.addChild(noteLabel);
    container.addChild(graphics);

    // ── Pointer interaction ──────────────────────────────────────────────────
    const hoverState = { targetAlpha: 0 };
    container.eventMode = "static";
    container.hitArea = new PIXI.Rectangle(0, -containerY, noteWidth, height);

    container.on("pointerover", () => {
      if (isPlayingRef.current) return;
      hoverState.targetAlpha = 0.07;
      noteLabel.alpha = 1;
      setIsHoveringNote(true);
    });
    container.on("pointerout", () => {
      hoverState.targetAlpha = 0;
      noteLabel.alpha = 0;
      setIsHoveringNote(false);
    });
    container.on("pointerup", () => {
      if (hasDraggedRef.current || isPlayingRef.current) return;
      onNoteClickRef.current?.({ note: event.note, duration: event.duration });
    });

    // ── Position + alpha (fade-in handled by hook each frame) ────────────────
    container.x = -noteWidth - (event.visualTime ?? event.time) * ppb;
    container.y = containerY;
    container.alpha = 0;
    notesLayer.addChild(container);

    return {
      container,
      time: event.time,
      width: noteWidth,
      duration: event.duration ?? 0,
      graphics,
      holeSprites: graphics.holeSprites ?? [], // pill container — scaled by onTickSprite
      brightnessFilter,
      brightnessState,
      noteLabel,
      hoverBg,
      hoverState,
      activeNote, // { y, color } — particle spawn anchor on the string
      glowPadding: NOTE_GLOW_PADDING,
      fadeAlpha: 0,
    };
  }

  // ─── onTickSprite ──────────────────────────────────────────────────────────

  onTickSprite(
    sprite,
    {
      isActive,
      particleRefs,
      particleTextureRef,
      isPlayingRef,
      particlesEnabledRef,
      barXRef,
    },
  ) {
    // ── Note scale bounce ────────────────────────────────────────────────────
    if (sprite.holeSprites?.length) {
      sprite.holeSprites.forEach((hole) => {
        const target = isActive ? HOLE_PLAY_SCALE : 1.0;
        hole.scale.y += (target - hole.scale.y) * HOLE_SCALE_ALPHA;
      });
    }

    // ── Particle emission from the active string while playing ───────────────
    const { particleLayerRef, particlesRef, particlePoolRef } = particleRefs;

    if (
      sprite.activeNote &&
      particleLayerRef.current &&
      particleTextureRef.current &&
      isActive &&
      isPlayingRef.current &&
      particlesEnabledRef.current &&
      particlesRef.current.length < MAX_PARTICLES
    ) {
      if (Math.random() > PARTICLE_SPAWN_CHANCE) return;
      if (particlesRef.current.length >= MAX_PARTICLES) return;

      const spr = particlePoolRef?.current?.acquire();
      if (!spr) return;

      const { y, color } = sprite.activeNote;
      const spawnX = barXRef.current + (Math.random() - 0.5) * 10;
      const spawnY = y + (Math.random() - 0.5) * 5;
      spr.x = spawnX;
      spr.y = spawnY;

      particlesRef.current.push({
        spr,
        x: spawnX,
        y: spawnY,
        vx: -(Math.random() * 3 + 1),
        vy: (Math.random() - 0.5) * 2,
        age: 0,
        lifetime:
          PARTICLE_LIFETIME_MIN +
          Math.random() * (PARTICLE_LIFETIME_MAX - PARTICLE_LIFETIME_MIN),
        targetColor: color,
      });
    }
  }
}
