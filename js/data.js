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
  grunt:    { name: 'Skoczek',   hp: 20, r: 9,  speed: 74, color: '#ff4fd8', cost: 1,   minFloor: 1, w: 3 },
  spitter:  { name: 'Pluwacz',   hp: 24, r: 10, speed: 56, color: '#ffa53d', cost: 1.5, minFloor: 2, w: 2.2 },
  charger:  { name: 'Taran',     hp: 38, r: 12, speed: 62, color: '#ff5a5a', cost: 2,   minFloor: 3, w: 1.6 },
  blob:     { name: 'Glut',      hp: 46, r: 13, speed: 42, color: '#5dff8f', cost: 2,   minFloor: 4, w: 1.3 },
  bomber:   { name: 'Lont',      hp: 16, r: 9,  speed: 98, color: '#ffe14d', cost: 1.5, minFloor: 6, w: 1.3 },
  sentinel: { name: 'Strażnik',  hp: 64, r: 14, speed: 24, color: '#b36bff', cost: 3,   minFloor: 8, w: 0.9 },
  mini:     { name: 'Glucik',    hp: 13, r: 7,  speed: 90, color: '#5dff8f', cost: 0.5, minFloor: 99, w: 0 },
  fake:     { name: 'Odbicie',   hp: 40, r: 24, speed: 60, color: COL.mirror, cost: 0, minFloor: 99, w: 0 },
};

// ---------- Upgrade tags (build archetypes) ----------
const TAGS = {
  core:    { name: 'RDZEŃ',    color: '#e9e6ff' },
  spray:   { name: 'SALWA',    color: '#4df3ff' },
  crit:    { name: 'PRECYZJA', color: '#ffd44d' },
  element: { name: 'ŻYWIOŁ',   color: '#c38bff' },
  dash:    { name: 'ZRYW',     color: '#8dff6a' },
  tank:    { name: 'PANCERZ',  color: '#ff6f91' },
};

const RARITY = [
  { name: 'ZWYKŁE',   color: '#cfd3ff' },
  { name: 'RZADKIE',  color: '#56b6ff' },
  { name: 'EPICKIE',  color: '#ffb13d' },
];

