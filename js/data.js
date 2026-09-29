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
  counter: '#ff6fa8',
  polarity: '#c9b8ff',
  forge: '#ff7a3d',
  keys: '#e6c36a',
  collapse: '#c9955a',
  puppeteer: '#ff5c8a',
  architect: '#ff6fd8',
};

// ---------- Enemies ----------
// cost = spawn budget units, w = base spawn weight
const ENEMY = {
  grunt:    { name: 'Skitter',    hp: 20, r: 9,  speed: 74, color: '#ff4fd8', cost: 1,   minFloor: 1, w: 3 },
  spitter:  { name: 'Spitter',    hp: 24, r: 10, speed: 56, color: '#ffa53d', cost: 1.5, minFloor: 2, w: 2.2 },
  charger:  { name: 'Ram',        hp: 38, r: 12, speed: 62, color: '#ff5a5a', cost: 2,   minFloor: 3, w: 1.6 },
  blob:     { name: 'Blob',       hp: 46, r: 13, speed: 42, color: '#5dff8f', cost: 2,   minFloor: 4, w: 1.3 },
  bomber:   { name: 'Fuse',       hp: 16, r: 9,  speed: 98, color: '#ffe14d', cost: 1.5, minFloor: 6, w: 1.3 },
  sentinel: { name: 'Sentinel',   hp: 64, r: 14, speed: 24, color: '#b36bff', cost: 3,   minFloor: 8, w: 0.9 },
  leaper:   { name: 'Leaper',     hp: 30, r: 10, speed: 58, color: '#4fb8ff', cost: 1.5, minFloor: 4, w: 1.3 },
  sniper:   { name: 'Sniper',     hp: 22, r: 9,  speed: 50, color: '#9aa0ff', cost: 2,   minFloor: 7, w: 1.0 },
  shielder: { name: 'Shielder',   hp: 55, r: 13, speed: 40, color: '#c4cbe0', cost: 2.5, minFloor: 9, w: 1.0 },
  brood:    { name: 'Brood',      hp: 60, r: 14, speed: 30, color: '#b8ff3d', cost: 3,   minFloor: 11, w: 0.8 },
  mortar:   { name: 'Mortar',     hp: 42, r: 12, speed: 26, color: '#d8a058', cost: 2.5, minFloor: 12, w: 0.8 },
  mite:     { name: 'Mite',       hp: 6,  r: 5,  speed: 115, color: '#b8ff3d', cost: 0.3, minFloor: 99, w: 0 },
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
  { name: 'EVOLUTION', color: '#ff8ff0' },
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
  { id: 'overdrive', name: 'Overdrive Motor', icon: 'OVR', rarity: 1, tag: 'tank',   max: 3, desc: 'Blade Halo spins 10% faster.', lock: true, unlockBy: 'halo', req: 'orbit',
    mod: (s, n) => { s.orbitSpd += 0.1 * n; } },

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
  // ---- evolutions: evo = [maxed upgrade, owned upgrade]; offered as a special card once the recipe is met ----
  { id: 'e_napalm',  name: 'Napalm',          icon: 'NPM', rarity: 3, tag: 'element', max: 1, evo: ['ember', 'volatile'],
    desc: 'Volatile explosions set everything they hit on fire. Burns +50% hotter.', mod: (s) => { s.napalm = 1; s.burnD += 0.5; } },
  { id: 'e_railgun', name: 'Railgun',         icon: 'RLG', rarity: 3, tag: 'crit',    max: 1, evo: ['rail', 'drill'],
    desc: 'Bullets pierce +3 enemies, fly 50% faster and deal +30% damage.', mod: (s) => { s.pierce += 3; s.bSpeed *= 1.5; s.dmgMul += 0.3; } },
  { id: 'e_storm',   name: 'Storm Core',      icon: 'STM', rarity: 3, tag: 'element', max: 1, evo: ['arc', 'rapid'],
    desc: 'Lightning chains to +2 more enemies and deals +50% damage.', mod: (s) => { s.chain += 2; s.chainD += 0.5; } },
  { id: 'e_zero',    name: 'Absolute Zero',   icon: 'ABZ', rarity: 3, tag: 'element', max: 1, evo: ['cryo', 'lens'],
    desc: 'Slowed enemies take +40% damage. Slows last 1 s longer.', mod: (s) => { s.frostDmg = 0.4; s.frostDur += 1; } },
  { id: 'e_storm2',  name: 'Bullet Storm',    icon: 'BST', rarity: 3, tag: 'spray',   max: 1, evo: ['split', 'rear'],
    desc: '+2 bullets per volley, +1 rear pair and +20% fire rate.', mod: (s) => { s.proj += 2; s.back += 1; s.rofMul += 0.2; } },
  { id: 'e_phase',   name: 'Phase Walker',    icon: 'PHW', rarity: 3, tag: 'dash',    max: 1, evo: ['twin', 'thruster'],
    desc: '+1 dash charge, −30% dash cooldown and a longer perfect-dodge window.', mod: (s) => { s.dashCharges += 1; s.dashCd *= 0.7; s.dodgeWin += 0.05; } },
  { id: 'e_fortress',name: 'Fortress',        icon: 'FRT', rarity: 3, tag: 'tank',    max: 1, evo: ['aegis', 'vital'],
    desc: '+2 max HP, the shield recharges 4 s faster. Heals you fully now.', mod: (s) => { s.maxHp += 2; s.aegisCdr += 4; }, onPick: () => healPlayer(99) },
  { id: 'e_assassin',name: 'Assassin',        icon: 'ASN', rarity: 3, tag: 'crit',    max: 1, evo: ['exec', 'lens'],
    desc: '+15% critical chance and +150% critical damage.', mod: (s) => { s.crit += 0.15; s.critMult += 1.5; } },
  { id: 'e_buzzsaw', name: 'Buzzsaw',         icon: 'BZS', rarity: 3, tag: 'tank',    max: 1, evo: ['halo', 'spin'],
    desc: '+2 blades and blades spin 30% faster.', mod: (s) => { s.orbit += 2; s.orbitSpd += 0.3; } },
  { id: 'e_super',   name: 'Supernova',       icon: 'SNV', rarity: 3, tag: 'dash',    max: 1, evo: ['nova', 'novashard'],
    desc: 'Dash Nova fires +8 bullets that deal +50% damage.', mod: (s) => { s.novaExtra += 8; s.novaD += 0.5; } },

  // ---- support lines: a common and a rare booster, both offered only once you own the effect ----
  { id: 'blast',    name: 'Blast Radius',     icon: 'RAD', rarity: 0, tag: 'element', max: 4, desc: 'Volatile explosions are 12% larger.', req: 'volatile',
    mod: (s, n) => { s.volR += 0.12 * n; } },
  { id: 'primer',   name: 'Fuse Primer',      icon: 'PRM', rarity: 1, tag: 'element', max: 3, desc: 'Volatile explosions deal 15% more damage.', lock: true, unlockBy: 'volatile', req: 'volatile',
    mod: (s, n) => { s.volD += 0.15 * n; } },
  { id: 'novashard',name: 'Nova Shards',      icon: 'NSH', rarity: 0, tag: 'dash',    max: 4, desc: 'Dash Nova fires +2 bullets.', req: 'nova',
    mod: (s, n) => { s.novaExtra += 2 * n; } },
  { id: 'capacitor',name: 'Nova Capacitor',   icon: 'CAP', rarity: 1, tag: 'dash',    max: 3, desc: 'Dash Nova bullets deal 15% more damage.', lock: true, unlockBy: 'nova', req: 'nova',
    mod: (s, n) => { s.novaD += 0.15 * n; } },
  { id: 'servo',    name: 'Tracking Servo',   icon: 'SRV', rarity: 0, tag: 'spray',   max: 4, desc: 'Homing bullets turn 15% harder.', req: 'homing',
    mod: (s, n) => { s.homTurn += 0.15 * n; } },
  { id: 'lockon',   name: 'Lock-On Array',    icon: 'LCK', rarity: 1, tag: 'spray',   max: 3, desc: 'Homing reaches 20% further.', lock: true, unlockBy: 'seeker', req: 'homing',
    mod: (s, n) => { s.homRange += 0.2 * n; } },
  { id: 'rush',     name: 'Rush',             icon: 'RSH', rarity: 0, tag: 'dash',    max: 4, desc: 'Adrenaline frenzy lasts 0.5 s longer.', req: 'adren',
    mod: (s, n) => { s.adrenDur += 0.5 * n; } },
  { id: 'reflex',   name: 'Reflex Amp',       icon: 'RFX', rarity: 1, tag: 'dash',    max: 3, desc: 'Perfect-dodge window +25%.', lock: true, unlockBy: 'adren', req: 'adren',
    mod: (s, n) => { s.dodgeWin += 0.02 * n; } },
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
  shop:   { name: 'SHOP',   sub: 'Spend this run\'s shards',        color: '#9d8cff' },
  risk:   { name: 'ALTAR',  sub: 'Power for a price',               color: '#ff4f8b' },
  boss:   { name: 'BOSS',   sub: '',                                color: '#ff4f6b' },
};

