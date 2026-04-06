import * as PIXI from "pixi.js";
import { ColorMatrixFilter } from "pixi.js";
import { GlowFilter } from "pixi-filters";
import {
  NUM_HOLES,
  HOLE_SIZE,
  NOTE_GLOW_PADDING,
  HOLE_PLAY_SCALE,
  HOLE_SCALE_ALPHA,
  MAX_PARTICLES,
  PARTICLE_LIFETIME_MIN,
  PARTICLE_LIFETIME_MAX,
  PARTICLE_SPAWN_CHANCE,
} from "../../components/utils/constants.js";
import {
  getFingeringColors,
  brightenColor,
} from "../../components/utils/colorUtils.js";
import { getHighestNote } from "../../components/utils/fingeringUtils.js";
import {
  getHolePositions,
  drawFingering,
} from "../../components/utils/geometryUtils.js";
import { createFingeringResolver } from "../fingering/FingeringResolverFactory.js";
import { transposeNote } from "../utils.js";
import { BaseVisualizerInstrument } from "./BaseVisualizerInstrument.js";

/**
 * RecorderVisualizerInstrument
 *
 * Concrete implementation of BaseVisualizerInstrument for the soprano recorder.
 *
 * Responsibilities:
 *   – computeNoteEvents : resolve fingering patterns via the active system
 *   – buildStaticLayer  : draw horizontal hole guide lines across the canvas
 *   – createSprite      : render a fingering diagram + label for each note
 *   – onTickSprite      : animate hole scale bounce and emit particles
 */
export class RecorderVisualizerInstrument extends BaseVisualizerInstrument {
  // ─── computeNoteEvents ─────────────────────────────────────────────────────

  computeNoteEvents(track, fingeringSystem, transpose, recorderType = "tenor") {
    if (!track || !Array.isArray(track.actions)) return [];

    const resolver = createFingeringResolver(fingeringSystem, recorderType);

    return track.actions
      .filter((action) => action.type === "note")
      .map((action) => {
        const rawNote = getHighestNote(action.pitches ?? action.pitch);
        if (!rawNote) return null;

        const noteName = transposeNote(rawNote, transpose);
        const fingering = resolver.getPattern(noteName);
        if (!fingering) return null;

        return {
          time: action.time ?? 0,
          duration: action.duration ?? 0,
          note: noteName,
          fingering,
        };
      })
      .filter(Boolean);
  }

  // ─── buildStaticLayer ──────────────────────────────────────────────────────

  buildStaticLayer(holesLayer, { width, height }) {
    const holePositions = getHolePositions(HOLE_SIZE.y);
    const holesTop =
      (height - (holePositions[NUM_HOLES - 1] + HOLE_SIZE.y)) / 2;

    for (let i = 0; i < NUM_HOLES; i += 1) {
      const cy = holesTop + holePositions[i] + HOLE_SIZE.y / 2;
      const holeLine = new PIXI.Graphics();
      holeLine.setStrokeStyle({ width: 1, color: 0xffffff, alpha: 0.5 });
      holeLine.moveTo(0, cy);
      holeLine.lineTo(width, cy);
      holeLine.stroke();
      holesLayer.addChild(holeLine);
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
    },
  ) {
    const fingeringColors = getFingeringColors();
    const durationForWidth = Math.max(event.duration ?? 0, 0);
    const targetWidth = Math.max(durationForWidth * ppb, 6);

    // ── Fingering diagram ────────────────────────────────────────────────────
    const graphics = new PIXI.Container();
    const dims = drawFingering(
      graphics,
      event.fingering,
      { x: targetWidth / 1.2, y: HOLE_SIZE.y },
      2,
      fingeringColors,
    );

    // ── Active-hole positions for particle emission ──────────────────────────
    const noteHolePositions = getHolePositions(HOLE_SIZE.y);
    const containerY = (height - dims.height) / 2;
    const activeHoles = [];

    for (let i = 0; i < NUM_HOLES; i += 1) {
      const state = event.fingering[i];
      if (!state || state === "0") continue;
      const color = fingeringColors[state];
      if (!color) continue;
      activeHoles.push({
        y: containerY + noteHolePositions[i] + HOLE_SIZE.y / 2,
        color: brightenColor(color, 1.2),
      });
    }

    // ── Outer container + brightness filter ─────────────────────────────────
    const container = new PIXI.Container();
    const brightnessFilter = new ColorMatrixFilter();
    graphics.filters = [brightnessFilter];
    const brightnessState = { current: 1.0, target: 1.0 };

    const scaledGraphicsWidth = dims.width;
    const containerOffsetY = (height - dims.height) / 2;

    // ── Hover highlight background ───────────────────────────────────────────
    const hoverBg = new PIXI.Graphics();
    hoverBg.rect(0, -containerOffsetY, scaledGraphicsWidth, height);
    hoverBg.fill({ color: 0xffffff, alpha: 1 });
    hoverBg.alpha = 0;

    // ── Note label (displayed above the diagram) ─────────────────────────────
    const fontSize =
      scaledGraphicsWidth < 20 ? 8 : scaledGraphicsWidth < 36 ? 10 : 14;
    const label = new PIXI.Text({
      text: event.note,
      style: {
        fill: 0xffffff,
        fontSize,
        fontFamily: "Iosevka Charon",
      },
    });
    label.x = Math.max((scaledGraphicsWidth - label.width) / 2, 0);
    label.y = -(fontSize + 8);

    container.addChild(hoverBg);
    container.addChild(label);
    container.addChild(graphics);

    // ── Pointer interaction ──────────────────────────────────────────────────
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

    // ── Position + alpha (fade-in handled by hook each frame) ────────────────
    container.x = -scaledGraphicsWidth - event.time * ppb;
    container.y = containerY;
    container.alpha = 0;
    container.visible = true;
    notesLayer.addChild(container);

    return {
      container,
      time: event.time,
      width: scaledGraphicsWidth,
      duration: durationForWidth,
      graphics,
      brightnessFilter,
      brightnessState,
      label,
      hoverBg,
      hoverState,
      activeHoles,
      holeSprites: graphics.holeSprites ?? [],
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
    // ── Hole scale bounce ────────────────────────────────────────────────────
    if (sprite.holeSprites?.length) {
      sprite.holeSprites.forEach((hole) => {
        const target = isActive ? HOLE_PLAY_SCALE : 1.0;
        hole.scale.y += (target - hole.scale.y) * HOLE_SCALE_ALPHA;
      });
    }

    // ── Particle emission from active holes while playing ────────────────────
    const { particleLayerRef, particlesRef } = particleRefs;

    if (
      sprite.activeHoles?.length &&
      particleLayerRef.current &&
      particleTextureRef.current &&
      isActive &&
      isPlayingRef.current &&
      particlesEnabledRef.current &&
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
            Math.random() * (PARTICLE_LIFETIME_MAX - PARTICLE_LIFETIME_MIN),
          targetColor: color,
        });
      });
    }
  }
}
