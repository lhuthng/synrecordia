import * as PIXI from "pixi.js";
import { ColorMatrixFilter } from "pixi.js";
import { NOTE_GLOW_PADDING } from "../../components/utils/constants.js";
import {
  cssColorToPixiHex,
  lerpColor,
  darken,
} from "../../components/utils/colorUtils.js";
import { BaseVisualizerInstrument } from "./BaseVisualizerInstrument.js";
import GuitarMapper from "../guitar/GuitarMapper.js";

const NUM_STRINGS = 6;
const STRING_PADDING = 0.12;
const NOTE_HEIGHT = 30;
const NOTE_SHADOW_OFFSET = 3;
const MIN_NOTE_WIDTH = 6;
const MIN_LABEL_WIDTH = 18;
const MAX_FRET = 24;

const TECH_PREFIX = { "hammer-on": "h", "pull-off": "p", tap: "t" };

const QUANT = 0.125;
const quantize = (t) => Math.round(t / QUANT) * QUANT;

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

function stringCenterY(s, height) {
  const pad = STRING_PADDING * height;
  return pad + ((s - 1) / (NUM_STRINGS - 1)) * (height - 2 * pad);
}

export class GuitarVisualizerInstrument extends BaseVisualizerInstrument {
  // eslint-disable-next-line no-unused-vars
  computeNoteEvents(track, _fingeringSystem, _transpose, _recorderType) {
    if (!track || !Array.isArray(track.actions)) return [];

    const result = new GuitarMapper({ mode: "balanced" }).map(track.actions);

    const durationMap = new Map();
    for (const action of track.actions) {
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

  buildStaticLayer(holesLayer, { width, height }) {
    const white = getWhiteColor();
    for (let s = 1; s <= NUM_STRINGS; s++) {
      const cy = stringCenterY(s, height);
      const alpha = s === 1 || s === NUM_STRINGS ? 0.8 : 0.5;
      const thickness = 0.5 + (s - 1) * 0.18;
      const line = new PIXI.Graphics();
      line.setStrokeStyle({ width: thickness, color: white, alpha });
      line.moveTo(0, cy).lineTo(width, cy).stroke();
      holesLayer.addChild(line);
    }
  }

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

    const noteWidth = Math.max((event.duration ?? 0) * ppb, MIN_NOTE_WIDTH);
    const cy = stringCenterY(event.string ?? 1, height);
    const containerY = cy - NOTE_HEIGHT / 2;

    // Two-layer pill: shadow beneath, main on top
    const noteGraphics = new PIXI.Graphics();
    noteGraphics.roundRect(0, NOTE_SHADOW_OFFSET, noteWidth, NOTE_HEIGHT, 6);
    noteGraphics.fill({ color: shadowColor });
    noteGraphics.roundRect(0, 0, noteWidth, NOTE_HEIGHT, 4);
    noteGraphics.fill({ color });

    if (noteWidth >= MIN_LABEL_WIDTH) {
      const fretText = `${TECH_PREFIX[event.technique] ?? ""}${event.fret}`;
      const fretLabel = new PIXI.Text({
        text: fretText,
        style: {
          fill: darkColor,
          fontSize: 12,
          fontWeight: "bold",
          fontFamily: "Iosevka Charon",
        },
      });
      fretLabel.x = noteWidth - fretLabel.width - 4;
      fretLabel.y = Math.round((NOTE_HEIGHT - fretLabel.height) / 2);
      noteGraphics.addChild(fretLabel);
    }

    let brightnessFilter = null;
    let brightnessState = null;
    if (!ecoMode) {
      brightnessFilter = new ColorMatrixFilter();
      noteGraphics.filters = [brightnessFilter];
      brightnessState = { current: 1.0, target: 1.0 };
    }

    const graphics = new PIXI.Container();
    graphics.addChild(noteGraphics);

    // Note-name label above the rect — hidden until hover
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

    const hoverBg = new PIXI.Graphics();
    hoverBg.rect(0, -containerY, noteWidth, height);
    hoverBg.fill({ color: subColor, alpha: 1 });
    hoverBg.alpha = 0;

    const container = new PIXI.Container();
    container.addChild(hoverBg);
    container.addChild(noteLabel);
    container.addChild(graphics);

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

    container.x = -noteWidth - event.time * ppb;
    container.y = containerY;
    container.alpha = 0;
    notesLayer.addChild(container);

    return {
      container,
      time: event.time,
      width: noteWidth,
      duration: event.duration ?? 0,
      graphics,
      brightnessFilter,
      brightnessState,
      noteLabel,
      hoverBg,
      hoverState,
      glowPadding: NOTE_GLOW_PADDING,
      fadeAlpha: 0,
    };
  }

  // eslint-disable-next-line no-unused-vars
  onTickSprite(_sprite, _params) {}
}
