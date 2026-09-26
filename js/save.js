'use strict';
// Local persistence (localStorage). Never throws: storage may be unavailable (private mode).

const SAVE_KEY = 'omf_save_v1';

function defaultSave() {
  return {
    v: 1,
    shards: 0,
    lifetimeShards: 0,
    runs: 0,
    best: { floor: 0, kills: 0, time: 0 },
    totals: { kills: 0, bosses: 0, floors: 0, time: 0 },
    meta: {},
    history: [],
    snapshot: null,
    settings: {
      sound: true, music: true, sfxVol: 0.8, musVol: 0.45,
      shake: true, quality: 'auto', lefty: false, tutorialDone: false,
    },
  };
}

function mergeDefaults(target, def) {
  for (const k in def) {
    if (target[k] === undefined || target[k] === null && def[k] !== null) target[k] = def[k];
    else if (def[k] && typeof def[k] === 'object' && !Array.isArray(def[k]) && typeof target[k] === 'object') mergeDefaults(target[k], def[k]);
  }
  return target;
}

const Save = {
  data: defaultSave(),
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) this.data = mergeDefaults(JSON.parse(raw), defaultSave());
    } catch (e) {
      this.data = defaultSave();
    }
    return this.data;
  },
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* storage full / blocked */ }
  },
  reset() {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.save();
  },
  metaLvl(id) { return this.data.meta[id] | 0; },
  isUnlocked(upgId) {
    const u = UPG[upgId];
    if (!u || !u.lock) return true;
    const m = META.find((x) => x.unlock === upgId);
    return !!m && this.metaLvl(m.id) > 0;
  },
};
