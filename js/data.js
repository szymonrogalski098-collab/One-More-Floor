'use strict';
// Static game data: palette, enemies, upgrades, meta progression, bosses.

const COL = {
  bg: '#0b0a1a',
  player: '#4df3ff',
  playerCore: '#eafcff',
  pBullet: '#7ff6ff',
  pCrit: '#ffd44d',
  eBullet: '#ff4f8b',
  shard: '#9d8cff',
  heart: '#ff5c7a',
  gold: '#ffd44d',
  frost: '#9fe6ff',
  burn: '#ff8a3d',
  arc: '#c9a4ff',
  warden: '#ffb13d',
  loom: '#c77dff',
  mirror: '#5cf2c4',
};

const WALL = 12;

// ---------- Enemies ----------
// cost = spawn budget units, w = base spawn weight
const ENEMY = {
  grunt:    { name: 'Skitter',    hp: 20, r: 9,  speed: 74, color: '#ff4fd8', cost: 1,   minFloor: 1, w: 3 },
  spitter:  { name: 'Spitter',    hp: 24, r: 10, speed: 56, color: '#ffa53d', cost: 1.5, minFloor: 2, w: 2.2 },
  charger:  { name: 'Ram',        hp: 38, r: 12, speed: 62, color: '#ff5a5a', cost: 2,   minFloor: 3, w: 1.6 },
  blob:     { name: 'Blob',       hp: 46, r: 13, speed: 42, color: '#5dff8f', cost: 2,   minFloor: 4, w: 1.3 },
  bomber:   { name: 'Fuse',       hp: 16, r: 9,  speed: 98, color: '#ffe14d', cost: 1.5, minFloor: 6, w: 1.3 },
  sentinel: { name: 'Sentinel',   hp: 64, r: 14, speed: 24, color: '#b36bff', cost: 3,   minFloor: 8, w: 0.9 },
  mini:     { name: 'Blobling',   hp: 13, r: 7,  speed: 90, color: '#5dff8f', cost: 0.5, minFloor: 99, w: 0 },
  fake:     { name: 'Reflection', hp: 40, r: 24, speed: 60, color: COL.mirror, cost: 0, minFloor: 99, w: 0 },
};

// ---------- Upgrade tags (build archetypes) ----------
const TAGS = {
  core:    { name: 'CORE',      color: '#e9e6ff' },
  spray:   { name: 'SPRAY',     color: '#4df3ff' },
  crit:    { name: 'PRECISION', color: '#ffd44d' },
  element: { name: 'ELEMENT',   color: '#c38bff' },
  dash:    { name: 'DASH',      color: '#8dff6a' },
  tank:    { name: 'ARMOR',     color: '#ff6f91' },
};

const RARITY = [
  { name: 'COMMON', color: '#cfd3ff' },
  { name: 'RARE',   color: '#56b6ff' },
  { name: 'EPIC',   color: '#ffb13d' },
];