// ---------- Bosses ----------
const BOSSES = {
  warden: { name: 'TOWER WARDEN', sub: 'Watch the red circle. Get out before it lands.', hp: 1100, r: 26, color: COL.warden },
  loom:   { name: 'THE LOOM',     sub: 'The beams rotate. Run with them.', hp: 1250, r: 24, color: COL.loom },
  mirror: { name: 'THE MIRROR',   sub: 'Only the real one has a solid core.', hp: 1150, r: 24, color: COL.mirror },
  elevator: { name: 'THE COUNTERWEIGHT', sub: 'It cannot be hurt. Survive the ride — dashing will not save you.', hp: 1, r: 30, color: COL.counter, side: true },
  polarity: { name: 'THE POLARITY', sub: 'Your dash now swaps colour. Absorb your colour, avoid the other.', hp: 1300, r: 26, color: COL.polarity, special: true },
  forge:  { name: 'THE FORGEMASTER', sub: 'Mind the lava. Every shockwave has a gap.', hp: 1400, r: 27, color: COL.forge },
  keys:      { name: 'THE WARDEN OF KEYS', sub: 'Light the four seals. It hears every dash.', hp: 400, r: 13, color: COL.keys, special: true },
  collapse:  { name: 'THE COLLAPSE',  sub: 'The bridge will not wait. Keep moving.', hp: 1100, r: 34, color: COL.collapse, special: true },
  puppeteer: { name: 'THE PUPPETEER', sub: 'Pull far away to snap the strings.', hp: 1600, r: 24, color: COL.puppeteer },
  architect: { name: 'THE ARCHITECT', sub: 'The summit. It builds the arena against you.', hp: 2200, r: 28, color: COL.architect },
};
// boss floors 5..30, then the cycle repeats as II, III … variants
const BOSS_ORDER = ['warden', 'loom', 'mirror', 'elevator', 'polarity', 'forge', 'keys', 'collapse', 'puppeteer', 'architect'];
function bossKindFor(floor) { return BOSS_ORDER[(Math.floor(floor / 5) - 1) % BOSS_ORDER.length]; }
function bossCycle(floor) { return Math.floor((Math.floor(floor / 5) - 1) / BOSS_ORDER.length); }

