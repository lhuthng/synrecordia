import * as PIXI from "pixi.js";
import { GlowFilter } from "pixi-filters";
import { NUM_HOLES, FINGERING_GAPS } from "./constants.js";

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
 * @returns {{ width: number, height: number }}
 */
export const drawFingering = (container, fingering, size, xPadding, colors) => {
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

    container.addChild(holeContainer);
    container.holeSprites.push(holeContainer);
  }

  return {
    width: rectWidth,
    height: totalHeight,
  };
};