// mod(s, n): apply n stacks to stats object. onPick(): one-shot effect when taken.
// req: stat that must be > 0 before the card is offered (e.g. 'orbit' = you own blades). unlockBy: shares another upgrade's Workshop blueprint.
const UPGRADES = [
  { id: 'power',   name: 'Power Core',       icon: 'DMG', rarity: 0, tag: 'core',    max: 8, desc: '+20% damage.',
    mod: (s, n) => { s.dmgMul += 0.2 * n; } },
  { id: 'rapid',   name: 'Rapid Cycle',      icon: 'ROF', rarity: 0, tag: 'spray',   max: 8, desc: '+15% fire rate.',
    mod: (s, n) => { s.rofMul += 0.15 * n; } },
  { id: 'swift',   name: 'Kinetic Boots',    icon: 'SPD', rarity: 0, tag: 'dash',    max: 4, desc: '+10% movement speed.',
    mod: (s, n) => { s.move *= 1 + 0.1 * n; } },
  { id: 'vital',   name: 'Vital Plating',    icon: 'HP+', rarity: 0, tag: 'tank',    max: 5, desc: '+1 max HP and heals 1 HP.',
    mod: (s, n) => { s.maxHp += n; }, onPick: () => healPlayer(1) },
  { id: 'rail',    name: 'Rail Barrel',      icon: 'VEL', rarity: 0, tag: 'crit',    max: 3, desc: '+25% bullet speed, +20% range.',
    mod: (s, n) => { s.bSpeed *= 1 + 0.25 * n; s.range *= 1 + 0.2 * n; } },
  { id: 'lens',    name: 'Focus Lens',       icon: 'CRT', rarity: 0, tag: 'crit',    max: 5, desc: '+8% critical hit chance.',
    mod: (s, n) => { s.crit += 0.08 * n; } },
  { id: 'thruster',name: 'Thruster',         icon: 'CD',  rarity: 0, tag: 'dash',    max: 3, desc: '−20% dash cooldown.',
    mod: (s, n) => { s.dashCd *= Math.pow(0.8, n); } },
  { id: 'mender',  name: 'Mender',           icon: 'REG', rarity: 0, tag: 'tank',    max: 3, desc: 'Heals 2 HP now and +1 HP after every cleared floor.',
    mod: (s, n) => { s.regen += n; }, onPick: () => healPlayer(2) },
  { id: 'spin',    name: 'Spin Coil',        icon: 'SPN', rarity: 0, tag: 'tank',    max: 6, desc: 'Blade Halo spins 5% faster and hits more often.', req: 'orbit',
    mod: (s, n) => { s.orbitSpd += 0.05 * n; } },

  { id: 'split',   name: 'Splitter',         icon: 'x2',  rarity: 1, tag: 'spray',   max: 4, desc: '+1 bullet per volley (each bullet slightly weaker).',
    mod: (s, n) => { s.proj += n; } },
  { id: 'drill',   name: 'Drill Rounds',     icon: 'PRC', rarity: 1, tag: 'crit',    max: 3, desc: 'Bullets pierce +1 enemy.',
    mod: (s, n) => { s.pierce += n; } },
  { id: 'rubber',  name: 'Ricochet',         icon: 'BNC', rarity: 1, tag: 'spray',   max: 3, desc: 'Bullets bounce off walls and pillars +1 time.',
    mod: (s, n) => { s.bounce += n; } },
  { id: 'arc',     name: 'Arc Coil',         icon: 'ARC', rarity: 1, tag: 'element', max: 3, desc: 'Hits chain lightning to +1 nearby enemy (40% damage).',
    mod: (s, n) => { s.chain += n; } },
  { id: 'cryo',    name: 'Cryo Rounds',      icon: 'ICE', rarity: 1, tag: 'element', max: 2, desc: 'Hits slow enemies by 30% (+15%).',
    mod: (s, n) => { s.frost += n; } },
  { id: 'ember',   name: 'Ember',            icon: 'BRN', rarity: 1, tag: 'element', max: 3, desc: 'Hits ignite enemies: 30% damage/s for 2.5 s.',
    mod: (s, n) => { s.burn += n; } },
  { id: 'twin',    name: 'Twin Thrusters',   icon: '2DS', rarity: 1, tag: 'dash',    max: 2, desc: '+1 dash charge.',
    mod: (s, n) => { s.dashCharges += n; } },
  { id: 'aegis',   name: 'Aegis',            icon: 'SHD', rarity: 1, tag: 'tank',    max: 2, desc: 'A shield blocks 1 hit. Recharges after 12 s (−4 s).',
    mod: (s, n) => { s.aegis += n; } },
  { id: 'rear',    name: 'Rear Guard',       icon: 'BCK', rarity: 1, tag: 'spray',   max: 2, desc: '+2 bullets fired sideways and backwards.',
    mod: (s, n) => { s.back += n; } },
  { id: 'exec',    name: 'Executioner',      icon: 'EXE', rarity: 1, tag: 'crit',    max: 3, desc: '+75% critical damage.',
    mod: (s, n) => { s.critMult += 0.75 * n; } },
  { id: 'leech',   name: 'Leech',            icon: 'LCH', rarity: 1, tag: 'tank',    max: 2, desc: '+5% chance for enemies to drop a heart.',
    mod: (s, n) => { s.vamp += 0.05 * n; } },
  { id: 'heavy',   name: 'Heavy Slugs',      icon: 'HVY', rarity: 1, tag: 'crit',    max: 2, desc: '+50% damage, bigger bullets and knockback, −15% fire rate.',
    mod: (s, n) => { s.dmgMul += 0.5 * n; s.bSize *= 1 + 0.45 * n; s.rofMul -= 0.15 * n; s.knock += 0.8 * n; } },
  { id: 'overdrive', name: 'Overdrive Motor', icon: 'OVR', rarity: 1, tag: 'tank',   max: 3, desc: 'Blade Halo spins 10% faster. The first pick also adds a blade.', lock: true, unlockBy: 'halo',
    mod: (s, n) => { s.orbitSpd += 0.1 * n; s.orbit += 1; } },

  { id: 'halo',    name: 'Blade Halo',       icon: 'ORB', rarity: 2, tag: 'tank',    max: 3, desc: '+1 blade orbiting you. Cuts enemies and destroys bullets.', lock: true,
    mod: (s, n) => { s.orbit += n; } },
  { id: 'volatile',name: 'Volatile',         icon: 'VOL', rarity: 2, tag: 'element', max: 2, desc: 'Killed enemies explode, damaging neighbours (chain reactions).', lock: true,
    mod: (s, n) => { s.volatile += n; } },
  { id: 'nova',    name: 'Dash Nova',        icon: 'NOV', rarity: 2, tag: 'dash',    max: 2, desc: 'Ending a dash fires a ring of bullets.', lock: true,
    mod: (s, n) => { s.nova += n; } },
  { id: 'adren',   name: 'Adrenaline',       icon: 'ADR', rarity: 2, tag: 'dash',    max: 1, desc: 'A perfect dodge (dashing through an attack) refreshes your dash and gives +60% fire rate for 3 s.', lock: true,
    mod: (s, n) => { s.adren += n; } },
  { id: 'glass',   name: 'Glass Cannon',     icon: 'GLS', rarity: 2, tag: 'crit',    max: 1, desc: '+70% damage, but −2 max HP.',
    mod: (s, n) => { s.dmgMul += 0.7 * n; s.maxHp -= 2 * n; } },
  { id: 'seeker',  name: 'Seeker Chip',      icon: 'HOM', rarity: 2, tag: 'spray',   max: 1, desc: 'Bullets gently home in on enemies.', lock: true,
    mod: (s, n) => { s.homing += n; } },
  // ---- support lines: a common booster (needs the effect) + a rare that also grants the effect ----
  { id: 'blast',    name: 'Blast Radius',     icon: 'RAD', rarity: 0, tag: 'element', max: 4, desc: 'Volatile explosions are 12% larger.', req: 'volatile',
    mod: (s, n) => { s.volR += 0.12 * n; } },
  { id: 'primer',   name: 'Fuse Primer',      icon: 'PRM', rarity: 1, tag: 'element', max: 3, desc: 'Volatile explosions deal 15% more damage. The first pick also grants Volatile.', lock: true, unlockBy: 'volatile',
    mod: (s, n) => { s.volD += 0.15 * n; s.volatile += 1; } },
  { id: 'novashard',name: 'Nova Shards',      icon: 'NSH', rarity: 0, tag: 'dash',    max: 4, desc: 'Dash Nova fires +2 bullets.', req: 'nova',
    mod: (s, n) => { s.novaExtra += 2 * n; } },
  { id: 'capacitor',name: 'Nova Capacitor',   icon: 'CAP', rarity: 1, tag: 'dash',    max: 3, desc: 'Dash Nova bullets deal 15% more damage. The first pick also grants Dash Nova.', lock: true, unlockBy: 'nova',
    mod: (s, n) => { s.novaD += 0.15 * n; s.nova += 1; } },
  { id: 'servo',    name: 'Tracking Servo',   icon: 'SRV', rarity: 0, tag: 'spray',   max: 4, desc: 'Homing bullets turn 15% harder.', req: 'homing',
    mod: (s, n) => { s.homTurn += 0.15 * n; } },
  { id: 'lockon',   name: 'Lock-On Array',    icon: 'LCK', rarity: 1, tag: 'spray',   max: 3, desc: 'Homing reaches 20% further. The first pick also grants Seeker Chip homing.', lock: true, unlockBy: 'seeker',
    mod: (s, n) => { s.homRange += 0.2 * n; s.homing += 1; } },
  { id: 'rush',     name: 'Rush',             icon: 'RSH', rarity: 0, tag: 'dash',    max: 4, desc: 'Adrenaline frenzy lasts 0.5 s longer.', req: 'adren',
    mod: (s, n) => { s.adrenDur += 0.5 * n; } },
  { id: 'reflex',   name: 'Reflex Amp',       icon: 'RFX', rarity: 1, tag: 'dash',    max: 3, desc: 'Perfect-dodge window +25%. The first pick also grants Adrenaline.', lock: true, unlockBy: 'adren',
    mod: (s, n) => { s.dodgeWin += 0.02 * n; s.adren += 1; } },
  { id: 'conduct',  name: 'Conductor',        icon: 'CND', rarity: 0, tag: 'element', max: 4, desc: 'Arc Coil lightning deals 10% more damage.', req: 'chain',
    mod: (s, n) => { s.chainD += 0.1 * n; } },
  { id: 'kindling', name: 'Kindling',         icon: 'KND', rarity: 0, tag: 'element', max: 4, desc: 'Ember burns 10% hotter and 0.5 s longer.', req: 'burn',
    mod: (s, n) => { s.burnD += 0.1 * n; s.burnDur += 0.5 * n; } },
  { id: 'deepfreeze', name: 'Deep Freeze',    icon: 'DFZ', rarity: 0, tag: 'element', max: 4, desc: 'Cryo slow lasts 0.4 s longer.', req: 'frost',
    mod: (s, n) => { s.frostDur += 0.4 * n; } },
  { id: 'recharge', name: 'Quick Recharge',   icon: 'QRC', rarity: 0, tag: 'tank',    max: 4, desc: 'Aegis shield recharges 1.5 s faster.', req: 'aegis',
    mod: (s, n) => { s.aegisCdr += 1.5 * n; } },
];
const UPG = {};
for (const u of UPGRADES) UPG[u.id] = u;

