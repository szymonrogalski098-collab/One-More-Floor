'use strict';
// Shop and altar live in the room (no overlay screen). The stairs are open from the start: step onto a
// pedestal to see what it is and buy it, or just walk past to the next floor.
//  Shop:  three upgrades on pedestals, a repair kit, a reroll bell and the trade box on a rug.
//  Altar: a ritual circle; each stone shows a pact "sacrifice → receive". Accepting one breaks the others.

function stallSpots(n, fy) {
  const rm = G.exitRoom, out = [];
  for (let i = 0; i < n; i++) out.push({ x: rm.x + rm.w * ((i + 1) / (n + 1)), y: rm.y + rm.h * fy });
  return out;
}
function shopItemsFor(list) {
  return list.slice(0, 3).map((u) => ({ type: 'up', id: u.id, price: shopPrice(u, G.run.floor), sold: false }));
}

// ---------- shop ----------
function openShop() {
  // portrait: two rows of three; a wide (landscape) room: one row of six
  const rm0 = G.exitRoom, wide = rm0.w > rm0.h * 1.3, row = stallSpots(6, 0.52);
  const ups = shopItemsFor(rollChoices('shop')), spots = wide ? row.slice(0, 3) : stallSpots(3, 0.42), util = wide ? row.slice(3) : stallSpots(3, 0.64);
  ups.forEach((it, i) => Object.assign(it, spots[i]));
  const items = ups.concat([
    { type: 'heal', ...util[0], price: SHOP_HEAL.price, sold: false },
    { type: 'reroll', ...util[1], price: SHOP_REROLL_PRICE },
    { type: 'trade', ...util[2], sold: false },
  ]);
  G.stall = { kind: 'shop', items, wide, done: false };
  G.shop = G.stall; // older code paths (tests, trade flag) read G.shop
}
function shopUps() { return G.stall ? G.stall.items.filter((x) => x.type === 'up') : []; }
function shopBuy(i) {
  const it = shopUps()[i];
  if (!it || it.sold || !shopPay(it.price)) { sfx('hurt'); return false; }
  it.sold = true;
  addUpgrade(it.id);
  sfx('buy'); ring(it.x, it.y, 6, 40, 0.4, TAGS[UPG[it.id].tag].color, 3);
  floatText(it.x, it.y - 30, UPG[it.id].name.toUpperCase(), TAGS[UPG[it.id].tag].color, 12, 1.2);
  stallChanged();
  return true;
}
function shopHeal() {
  const it = G.stall && G.stall.items.find((x) => x.type === 'heal');
  if (!it || it.sold || G.player.hp >= G.stats.maxHp || !shopPay(SHOP_HEAL.price)) return false;
  it.sold = true; G.stall.healBought = true;
  healPlayer(SHOP_HEAL.hp); sfx('buy');
  stallChanged();
  return true;
}
function shopReroll() {
  if (!G.stall || !shopPay(SHOP_REROLL_PRICE)) return false;
  const ups = shopUps(), sold = ups.filter((x) => x.sold).map((x) => x.id);
  const fresh = shopItemsFor(rollChoices('shop').filter((u) => !sold.includes(u.id)));
  let k = 0;
  for (const it of ups) if (!it.sold && fresh[k]) { Object.assign(it, { id: fresh[k].id, price: fresh[k].price }); k++; ring(it.x, it.y, 4, 30, 0.3, '#ffffff', 2); }
  sfx('select');
  stallChanged();
  return true;
}
// trade banked shards for shop shards (once per shop)
function shopTrade() {
  const S = Save.data, it = G.stall && G.stall.items.find((x) => x.type === 'trade');
  if (!it || it.sold || S.shards < SHOP_TRADE.cost) return false;
  S.shards -= SHOP_TRADE.cost; Save.save();
  G.run.shards += SHOP_TRADE.gain; G.run.gift = (G.run.gift | 0) + SHOP_TRADE.gain;
  it.sold = true; G.stall.traded = true;
  sfx('buy'); G.hudDirty = true;
  stallChanged();
  return true;
}
function shopLeave() { UI.stallInfo(null); } // nothing to leave: the stairs are already open

// ---------- altar ----------
// One pact asks for one of your upgrades instead of a curse (one you rely on least: not your favourite tags).
function openAltar() {
  const offers = altarOffers(), tastes = runTastes(), run = G.run;
  const spare = run.order.map((id) => UPG[id]).filter((u) => u && !u.evo && !tastes.slice(0, 2).includes(u.tag) && !offers.some((o) => o.id === u.id))
    .sort((a, b) => a.rarity * 3 + run.upgrades[a.id] - (b.rarity * 3 + run.upgrades[b.id]));
  if (spare.length && offers.length >= 2) { const o = offers[offers.length - 1]; o.lose = spare[0].id; o.curse = null; }
  const rm = G.exitRoom, c = { x: rm.x + rm.w / 2, y: rm.y + rm.h * 0.42 }, R = Math.min(rm.w * 0.36, 120);
  offers.forEach((o, i) => { const a = Math.PI / 2 + (i - (offers.length - 1) / 2) * 0.95; o.type = 'pact'; o.x = c.x + Math.cos(a) * R; o.y = c.y + Math.sin(a) * R * 0.85; });
  G.stall = { kind: 'altar', items: offers, center: c, R, done: false };
  G.altar = offers;
}
function altarChoose(i) {
  const o = G.altar && G.altar[i];
  if (!o || G.stall.done) { UI.stallInfo(null); return false; }
  const run = G.run, p = G.player;
  if (o.curse) run.curses.push(o.curse);
  if (o.lose) { delete run.upgrades[o.lose]; run.order = run.order.filter((id) => id !== o.lose); }
  for (let k = 0; k < (o.levels || 1); k++) addUpgrade(o.id);
  computeStats();
  o.taken = true; G.stall.done = true;
  sfx('upgrade'); addShake(0.3);
  ring(o.x, o.y, 6, 80, 0.6, '#ff4f8b', 4);
  for (const x of G.altar) if (x !== o) burst(x.x, x.y, '#5a4a5e', 12, 120, 0.5, 3);
  floatText(p.x, p.y - 44, o.curse ? CURSE[o.curse].name.toUpperCase() : UPG[o.lose].name.toUpperCase() + ' GIVEN', '#ff4f8b', 13, 1.6);
  stallChanged();
  return true;
}

// ---------- walking around ----------
function stallChanged() { saveSnapshot(); G.hudDirty = true; UI.stallInfo(G.stallOn || null); }
function updateStall() {
  const S = G.stall;
  if (!S) return;
  const p = G.player;
  let on = null;
  for (const it of S.items) if (dist2(it.x, it.y, p.x, p.y) < 26 * 26) { on = it; break; }
  if (on !== G.stallOn) { G.stallOn = on; UI.stallInfo(on); }
}
// the button on the info panel
function stallUse() {
  const it = G.stallOn, S = G.stall;
  if (!it || !S || G.state !== 'play') return;
  if (it.type === 'up') shopBuy(shopUps().indexOf(it));
  else if (it.type === 'heal') shopHeal();
  else if (it.type === 'reroll') shopReroll();
  else if (it.type === 'trade') shopTrade();
  else if (it.type === 'pact') altarChoose(G.altar.indexOf(it));
}
