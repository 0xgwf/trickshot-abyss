// SPDX-License-Identifier: CC-BY-SA-4.0
// Game data adapted from the BALL x PIT Wiki (ballxpit.wiki.gg, CC BY-SA 4.0) and the sources listed
// in ATTRIBUTION.md; translated, condensed and partly estimated (see docs/NOTES.md).
// Pit layers. Rosters, mini-bosses, bosses and first-clear rewards follow the wiki's Levels/Enemies pages;
// spawn weights, HP multipliers and palettes are my estimates.

export interface Palette {
  floor: string;
  floorDark: string;
  speck: string;
  cliff: string;
  cliffLight: string;
  cliffDark: string;
  pedestal: string;
  pedestalLight: string;
  pedestalDark: string;
  wallEdge: string;
  deco: 'bone' | 'snow';
  fog: string;
}

export interface LevelDef {
  id: 'boneyard' | 'snowy';
  layer: number;
  zh: string;
  en: string;
  /** HP multiplier on top of the per-row growth (est.). */
  hpMul: number;
  dmgMul: number;
  weights: Record<string, number>[];
  minibosses: [string, string];
  boss: string;
  /** Unlock key required to play (null = always open). */
  requires: string | null;
  /** Unlock key granted by the first clear. */
  grants: string;
  rewards: string[];
  palette: Palette;
}

export const LEVELS: LevelDef[] = [
  {
    id: 'boneyard',
    layer: 1,
    zh: '白骨坟场',
    en: 'The BONExYARD',
    hpMul: 1,
    dmgMul: 1,
    weights: [
      { warrior: 70, archer: 18, behemoth: 12 },
      { warrior: 45, archer: 18, behemoth: 12, brute: 10, beast: 10, bishop: 5 },
      { warrior: 32, archer: 16, behemoth: 10, brute: 12, beast: 12, bishop: 9, bastion: 9 },
    ],
    minibosses: ['brigade', 'ballista'],
    boss: 'king',
    requires: null,
    grants: 'boneyard',
    rewards: ['新关卡：雪漫湾岸', '新角色：快枪手、忏悔者、夫妇', '新弹珠：黑暗', '新被动：压力阀、巫毒娃娃、诅咒灵药'],
    palette: {
      floor: '#3d4a2b',
      floorDark: '#323d23',
      speck: '#4c5a34',
      cliff: '#1b2622',
      cliffLight: '#2a3a33',
      cliffDark: '#121a17',
      pedestal: '#56614d',
      pedestalLight: '#77836c',
      pedestalDark: '#353d30',
      wallEdge: '#4a5e52',
      deco: 'bone',
      fog: '8,12,10',
    },
  },
  {
    id: 'snowy',
    layer: 2,
    zh: '雪漫湾岸',
    en: 'The SNOWYxSHORES',
    hpMul: 1.35,
    dmgMul: 1.15,
    weights: [
      { icewarrior: 62, hurler: 16, shieldbearer: 14, iceband: 8 },
      { icewarrior: 40, hurler: 16, shieldbearer: 14, iceband: 10, icebrute: 10, icebeast: 10 },
      { icewarrior: 28, hurler: 15, shieldbearer: 14, iceband: 10, icebrute: 11, icebeast: 11, icebastion: 11 },
    ],
    minibosses: ['champion', 'howler'],
    boss: 'queen',
    requires: 'boneyard',
    grants: 'snowy',
    rewards: ['新角色：沉思者、顽固老兵、空巢老人', '新弹珠：岩石', '新被动：金牛、治疗石像、弓手石像'],
    palette: {
      floor: '#7c84b6',
      floorDark: '#6a71a2',
      speck: '#aab2e2',
      cliff: '#1d2140',
      cliffLight: '#2c3260',
      cliffDark: '#141730',
      pedestal: '#8c96c4',
      pedestalLight: '#b8c2ec',
      pedestalDark: '#5c6494',
      wallEdge: '#c8d0ff',
      deco: 'snow',
      fog: '20,24,52',
    },
  },
];

export const levelById = (id: string) => LEVELS.find((l) => l.id === id) ?? LEVELS[0];
