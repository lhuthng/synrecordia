import * as PIXI from "pixi.js";

import { NUM_HOLES, FINGERING_GAPS } from "./constants.js";

// ── GraphicsContext caches ────────────────────────────────────────────────────
// Keyed by "width_height". Each context stores the white rounded-rect geometry
// once; every Graphics instance that shares it avoids re-triangulating the path,
// and tint replaces per-instance fill colour so the GPU can batch same-size holes.

const segmentContextCache = new Map();
const shadowContextCache = new Map();

const getSegmentContext = (w, h) => {
  const key = `${w}_${h}`;
  if (!segmentContextCache.has(key)) {
    segmentContextCache.set(
      key,
      new PIXI.GraphicsContext()
        .roundRect(0, -h / 2, w, h - 2, 4)
        .fill(0xffffff),
    );
  }
  return segmentContextCache.get(key);
};

const getShadowContext = (w, h) => {
  const key = `${w}_${h}`;
  if (!shadowContextCache.has(key)) {
    shadowContextCache.set(
      key,
      new PIXI.GraphicsContext().roundRect(0, -h / 2, w, h, 4).fill(0xffffff),
    );
  }
  return shadowContextCache.get(key);
};

// ── Guitar-note GraphicsContext caches ────────────────────────────────────────
// Same principle as the recorder caches above: geometry is triangulated once per
// unique pill size and reused across every note that shares those dimensions.

const guitarShadowContextCache = new Map();
const guitarBodyContextCache = new Map();

const getGuitarShadowContext = (xPadding, w, h, shadowOffset) => {
  const key = `${xPadding}_${w}_${h}_${shadowOffset}`;
  if (!guitarShadowContextCache.has(key)) {
    guitarShadowContextCache.set(
      key,
      new PIXI.GraphicsContext()
        .roundRect(xPadding, shadowOffset, w, h, 6)
        .fill(0xffffff),
    );
  }
  return guitarShadowContextCache.get(key);
};

const getGuitarBodyContext = (xPadding, w, h) => {
  const key = `${xPadding}_${w}_${h}`;
  if (!guitarBodyContextCache.has(key)) {
    guitarBodyContextCache.set(
      key,
      new PIXI.GraphicsContext().roundRect(xPadding, 0, w, h, 4).fill(0xffffff),
    );
  }
  return guitarBodyContextCache.get(key);
};

/**
 * Returns an array of NUM_HOLES y-positions (top edges) for each hole,
 * spaced according to FINGERING_GAPS (expressed as multiples of rectHeight).
 *
 * @param {number} rectHeight - Height of a single hole rectangle in pixels.
 * @returns {number[]}
 */
export const getHolePositions = (rectHeight) => {
  const positions = [0];
  for (let i = 0; i < FINGERING_GAPS.length; i += 1) {
    const prev = positions[positions.length - 1];
    positions.push(prev + rectHeight + FINGERING_GAPS[i] * rectHeight);
  }
  return positions;
};

/**
 * Draws a fingering diagram into `container` and returns its bounding dimensions.
 *
 * Each active hole is rendered as a rounded rectangle with a coloured fill and a
 * matching glow shadow. An array of PIXI.Container references is attached to
 * `container.holeSprites` so the ticker can animate their scale.y independently.
 *
 * @param {PIXI.Container} container  - Target container to draw into.
 * @param {string}         fingering  - Fingering string (one char per hole: "0", "1", "h", …).
 * @param {{ x: number, y: number }} size - Hole rectangle dimensions.
 * @param {number}         xPadding   - Left padding inside the container.
 * @param {{ [state: string]: number }} colors - Map of state char → 0xRRGGBB colour.
 * @returns {{ width: number, height: number, fullGroup: PIXI.Container|null, halfGroup: PIXI.Container|null }}
 */