// ---------- Permanent (meta) progression ----------
const META = [
  { id: 'hull',    name: 'Reinforced Hull',  desc: '+1 max HP at the start of each run.',            max: 3, cost: [40, 100, 180] },
  { id: 'core',    name: 'Core Calibration', desc: '+5% base damage.',                               max: 5, cost: [30, 60, 100, 150, 220] },
  { id: 'reroll',  name: 'Reroll Module',    desc: '+1 upgrade reroll per run.',                     max: 2, cost: [60, 160] },
  { id: 'salvage', name: 'Salvage',          desc: '+15% shards at the end of a run.',               max: 3, cost: [50, 110, 200] },
  { id: 'start',   name: 'Head Start',       desc: 'Start each run with a random common upgrade.',   max: 1, cost: [120] },
  { id: 'wind',    name: 'Second Wind',      desc: 'Once per run: get back up with half HP after dying.', max: 1, cost: [320] },
  { id: 'choice',  name: 'Wide Selection',   desc: '+1 upgrade card to choose from (4 instead of 3).', max: 1, cost: [150] },
  { id: 'luck',    name: 'Lucky Draw',       desc: 'Upgrade cards are more often rare or epic.',   max: 3, cost: [70, 130, 220] },
  { id: 'reflexes', name: 'Quick Reflexes',   desc: '−6% dash cooldown.',                          max: 3, cost: [50, 100, 170] },
  { id: 'magnet',  name: 'Magnet Coil',      desc: '+40% pickup radius for shards and hearts.',   max: 2, cost: [40, 90] },
  { id: 'medic',   name: 'Field Medic',      desc: '+1 HP healed by Rest rooms and after each boss.', max: 2, cost: [60, 140] },
  { id: 'u_halo',    name: 'Blueprint: Blade Halo',  desc: 'Unlocks the epic “Blade Halo” and the rare “Overdrive Motor”.', max: 1, cost: [80],  unlock: 'halo' },
  { id: 'u_volatile',name: 'Blueprint: Volatile',    desc: 'Unlocks the epic “Volatile” and the rare “Fuse Primer”.',    max: 1, cost: [90],  unlock: 'volatile' },
  { id: 'u_nova',    name: 'Blueprint: Dash Nova',   desc: 'Unlocks the epic “Dash Nova” and the rare “Nova Capacitor”.',   max: 1, cost: [100], unlock: 'nova' },
  { id: 'u_seeker',  name: 'Blueprint: Seeker Chip', desc: 'Unlocks the epic “Seeker Chip” and the rare “Lock-On Array”.', max: 1, cost: [120], unlock: 'seeker' },
  { id: 'u_adren',   name: 'Blueprint: Adrenaline',  desc: 'Unlocks the epic “Adrenaline” and the rare “Reflex Amp”.',  max: 1, cost: [140], unlock: 'adren' },
];

