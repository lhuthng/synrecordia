/**
 * Converts a CSS color string (hex 3/6-digit or rgb/rgba) to a PIXI hex number.
 * Returns `fallback` if the value cannot be parsed.
 *
 * @param {string} value
 * @param {number} fallback
 * @returns {number}
 */
export const cssColorToPixiHex = (value, fallback) => {
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

/**
 * Multiplies each RGB channel of a packed hex colour by `factor`, clamping to 255.
 *
 * @param {number} hex  - 0xRRGGBB packed integer
 * @param {number} factor
 * @returns {number}
 */
export const brightenColor = (hex, factor) => {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((hex & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
};

/**
 * Linearly interpolates between two packed hex colours.
 *
 * @param {number} from - 0xRRGGBB
 * @param {number} to   - 0xRRGGBB
 * @param {number} t    - 0..1
 * @returns {number}
 */
export const lerpColor = (from, to, t) => {
  const r = Math.round(
    ((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * t,
  );
  const g = Math.round(
    ((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * t,
  );
  const b = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * t);
  return (r << 16) | (g << 8) | b;
};

/**
 * Darkens a packed hex colour by multiplying every channel by `factor`.
 *
 * @param {number} hex
 * @param {number} [factor=0.7]
 * @returns {number}
 */
export const darken = (hex, factor = 0.7) => {
  const r = Math.round(((hex >> 16) & 0xff) * factor);
  const g = Math.round(((hex >> 8) & 0xff) * factor);
  const b = Math.round((hex & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
};

/**
 * Reads the CSS custom properties `--color-note-full` and `--color-note-half`
 * from the document root and returns a colour map used by the fingering renderer.
 *
 * Returns fallback greens/blues when running outside a browser.
 *
 * @returns {{ 1: number, d1: number, h: number, dh: number }}
 */
export const getFingeringColors = () => {
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
