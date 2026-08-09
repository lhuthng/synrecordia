/**
 * BaseVisualizerInstrument
 *
 * Abstract base class for instrument-specific visualizer logic.
 * Subclasses implement how a particular instrument's notes are:
 *   - computed from raw song track data  (computeNoteEvents)
 *   - drawn as static guide overlays     (buildStaticLayer)
 *   - rendered as animated PIXI sprites  (createSprite)
 *   - updated each animation frame       (onTickSprite)
 *
 * The generic usePixiVisualizer hook owns all instrument-agnostic concerns:
 * scroll, zoom, play-bar, lazy sprite allocation, guide lines, particles
 * lifecycle, and pointer interaction.  Instrument-specific concerns are fully
 * delegated to the active instrument instance held in instrumentRef.
 */
export class BaseVisualizerInstrument {
  /**
   * Derive the sorted array of note events that the visualizer will display.
   *
   * Called inside a useMemo in usePixiVisualizer whenever displaySong,
   * fingeringSystem, or transpose changes.  The returned objects are the raw
   * data records stored in noteEventsRef; PIXI containers are created lazily
   * by the ticker via createSprite().
   *
   * Each returned object MUST include at minimum:
   *   { time: number, duration: number, note: string }
   *
   * Subclasses may attach any additional fields needed by createSprite /
   * onTickSprite (e.g. fingering patterns, active-hole positions).
   *
   * @param {object}  track          - Raw track object from song.tracks[n].
   * @param {string}  fingeringSystem - Active fingering system name.
   * @param {number}  transpose       - Semitone offset (positive = up).
   * @param {string}  recorderType      - Recorder type: "soprano"|"alto"|"tenor"|"bass". Defaults to "tenor".
   * @param {object}  instrumentOptions - Instrument-specific overrides (e.g. guitarOptions).
   * @returns {Array<{time: number, duration: number, note: string}>}
   */
  computeNoteEvents(
    _track,
    _fingeringSystem,
    _transpose,
    _recorderType = "tenor",
    _instrumentOptions = {},
  ) {
    return [];
  }

  /**
   * Populate the static (non-scrolling) holesLayer with instrument-specific
   * guide decorations (e.g. horizontal hole guide lines for a recorder).
   *
   * Called once per PIXI init cycle, immediately after the layer is created.
   * The container is already empty; add children directly.
   *
   * @param {import('pixi.js').Container} holesLayer - The static overlay layer.
   * @param {{ width: number, height: number }} params
   */
  // eslint-disable-next-line no-unused-vars
  buildStaticLayer(holesLayer, { width, height }) {
    // No static decorations by default.
  }

  /**
   * Create and return a PIXI sprite bundle for a single note event.
   *
   * Called lazily by the usePixiVisualizer ticker as notes enter the buffered
   * viewport.  The returned object is stored in activeSpriteMapRef and passed
   * back to onTickSprite every frame.
   *
   * The returned bundle MUST include at minimum:
   * ```
   * {
   *   container:      PIXI.Container,   // added to notesLayer by this method
   *   time:           number,           // beat position (same as event.time)
   *   width:          number,           // sprite width in px (without glow padding)
   *   duration:       number,           // beat duration
   *   glowPadding:    number,           // extra px on each side used by glow filters
   *   fadeAlpha:      number,           // starts at 0; hook lerps to 1 each frame
   *   // Optional generic fields the hook already handles:
   *   hoverBg?:       PIXI.Graphics,
   *   hoverState?:    { targetAlpha: number },
   *   brightnessFilter?: ColorMatrixFilter,
   *   brightnessState?:  { current: number, target: number },
   * }
   * ```
   * Any additional instrument-specific fields (e.g. holeSprites, activeHoles)
   * are ignored by the hook and passed through to onTickSprite unchanged.
   *
   * Implementations are responsible for:
   *   - Setting container.x = -spriteWidth - event.time * ppb
   *   - Setting container.y
   *   - Setting container.alpha = 0  (hook will fade it in)
   *   - Calling notesLayer.addChild(container)
   *   - Wiring pointer events (pointerover / pointerout / pointerup)
   *
   * @param {object} event  - A single event object returned by computeNoteEvents.
   * @param {{
   *   ppb:              number,
   *   height:           number,
   *   notesLayer:       import('pixi.js').Container,
  *   scrollDirection:  "ltr" | "rtl",
   *   isPlayingRef:     React.MutableRefObject<boolean>,
   *   hasDraggedRef:    React.MutableRefObject<boolean>,
   *   onNoteClickRef:   React.MutableRefObject<Function|null>,
   *   setIsHoveringNote: (v: boolean) => void,
   * }} params
   * @returns {object} sprite bundle
   */
  // eslint-disable-next-line no-unused-vars
  createSprite(event, params) {
    return null;
  }

  /**
   * Perform per-frame, instrument-specific updates on a single allocated sprite.
   *
   * Called by the usePixiVisualizer ticker for every sprite currently inside
   * the lazy-allocation window, AFTER the hook has already handled:
   *   - fade-in alpha
   *   - viewport visibility culling
   *   - hover-background alpha lerp  (hoverBg / hoverState)
   *   - brightness pulse             (brightnessFilter / brightnessState)
   *
   * Typical uses: hole-scale bounce animation, particle emission.
   *
   * @param {object} sprite  - Sprite bundle returned by createSprite.
   * @param {{
   *   isActive:           boolean,
   *   particleRefs:       { particleLayerRef: React.MutableRefObject, particlesRef: React.MutableRefObject },
   *   particleTextureRef: React.MutableRefObject,
   *   isPlayingRef:       React.MutableRefObject<boolean>,
   *   particlesEnabledRef: React.MutableRefObject<boolean>,
   *   barXRef:            React.MutableRefObject<number>,
   * }} params
   */
  // eslint-disable-next-line no-unused-vars
  onTickSprite(sprite, params) {
    // No instrument-specific tick behaviour by default.
  }
}