// ---------- Ships (playable craft) ----------
// mod(s): applied before run upgrades. Unlocked by a challenge or bought with shards.
const SHIPS = [
  { id: 'striker', name: 'Striker', color: '#4df3ff', cost: 0, desc: 'Balanced all-rounder.', mod: () => {} },
  { id: 'lancer',  name: 'Lancer',  color: '#ffd44d', cost: 450, desc: 'Heavy piercing shots: +70% damage, +1 pierce, faster bullets, −35% fire rate.',
    mod: (s) => { s.dmgMul += 0.7; s.rofMul -= 0.35; s.pierce += 1; s.bSpeed *= 1.3; s.bSize *= 1.2; } },
  { id: 'scatter', name: 'Scatter', color: '#8dff6a', cost: 450, desc: 'Three-shot spread from the start, −20% range.',
    mod: (s) => { s.proj += 2; s.range *= 0.8; } },
  { id: 'phantom', name: 'Phantom', color: '#c38bff', cost: 550, desc: '+1 dash charge, −25% dash cooldown, +10% speed, −1 max HP.',
    mod: (s) => { s.dashCharges += 1; s.dashCd *= 0.75; s.move *= 1.1; s.maxHp -= 1; } },
  { id: 'bulwark', name: 'Bulwark', color: '#ff9e5e', cost: 550, desc: '+2 max HP and an Aegis shield, −10% speed.',
    mod: (s) => { s.maxHp += 2; s.aegis += 1; s.move *= 0.9; } },
];
const SHIP = {};
for (const sh of SHIPS) SHIP[sh.id] = sh;