// mod(s, n): apply n stacks to stats object. onPick(): one-shot effect when taken.
const UPGRADES = [
  { id: 'power',   name: 'Rdzeń Mocy',       icon: 'DMG', rarity: 0, tag: 'core',    max: 8, desc: '+20% obrażeń.',
    mod: (s, n) => { s.dmgMul += 0.2 * n; } },
  { id: 'rapid',   name: 'Szybki Cykl',      icon: 'ROF', rarity: 0, tag: 'spray',   max: 8, desc: '+15% szybkostrzelności.',
    mod: (s, n) => { s.rofMul += 0.15 * n; } },
  { id: 'swift',   name: 'Buty Kinetyczne',  icon: 'SPD', rarity: 0, tag: 'dash',    max: 4, desc: '+10% prędkości ruchu.',
    mod: (s, n) => { s.move *= 1 + 0.1 * n; } },
  { id: 'vital',   name: 'Płyty Witalne',    icon: 'HP+', rarity: 0, tag: 'tank',    max: 5, desc: '+1 maks. HP i leczy 1 HP.',
    mod: (s, n) => { s.maxHp += n; }, onPick: () => healPlayer(1) },
  { id: 'rail',    name: 'Lufa Szynowa',     icon: 'VEL', rarity: 0, tag: 'crit',    max: 3, desc: '+25% prędkości pocisków, +20% zasięgu.',
    mod: (s, n) => { s.bSpeed *= 1 + 0.25 * n; s.range *= 1 + 0.2 * n; } },
  { id: 'lens',    name: 'Soczewka',         icon: 'CRT', rarity: 0, tag: 'crit',    max: 5, desc: '+8% szansy na trafienie krytyczne.',
    mod: (s, n) => { s.crit += 0.08 * n; } },
  { id: 'thruster',name: 'Dopalacz',         icon: 'CD',  rarity: 0, tag: 'dash',    max: 3, desc: '−20% czasu odnowienia dasha.',
    mod: (s, n) => { s.dashCd *= Math.pow(0.8, n); } },
  { id: 'mender',  name: 'Naprawiacz',       icon: 'REG', rarity: 0, tag: 'tank',    max: 3, desc: 'Leczy 2 HP teraz i +1 HP po każdym oczyszczonym piętrze.',
    mod: (s, n) => { s.regen += n; }, onPick: () => healPlayer(2) },

  { id: 'split',   name: 'Rozdzielacz',      icon: 'x2',  rarity: 1, tag: 'spray',   max: 4, desc: '+1 pocisk w salwie (lekko słabsze pojedyncze pociski).',
    mod: (s, n) => { s.proj += n; } },
  { id: 'drill',   name: 'Pociski Wiertła',  icon: 'PRC', rarity: 1, tag: 'crit',    max: 3, desc: 'Pociski przebijają +1 wroga.',
    mod: (s, n) => { s.pierce += n; } },
  { id: 'rubber',  name: 'Rykoszet',         icon: 'BNC', rarity: 1, tag: 'spray',   max: 3, desc: 'Pociski odbijają się od ścian i filarów +1 raz.',
    mod: (s, n) => { s.bounce += n; } },
  { id: 'arc',     name: 'Cewka Łukowa',     icon: 'ARC', rarity: 1, tag: 'element', max: 3, desc: 'Trafienie przeskakuje piorunem na +1 pobliskiego wroga (40% obr.).',
    mod: (s, n) => { s.chain += n; } },
  { id: 'cryo',    name: 'Kriopociski',      icon: 'ICE', rarity: 1, tag: 'element', max: 2, desc: 'Trafienia spowalniają wrogów o 30% (+15%).',
    mod: (s, n) => { s.frost += n; } },
  { id: 'ember',   name: 'Żar',              icon: 'BRN', rarity: 1, tag: 'element', max: 3, desc: 'Trafienia podpalają: 30% obrażeń/s przez 2,5 s.',
    mod: (s, n) => { s.burn += n; } },
  { id: 'twin',    name: 'Podwójny Zryw',    icon: '2DS', rarity: 1, tag: 'dash',    max: 2, desc: '+1 ładunek dasha.',
    mod: (s, n) => { s.dashCharges += n; } },
  { id: 'aegis',   name: 'Egida',            icon: 'SHD', rarity: 1, tag: 'tank',    max: 2, desc: 'Tarcza blokuje 1 trafienie. Odnawia się po 12 s (−4 s).',
    mod: (s, n) => { s.aegis += n; } },
  { id: 'rear',    name: 'Tylna Straż',      icon: 'BCK', rarity: 1, tag: 'spray',   max: 2, desc: '+2 pociski lecące na boki i do tyłu.',
    mod: (s, n) => { s.back += n; } },
  { id: 'exec',    name: 'Egzekutor',        icon: 'EXE', rarity: 1, tag: 'crit',    max: 3, desc: '+75% obrażeń krytycznych.',
    mod: (s, n) => { s.critMult += 0.75 * n; } },
  { id: 'leech',   name: 'Pijawka',          icon: 'LCH', rarity: 1, tag: 'tank',    max: 2, desc: '+5% szansy, że wróg upuści serce.',
    mod: (s, n) => { s.vamp += 0.05 * n; } },
  { id: 'heavy',   name: 'Ciężkie Kule',     icon: 'HVY', rarity: 1, tag: 'crit',    max: 2, desc: '+50% obrażeń, większe pociski i odrzut, −15% szybkostrzelności.',
    mod: (s, n) => { s.dmgMul += 0.5 * n; s.bSize *= 1 + 0.45 * n; s.rofMul -= 0.15 * n; s.knock += 0.8 * n; } },

  { id: 'halo',    name: 'Aureola Ostrzy',   icon: 'ORB', rarity: 2, tag: 'tank',    max: 3, desc: '+1 ostrze krążące wokół Ciebie. Tnie wrogów i niszczy pociski.', lock: true,
    mod: (s, n) => { s.orbit += n; } },
  { id: 'volatile',name: 'Niestabilność',    icon: 'VOL', rarity: 2, tag: 'element', max: 2, desc: 'Zabici wrogowie wybuchają, raniąc sąsiadów (reakcje łańcuchowe).', lock: true,
    mod: (s, n) => { s.volatile += n; } },
  { id: 'nova',    name: 'Nova Zrywu',       icon: 'NOV', rarity: 2, tag: 'dash',    max: 2, desc: 'Koniec dasha wystrzeliwuje pierścień pocisków.', lock: true,
    mod: (s, n) => { s.nova += n; } },
  { id: 'adren',   name: 'Adrenalina',       icon: 'ADR', rarity: 2, tag: 'dash',    max: 1, desc: 'Idealny unik (dash przez atak) odnawia dash i daje +60% szybkostrzelności na 3 s.', lock: true,
    mod: (s, n) => { s.adren += n; } },
  { id: 'glass',   name: 'Szklane Działo',   icon: 'GLS', rarity: 2, tag: 'crit',    max: 1, desc: '+70% obrażeń, ale −2 maks. HP.',
    mod: (s, n) => { s.dmgMul += 0.7 * n; s.maxHp -= 2 * n; } },
  { id: 'seeker',  name: 'Chip Naprowadzający', icon: 'HOM', rarity: 2, tag: 'spray', max: 1, desc: 'Pociski lekko naprowadzają się na wrogów.', lock: true,
    mod: (s, n) => { s.homing += n; } },
];
const UPG = {};
for (const u of UPGRADES) UPG[u.id] = u;

