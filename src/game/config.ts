// Tunable constants. Values marked "est." are not published anywhere and were picked by feel
// (see docs/NOTES.md); everything else comes from the BALL x PIT Wiki (see ATTRIBUTION.md).

export const TILE = 48;
/** Visible rows; the corridor is always this tall. */
export const ROWS = 15;
/** Widest corridor (segment 3). The world's x axis spans this width. */
export const MAX_COLS = 14;
/** Corridor width per segment: narrow at first, widened at each checkpoint (screenshot estimate). */
export const SEGMENT_COLS = [8, 11, 14] as const;

export const WORLD_W = MAX_COLS * TILE;
export const WORLD_H = ROWS * TILE;

export const CFG = {
  // Player
  playerRadius: 0.3, // tiles, est.
  moveSpeedBase: 4.2, // tiles/s, est.
  moveSpeedPerSpd: 0.09, // wiki rank E: +9% move speed per SPD point above 0 (applied relative to SPD 3)
  shootingMoveMul: 0.6, // est.
  hpPerEnd: 15, // est. (wiki rank S: END × 13.5) → The Warrior: 6 × 15 + 10 = 100
  hpFlat: 10,
  catchRadius: 0.3, // tiles of extra reach beyond touching, est.
  pickupRadius: 1.0, // tiles, est.
  invulnAfterHit: 0.5, // s, est.
  minAimAngle: (20 * Math.PI) / 180, // can't aim flatter than 20° (player report)

  // Balls
  ballRadius: 0.17, // tiles
  babyRadius: 0.13,
  ballSpeedBase: 12.5, // tiles/s, est.
  ballSpeedPerSpd: 0.03, // est. fraction per SPD point relative to SPD 3
  fireRateBase: 4.2, // balls/s at DEX 4, est.
  fireRatePerDex: 0.045, // est. fraction per DEX point relative to DEX 4
  returnSpeed: 5.5, // tiles/s for balls flying back after leaving the bottom (≈2–3 s round trip)
  recallAfter: 6, // s in flight before right-click recall is offered
  /** A fresh Warrior (STR 7) hits for 25–44 with a base ball: damage = STR × wiki range. */
  levelDamage: [1, 1.25, 1.5], // est. (wiki Damage page claims 133/167/200%, ball pages show flat)
  babyDamagePerLea: [2.75, 4.25], // → 11–17 at Leadership 4 (player report)
  babyCountPerLea: 0.75, // wiki rank E → 3 at Leadership 4
  critChanceBase: 0.03, // est.
  critPerDex: 0.005, // est.
  critMul: 2, // est.
  intPowerPerPoint: 0.05, // est. AOE, status and passive power per INT point above 3 (the wiki's rank values contradict each other)

  // Enemies & level
  enemyBaseHp: 80, // est. a 1x enemy at the top of the BONExYARD (3–4 Warrior hits)
  enemyHpGrowthPerRow: 0.009, // est. +0.9% per row into the level
  scrollSpeed: 0.34, // tiles/s, est.
  scrollSpeedEmpty: 1.4, // tiles/s when the lower field is empty, est.
  segmentRows: 56, // rows per segment, est. (3 equal segments)
  meleeRange: 0.55, // tiles from the enemy's box, est.
  meleeWindup: 0.75, // s telegraph (sources: 0.5–1 s)
  meleeCooldown: 1.6, // s, est.

  // XP
  xpFirst: 6, // est.
  xpStep: 2.6, // est. extra XP needed per level

  // Slots
  ballSlots: 4,
  passiveSlots: 4,
} as const;

/**
 * Rules where this remake once differed from the original (changed 2026-10-20, sources in docs/NOTES.md).
 * Each entry says what it used to be: set it back to restore the old behaviour.
 */
export const RULES = {
  /** Hemorrhage's %-of-current-health burst on bosses and minibosses. Was 0.25; the original deals it in full. */
  hemorrhageBossMul: 1,
  /** Reaper's instant kill also works on bosses and minibosses. Was false; the original allows it. */
  reaperKillsBosses: true,
  /** Most damage one hit can deal. Was Infinity (no cap); players report a 9999 cap in the original. */
  maxHitDamage: 9999,
  /** Everflowing Goblet's overheal cap, × max HP, now also applied when healing. Was only applied on level-ups. est. */
  overhealCap: 3,
  /** Wings of the Anointed keeps Fleet Feet's full speed while shooting. Was true; the original replaces it. */
  wingsFullSpeedShooting: false,
  /** Freeze lasts this fraction as long on bosses and minibosses. Unchanged; no source either way. est. */
  bossFreezeMul: 0.3,
};

export const T = (tiles: number) => tiles * TILE;