// ---------- Rooms ----------
const ROOM = {
  combat: { name: 'COMBAT', sub: 'Defeat the enemies',              color: '#4df3ff' },
  elite:  { name: 'ELITE',  sub: 'Stronger enemies, better reward', color: '#ffd44d' },
  rest:   { name: 'REST',   sub: 'A moment to breathe',             color: '#8dff6a' },
  boss:   { name: 'BOSS',   sub: '',                                color: '#ff4f6b' },
};

// ---------- Bosses ----------
const BOSSES = {
  warden: { name: 'TOWER WARDEN', sub: 'Watch the red circle. Get out before it lands.', hp: 1100, r: 26, color: COL.warden },
  loom:   { name: 'THE LOOM',     sub: 'The beams rotate. Run with them.', hp: 1250, r: 24, color: COL.loom },
  mirror: { name: 'THE MIRROR',   sub: 'Only the real one has a solid core.', hp: 1150, r: 24, color: COL.mirror },
};
const BOSS_ORDER = ['warden', 'loom', 'mirror'];

// Difficulty curve per floor.
function floorScale(f) {
  const k = f - 1;
  return {
    hp: 1 + 0.17 * k + 0.011 * k * k,
    spd: Math.min(1.35, 1 + 0.018 * k),
    fire: Math.min(1.6, 1 + 0.03 * k),
    budget: Math.min(34, 5 + f * 1.5),
    maxAlive: Math.min(16, 6 + Math.floor(f * 0.6)),
  };
}