// ---------- Permanent (meta) progression ----------
const META = [
  { id: 'hull',    name: 'Wzmocniony Kadłub', desc: '+1 maks. HP na start runu.',                max: 3, cost: [40, 100, 180] },
  { id: 'core',    name: 'Kalibracja Rdzenia', desc: '+5% obrażeń bazowych.',                    max: 5, cost: [30, 60, 100, 150, 220] },
  { id: 'reroll',  name: 'Moduł Losowania',   desc: '+1 przelosowanie ulepszeń na run.',          max: 2, cost: [60, 160] },
  { id: 'salvage', name: 'Odzysk',            desc: '+15% odłamków na koniec runu.',             max: 3, cost: [50, 110, 200] },
  { id: 'start',   name: 'Rozruch',           desc: 'Zaczynasz run z losowym zwykłym ulepszeniem.', max: 1, cost: [120] },
  { id: 'wind',    name: 'Drugi Oddech',      desc: 'Raz na run: po śmierci wstajesz z połową HP.', max: 1, cost: [320] },
  { id: 'u_halo',    name: 'Schemat: Aureola Ostrzy',  desc: 'Odblokowuje epickie ulepszenie „Aureola Ostrzy”.',   max: 1, cost: [80],  unlock: 'halo' },
  { id: 'u_volatile',name: 'Schemat: Niestabilność',   desc: 'Odblokowuje epickie ulepszenie „Niestabilność”.',    max: 1, cost: [90],  unlock: 'volatile' },
  { id: 'u_nova',    name: 'Schemat: Nova Zrywu',      desc: 'Odblokowuje epickie ulepszenie „Nova Zrywu”.',       max: 1, cost: [100], unlock: 'nova' },
  { id: 'u_seeker',  name: 'Schemat: Chip Naprowadzający', desc: 'Odblokowuje epickie ulepszenie „Chip Naprowadzający”.', max: 1, cost: [120], unlock: 'seeker' },
  { id: 'u_adren',   name: 'Schemat: Adrenalina',      desc: 'Odblokowuje epickie ulepszenie „Adrenalina”.',       max: 1, cost: [140], unlock: 'adren' },
];

// ---------- Rooms ----------
const ROOM = {
  combat: { name: 'WALKA',       sub: 'Pokonaj wrogów',            color: '#4df3ff' },
  elite:  { name: 'ELITA',       sub: 'Silniejsi wrogowie, lepsza nagroda', color: '#ffd44d' },
  rest:   { name: 'ODPOCZYNEK',  sub: 'Chwila oddechu',            color: '#8dff6a' },
  boss:   { name: 'BOSS',        sub: '',                          color: '#ff4f6b' },
};

// ---------- Bosses ----------
const BOSSES = {
  warden: { name: 'STRAŻNIK WIEŻY', sub: 'Obserwuj cień. Uciekaj z kręgu.', hp: 1100, r: 26, color: COL.warden },
  loom:   { name: 'KROSNO',         sub: 'Promienie obracają się. Biegnij z nimi.', hp: 1250, r: 24, color: COL.loom },
  mirror: { name: 'LUSTRO',         sub: 'Tylko prawdziwe ma pełny rdzeń.', hp: 1150, r: 24, color: COL.mirror },
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
