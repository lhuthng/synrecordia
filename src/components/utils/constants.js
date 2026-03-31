export const DEFAULT_WIDTH = 1200;
export const DEFAULT_HEIGHT = 400;
export const FADE_MS = 500;

export const ZONE_COLOR = 0x444444;
export const MAX_PARTICLES = 400;
export const PARTICLE_RADIUS = 2.5;
export const PARTICLE_LIFETIME_MIN = 0.5;
export const PARTICLE_LIFETIME_MAX = 0.9;
export const PARTICLE_SPAWN_CHANCE = 0.2;

export const NUM_HOLES = 8;
export const NOTE_GLOW_PADDING = 16;
export const HOLE_SIZE = { x: 12, y: 18 };

// 7 gaps between 8 holes (multipliers of size.y)
// [thumb→L1, L1→L2, L2→L3, L3→L4, L4→R1, R1→R2, R2→R3]
export const FINGERING_GAPS = [2, 0.25, 0.25, 2, 0.25, 0.25, 0.25];

export const HOLE_PLAY_SCALE = 1.18;
export const HOLE_SCALE_ALPHA = 0.18;