// ---------- Ascension (difficulty tiers after beating floor 15) ----------
const ASCENSION = [
  'Enemies have +15% HP',
  'Enemy bullets are 12% faster',
  'An elite joins every combat floor',
  'Hearts drop half as often',
  'Bosses have +25% HP',
  'Enemies move 12% faster',
  'Spike traps in most rooms',
  'Start with 1 less max HP',
  'Bosses start enraged',
  'Enemies have another +20% HP',
];
// Floors without enemies: one room with a station in the middle (step in to use it).
const CALM_ROOMS = ['rest', 'shop', 'risk'];
function isCalm(type) { return CALM_ROOMS.includes(type); }

// ---------- Shop (spend the shards collected in this run: whatever you spend is not paid out at the end) ----------
function shopPrice(u, floor) { return Math.round([14, 24, 40][u.rarity] * (1 + floor * 0.02)); }
const SHOP_HEAL = { hp: 2, price: 10 };
const SHOP_REROLL_PRICE = 6;

// ---------- Before a run: supplies (one-run consumables) and the wager, paid with banked shards ----------
const SUPPLIES = [
  { id: 'card',   name: 'Starter Card',  icon: 'CRD', cost: 80,  desc: 'Start with a random rare upgrade.' },
  { id: 'coins',  name: 'Pocket Shards', icon: 'PKT', cost: 60,  desc: '+20 shards to spend in shops (not paid out at the end).' },
  { id: 'heart',  name: 'Spare Heart',   icon: 'HRT', cost: 100, desc: '+1 max HP for this run.' },
  { id: 'reroll', name: 'Reroll Pack',   icon: 'RRL', cost: 50,  desc: '+2 rerolls.' },
  { id: 'revive', name: 'Last Breath',   icon: 'LBR', cost: 150, desc: 'One extra revive with full HP.' },
];
const SUPPLY = Object.fromEntries(SUPPLIES.map((x) => [x.id, x]));
const SUPPLY_MAX = 2;
const WAGER_STAKES = [100, 250, 500];
// the wager pays double when you reach a floor near your record (never less than 10 floors of climbing)
function wagerTarget(start, best) { return Math.max(start + 10, Math.ceil((best * 0.8) / 5) * 5); }
const SHOP_TRADE = { cost: 100, gain: 10 }; // banked shards -> shop shards, once per shop

// ---------- Curses (the altar trades an epic/rare upgrade for one of these, for the rest of the run) ----------
const CURSES = [
  { id: 'frail',   name: 'Frail',       icon: 'FRL', desc: '−1 max HP.' },
  { id: 'hunted',  name: 'Hunted',      icon: 'HNT', desc: 'Enemies move 15% faster.' },
  { id: 'barrage', name: 'Barrage',     icon: 'BRG', desc: 'Enemy bullets fly 15% faster.' },
  { id: 'myopia',  name: 'Short Sight', icon: 'SHT', desc: '−20% range.' },
  { id: 'sluggish',name: 'Sluggish',    icon: 'SLG', desc: '+25% dash cooldown.' },
  { id: 'greed',   name: 'Greed',       icon: 'GRD', desc: 'Enemies drop 40% fewer shards.' },
];
const CURSE = {};
for (const c of CURSES) CURSE[c.id] = c;
function cursed(id) { return !!(G.run && G.run.curses && G.run.curses.includes(id)); }

// ---------- Checkpoints ----------
// Beating the boss on floor 5k unlocks starting a run on floor 5k+1 (per ascension level).
// Starting there gives a starting kit (upgrade picks with better odds) and extra rerolls;
// floors below the checkpoint pay no shards.
function checkpointKit(start) { const skipped = Math.floor((start - 1) / 5); return { picks: 1 + skipped * 2, rerolls: skipped }; }
// No build remembered for a checkpoint yet: the kit comes with a few fixed upgrades on top.
function checkpointBonus(start) { const sk = Math.floor((start - 1) / 5), b = ['power', 'ember']; if (sk >= 3) b.push('rapid'); if (sk >= 5) b.push('power'); return b; }
// The build a player had when passing a checkpoint (the one that went furthest), per ascension.
function checkpointBuild(asc, start) { const b = ((Save.data.cpBuilds || {})[asc | 0] || {})[start]; return b && b.order && b.order.length ? b : null; }
function checkpointsFor(asc) { const max = (Save.data.checkpoints || {})[asc | 0] | 0, out = [1]; for (let f = 6; f <= max; f += 5) out.push(f); return out; }