export const drawFingering = (container, fingering, size, xPadding, colors) => {
  const rectWidth = size.x * 1.2;
  const rectHeight = size.y;
  const positions = getHolePositions(rectHeight);
  const totalHeight = positions[NUM_HOLES - 1] + rectHeight;

  container.holeSprites = [];

  // Two sub-containers so each hole-state group can receive its own correctly-
  // coloured GlowFilter from the caller without affecting the other group.
  const fullGroup = new PIXI.Container(); // state "1"  — full-hole colour
  const halfGroup = new PIXI.Container(); // state "h"  — half-hole colour

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

    const w = rectWidth - xPadding;

    const segment = new PIXI.Graphics(getSegmentContext(w, rectHeight));
    segment.tint = color;

    const shadow = new PIXI.Graphics(getShadowContext(w, rectHeight));
    shadow.tint = darkColor;
    // Per-hole GlowFilter removed — a single GlowFilter is applied to the outer
    // graphics container by the caller (RecorderVisualizer) instead, cutting
    // filter passes from N×3 (one per active hole) down to 3 per note sprite.
    shadow.alpha = 0.6;

    holeContainer.addChild(shadow);
    holeContainer.addChild(segment);

    holeContainer.scale.y = 1;

    // Route each hole to the matching colour group.
    const group = state === "h" ? halfGroup : fullGroup;
    group.addChild(holeContainer);
    container.holeSprites.push(holeContainer);
  }

  // Only attach a group if it has children; return null for absent groups so
  // the caller can skip creating a GlowFilter for that colour entirely.
  const hasFullGroup = fullGroup.children.length > 0;
  const hasHalfGroup = halfGroup.children.length > 0;
  if (hasFullGroup) container.addChild(fullGroup);
  if (hasHalfGroup) container.addChild(halfGroup);

  return {
    width: rectWidth,
    height: totalHeight,
    fullGroup: hasFullGroup ? fullGroup : null,
    halfGroup: hasHalfGroup ? halfGroup : null,
  };
};

/**
 * Draws a guitar note pill into `container` and returns its bounding dimensions.
 *
 * Mirrors the structure of drawFingering: a shadow layer with GlowFilter sits
 * beneath a tinted body. A single element is pushed to `container.holeSprites`
 * so the ticker can animate scale.y with the same mechanism as recorder holes.
 *
 * @param {PIXI.Container} container    - Target container to draw into.
 * @param {number}         color        - 0xRRGGBB fill colour for the body.
 * @param {number}         darkColor    - 0xRRGGBB fill colour for the shadow.
 * @param {number}         noteWidth    - Total bounding width (includes x padding).
 * @param {number}         noteHeight   - Pill height in pixels.
 * @param {number}         xPadding     - Horizontal inset on each side.
 * @param {number}         shadowOffset - Downward y offset of the shadow layer.
 * @returns {{ width: number, height: number, bodyGraphics: PIXI.Graphics }}
 */
export const drawGuitarNote = (
  container,
  color,
  darkColor,
  noteWidth,
  noteHeight,
  xPadding,
  shadowOffset,
) => {
  const w = noteWidth - 2 * xPadding;

  const noteContainer = new PIXI.Container();

  const shadow = new PIXI.Graphics(
    getGuitarShadowContext(xPadding, w, noteHeight, shadowOffset),
  );
  shadow.tint = darkColor;
  // Per-note GlowFilter removed — caller (GuitarVisualizer) adds one GlowFilter
  // on the outer graphics container, eliminating the nested-FBO overhead that
  // came from filtering a child while the parent was also filtered.
  shadow.alpha = 0.55;

  const bodyGraphics = new PIXI.Graphics(
    getGuitarBodyContext(xPadding, w, noteHeight),
  );
  bodyGraphics.tint = color;

  noteContainer.addChild(shadow);
  noteContainer.addChild(bodyGraphics);

  // Pivot at pill centre so scale animation expands symmetrically.
  noteContainer.pivot.set(noteWidth / 2, noteHeight / 2);
  noteContainer.position.set(noteWidth / 2, noteHeight / 2);

  container.addChild(noteContainer);
  container.holeSprites = [noteContainer];

  return { width: noteWidth, height: noteHeight, bodyGraphics };
};
