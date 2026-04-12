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
} from "../../libs/pixi/constants.js";
import {
  getFingeringColors,
  brightenColor,
} from "../../libs/pixi/colorUtils.js";
import { getHighestNote } from "../../libs/pixi/fingeringUtils.js";
import {
  getHolePositions,
  drawFingering,
} from "../../libs/pixi/geometryUtils.js";
import { createFingeringResolver } from "./fingering/FingeringResolverFactory.js";
import { transposeNote } from "../../libs/utils.js";
import { BaseVisualizerInstrument } from "../core/BaseVisualizerInstrument.js";

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
  // ── Per-instance color cache ──────────────────────────────────────────────
  // getFingeringColors() calls getComputedStyle on every invocation. Caching
  // here avoids one forced style recalculation per sprite allocation. The cache
  // is invalidated only when the instrument instance is replaced (song change).
  _colorCache = null;

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
      ecoMode = false,
    },
  ) {
    const fingeringColors =
      this._colorCache ?? (this._colorCache = getFingeringColors());
    const durationForWidth = Math.max(
      event.visualDuration ?? event.duration ?? 0,
      0,
    );
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

    // ── Outer container + filters ────────────────────────────────────────────
    // brightnessFilter lives on the outer graphics container so it wraps all
    // holes uniformly. Per-colour GlowFilters are applied to the two sub-group
    // containers returned by drawFingering (fullGroup → full-note colour,
    // halfGroup → half-note colour). Notes with only one hole type get 1 glow
    // (4 total passes); notes with both types get 2 glows (7 passes) — still
    // far fewer than the old per-hole approach (12–24 passes per note).
    const container = new PIXI.Container();
    let brightnessFilter = null;
    let brightnessState = null;
    if (!ecoMode) {
      brightnessFilter = new ColorMatrixFilter();
      graphics.filters = [brightnessFilter];
      if (dims.fullGroup) {
        dims.fullGroup.filters = [
          new GlowFilter({
            distance: 10,
            outerStrength: 1.2,
            innerStrength: 0.1,
            color: fingeringColors["1"] ?? 0x2ecc71,
            quality: 0.15,
            knockout: false,
          }),
        ];
      }
      if (dims.halfGroup) {
        dims.halfGroup.filters = [
          new GlowFilter({
            distance: 10,
            outerStrength: 1.2,
            innerStrength: 0.1,
            color: fingeringColors["h"] ?? 0x3498db,
            quality: 0.15,
            knockout: false,
          }),
        ];
      }
      brightnessState = { current: 1.0, target: 1.0 };
    }

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
    container.x = -scaledGraphicsWidth - (event.visualTime ?? event.time) * ppb;
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
        const diff = target - hole.scale.y;
        // Skip the lerp once the animation has settled to avoid a per-frame
        // multiply on every on-screen sprite when no scale change is needed.
        if (Math.abs(diff) > 0.001) {
          hole.scale.y += diff * HOLE_SCALE_ALPHA;
        }
      });
    }

    // ── Particle emission from active holes while playing ────────────────────
    const { particleLayerRef, particlesRef, particlePoolRef } = particleRefs;

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

        const spr = particlePoolRef?.current?.acquire();
        if (!spr) return; // pool exhausted

        const spawnX = barXRef.current + (Math.random() - 0.5) * 10;
        const spawnY = y + (Math.random() - 0.5) * 5;
        spr.x = spawnX;
        spr.y = spawnY;
        // No addChild needed — pool sprites are permanently in the layer

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