function ascMod(n) { const a = (G.run && G.run.asc) | 0; return a >= n; }

// ---------- Challenges ----------
// check(ctx) is evaluated on events; reward: shards and/or a ship.
const CHALLENGES = [
  { id: 'f5',      name: 'First Steps',     desc: 'Reach floor 5.',                         reward: { shards: 50 } },
  { id: 'warden',  name: 'Warden Down',     desc: 'Defeat the Tower Warden.',               reward: { shards: 60 } },
  { id: 'loom',    name: 'Loom Breaker',    desc: 'Defeat The Loom.',                       reward: { ship: 'lancer' } },
  { id: 'mirror',  name: 'Shattered',       desc: 'Defeat The Mirror (unlocks Ascension).', reward: { shards: 150 } },
  { id: 'counter', name: 'Going Up',        desc: 'Survive The Counterweight.',             reward: { shards: 150 } },
  { id: 'polarity', name: 'Opposites Attract', desc: 'Defeat The Polarity.',                reward: { shards: 180 } },
  { id: 'forge',   name: 'Quenched',        desc: 'Defeat The Forgemaster.',                reward: { shards: 220 } },
  { id: 'keys',     name: 'Escape Artist',  desc: 'Bury The Warden of Keys.',              reward: { shards: 250 } },
  { id: 'collapse', name: 'Bridge Burner',  desc: 'Defeat The Collapse.',                  reward: { shards: 280 } },
  { id: 'puppeteer',name: 'Cut the Strings', desc: 'Defeat The Puppeteer.',                reward: { shards: 320 } },
  { id: 'summit',  name: 'The Summit',      desc: 'Defeat The Architect on floor 50.',      reward: { shards: 800 } },
  { id: 'flawless', name: 'Flawless Ascent', desc: 'Reach the boss on floor 25 without taking a single hit (full run from floor 1).', reward: { shards: 500 } },
  { id: 'ironwill', name: 'Iron Will',       desc: 'Lose 30 HP in one run and still reach floor 40.', reward: { shards: 400 } },
  { id: 'f20',     name: 'Deep Climber',    desc: 'Reach floor 20.',                        reward: { ship: 'scatter' } },
  { id: 'f30',     name: 'Summit Seeker',   desc: 'Reach floor 30.',                        reward: { shards: 400 } },
  { id: 'nohit',   name: 'Untouchable',     desc: 'Defeat a boss without taking damage.',   reward: { ship: 'phantom' } },
  { id: 'build12', name: 'Full Arsenal',    desc: 'Own 12 different upgrades in one run.',  reward: { ship: 'bulwark' } },
  { id: 'kills1k', name: 'Exterminator',    desc: 'Defeat 1000 enemies in total.',          reward: { shards: 150 } },
  { id: 'hoard',   name: 'Hoarder',         desc: 'Collect 200 shards in one run.',         reward: { shards: 100 } },
  { id: 'speed10', name: 'Speed Climber',   desc: 'Reach floor 10 in under 8 minutes.',     reward: { shards: 120 } },
  { id: 'dodge25', name: 'Perfect Reflexes', desc: 'Make 25 perfect dodges in one run.',    reward: { shards: 100 } },
  { id: 'elite20', name: 'Elite Hunter',    desc: 'Defeat 20 elites in one run.',           reward: { shards: 120 } },
  { id: 'asc3',    name: 'Ascended',        desc: 'Defeat The Mirror on Ascension 3+.',     reward: { shards: 250 } },
  { id: 'asc10',   name: 'Top of the Tower', desc: 'Defeat The Mirror on Ascension 10.',    reward: { shards: 1000 } },
  { id: 'ships',   name: 'Hangar Full',     desc: 'Own every ship.',                        reward: { shards: 300 } },
];

// Difficulty curve per floor.
function floorScale(f) {
  const k = f - 1;
  return {
    hp: (1 + 0.17 * k + 0.011 * k * k) * (ascMod(1) ? 1.15 : 1) * (ascMod(10) ? 1.2 : 1),
    spd: Math.min(1.35, 1 + 0.018 * k) * (ascMod(6) ? 1.12 : 1),
    fire: Math.min(1.6, 1 + 0.03 * k),
    budget: Math.min(34, 5 + f * 1.5),
    maxAlive: Math.min(16, 6 + Math.floor(f * 0.6)),
  };
}
