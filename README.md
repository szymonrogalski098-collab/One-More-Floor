# One More Floor

**Just one more floor.** A fast roguelike / arcade dungeon crawler for your phone, built as a real PWA (installable, works offline). No backend, no build step, no external assets: HTML + CSS + Canvas 2D + Web Audio.

## How to play

The game switches between two control schemes automatically, depending on the last device you used:

| | Phone (touch) | Computer (mouse & keyboard) |
|---|---|---|
| Move | drag anywhere (floating joystick) | WASD / arrow keys |
| Aim | automatic, nearest visible enemy | automatic too (mouse aim can be switched on in Settings) |
| Shoot | automatic | automatic |
| Dash | corner button or a second-finger tap | Space, Shift or a mouse click |
| Pause | pause button | Esc / P (Esc also closes sub-screens) |

On a computer every screen has its own layout (two-column menu, large side-by-side reward cards, two-column Workshop), buttons grow under the mouse, and with mouse aim on the cursor becomes a crosshair in game.

- **DASH:** You are invulnerable while dashing. Dashing through an attack counts as a **perfect dodge** (slow motion, synergy with Adrenaline).
- **Loop:** fight, reward (pick 1 of 3 upgrades), choose a door (Combat / Elite / Rest), next floor. **A boss every 5 floors.**
- **Floors:** combat and elite floors are small dungeons: a safe start room, fight rooms joined by corridors and an exit room with staircases. Rooms vary in shape (cut corners, L-shapes) and cover (pillars, crates, low walls, columns, rings), and some have spike traps that fire only while the room is being fought. Entering a fight room locks its exits (red energy bars) until every wave is cleared; dormant enemies wait in some corridors. A green chevron next to you points to the next room. The camera follows you when the floor is bigger than the screen, and arrows on the screen edge show enemies out of view.
- **Stairs:** staircases are cut into the top wall of the exit room (bottom step on the wall line), one per route (Combat / Elite / Rest / Boss). They are always visible but locked until the whole floor is cleared. Stand on a staircase to see the full map of the floor it leads to (it is generated in advance, so what you see is what you get), then walk up it to climb. You arrive by stepping out of a stair nook in the bottom wall.
- **Save & quit / closing the app** keeps the exact floor: layout, cleared rooms, surviving enemies and your position. A fight that was interrupted restarts with you just outside the room. Boss fights restart from the hall entrance; a boss you already beat stays beaten.
- **Bosses** fight in one big circular hall.
- **Ending a run early:** using *End run* within the first 3 floors of a run earns no shards. After that you keep what you collected.
- **Checkpoints:** beating a boss unlocks starting new runs on the floor after it (6, 11, 16, 21 …), separately for every Ascension level. Pick it with START in the menu. The game remembers the build you carried past every checkpoint (and how far that run got; the build that climbed highest is kept). Starting from a checkpoint gives that **build back minus one random non-epic upgrade**. If no build is remembered yet, you get a **starting kit** instead: Power Core and Ember (plus Rapid Cycle from floor 16 and another Power Core from floor 26) and 1 + 2 per skipped boss upgrade picks with better rarity odds (16 → 7 picks). Either way: +1 reroll per skipped boss and full HP. Floors below the checkpoint pay no shards and do not count for challenges.
- When you die you earn **shards**, which you spend in the **Workshop** on permanent upgrades and unlocks.

### Builds

Every upgrade has a tag. Card rolls slightly favour tags you already collect, so a build forms naturally:

| Tag | Style | Examples |
|---|---|---|
| SPRAY | more bullets | Splitter, Ricochet, Rear Guard, Seeker Chip, Tracking Servo, Lock-On Array |
| PRECISION | crits / sniper | Focus Lens, Executioner, Heavy Slugs, Glass Cannon |
| ELEMENT | status effects | Arc Coil, Ember, Cryo Rounds, Volatile, Conductor, Kindling, Deep Freeze, Blast Radius, Fuse Primer |
| DASH | mobility | Thruster, Twin Thrusters, Dash Nova, Adrenaline, Nova Shards, Nova Capacitor, Rush, Reflex Amp |
| ARMOR | survival | Aegis, Blade Halo, Spin Coil, Overdrive Motor, Mender, Leech, Quick Recharge |

**Upgrade lines.** Every epic effect has a common and a rare booster. Both are offered only once you already own the effect (they never grant it). The rare is unlocked by the same Workshop blueprint as the epic.

| Effect (epic) | Common booster | Rare booster |
|---|---|---|
| Blade Halo | Spin Coil: +5% blade spin | Overdrive Motor: +10% blade spin |
| Volatile | Blast Radius: +12% explosion size | Fuse Primer: +15% explosion damage |
| Dash Nova | Nova Shards: +2 bullets | Nova Capacitor: +15% nova damage |
| Seeker Chip | Tracking Servo: +15% homing turn | Lock-On Array: +20% homing reach |
| Adrenaline | Rush: +0.5 s frenzy | Reflex Amp: +25% perfect-dodge window |

Rare effects get a common booster too: Conductor (Arc Coil +10% damage), Kindling (Ember +10% damage, +0.5 s), Deep Freeze (Cryo +0.4 s), Quick Recharge (Aegis −1.5 s).

### Bosses (each one has a mechanic to learn)

1. **Tower Warden** (floor 5): spiral bullet streams, jump slams (the red circle is locked at take-off, so walk out of it) and aimed fans.
2. **The Loom** (floor 10): rotating lasers (chevrons on the warning line show the rotation direction), laser grids and homing orbs you can shoot down.
3. **The Mirror** (floor 15): splits into copies. **Only the real one has a solid white core**, and a shattered copy fires a ring of bullets. It also dashes from wall to wall leaving bullet trails and summons enemies.
4. **The Counterweight** (floor 20): a different kind of fight. You ride an elevator in **side view** and can only move left/right and dash. The boss hangs in the shaft above you. It **cannot be hurt**, and **dashing does not dodge its attacks** (the dash only moves you faster). Balls fall from above with a red marker at the ceiling: aimed volleys, a curtain with one green gap, a sweep and splitters that burst into three. Its special attack is **CRUSH**: the counterweight drops into the cabin over your half (later over both sides, leaving the middle), and the red zone shows where. Survive until the elevator arrives (the bar shows the ride left), then leave through a side door.
5. **The Orrery** (floor 25): planets orbit the boss and hurt on contact. The orbit expands and contracts, planets are flung at you and come back, and in the eclipse the planets line up and a beam fires along that line.
6. **The Forgemaster** (floor 30): magma lobs leave lava pools, hammer shockwaves spread as rings with one gap (marked green), and the bellows pull you in while embers spiral out.

From floor 35 the bosses return as **II** variants (more HP, rage phase from the start). Below 50% HP every boss except The Counterweight enters a **rage phase**.

### Enemies

Skitter (chaser), Spitter (ranged), Ram (telegraphed charge), Blob (splits), Fuse (suicide bomber), Sentinel (bullet rings), plus from mid floors: **Leaper** (jumps onto your spot — red circle), **Sniper** (laser sight, then a very fast shot), **Shielder** (frontal shield blocks bullets — flank it or use blades/explosions/lightning), **Brood** (hatches mites), **Mortar** (lobs shells with a landing circle). Every type has an elite variant.

### Training

**Training** in the menu is a practice arena with no text and no rewards: choose who and how many, then dodge.
- **Enemies:** pick any mix of Spitters, Snipers, Sentinels and Mortars (up to 12, optionally elite). They stay behind an energy barrier across the middle of the arena and shoot through it; a killed one comes back.
- **Bosses:** any boss you have met, in its real arena; it cannot die (optionally enraged). The Counterweight's ride never ends.
- You cannot die: the HUD counts hits and time. *Shoot back* toggles your auto-fire. Records, checkpoints and the saved run are not touched.

### Long-term goals

- **Ships:** Striker, Lancer, Scatter, Phantom, Bulwark — each changes how a run plays. Unlock them through challenges or buy them in the Workshop hangar.
- **Challenges:** 19 goals (bosses, depth, no-hit boss, speed, builds, ascension) that pay shards or unlock ships.
- **Ascension:** beating The Mirror unlocks Ascension 1; each level adds a modifier (tougher, faster enemies, elites on every floor, fewer hearts, enraged bosses …) and +15% shards. Best floor is tracked per level.

### Permanent progression (Workshop)

Deliberately modest: +3 HP, +25% damage, −18% dash cooldown, rerolls, one extra life, **Wide Selection** (4 upgrade cards instead of 3), **Lucky Draw** (more rare/epic cards), Magnet Coil (pickup radius) and Field Medic (+1 heal from Rest rooms and bosses). On top of that, 5 blueprints unlock epic upgrades and their rare support cards, which means new builds rather than raw power. Skill still decides.

### Built for short sessions

- One-tap restart ("ONE MORE RUN").
- Local records: highest floor, most kills, recent run history.
- The death screen shows how close you were to your record and what you can afford in the Workshop.
- **Continue:** the run is saved at the start of every floor, so closing the app does not lose progress (CONTINUE button in the menu).

## Running locally

The game is plain static files. The simplest way:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/
```

or simulate a GitHub Pages sub-path:

```bash
node tools/serve.js 8080 /One-More-Floor/
# http://localhost:8080/One-More-Floor/
```

Opening `index.html` straight from disk (`file://`) also works, because the scripts are classic scripts rather than ES modules. The service worker and PWA install need HTTP(S) or `localhost`.

On a phone on the same Wi-Fi, open `http://<computer-IP>:8080/`. Installing the PWA needs HTTPS, so GitHub Pages is the easiest route.

## Publishing on GitHub Pages

All paths are **relative** (`./sw.js`, `icons/...`, `start_url: "./"`, `scope: "./"`), so the game works under `https://<user>.github.io/<repo-name>/` with no changes.

**Option A: from a branch (simplest)**
1. Push the files to a branch (e.g. `main`).
2. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick the branch and the `/ (root)` folder, then Save.
4. After a moment the game is live at `https://<user>.github.io/<repo>/`.

**Option B: GitHub Actions** (workflow in `.github/workflows/pages.yml`)
1. **Settings → Pages → Source: GitHub Actions**.
2. Every push to `main` publishes only the game files (without `tools/`).

The `.nojekyll` file disables Jekyll processing.

### Installing on a phone
- **Android / Chrome:** menu → "Install app" (or the button in the game menu).
- **iOS / Safari:** Share → "Add to Home Screen".

After the first launch all files are cached, so the game works **offline**.

### Releasing an update
With every release bump `CACHE_VERSION` in `sw.js` (and `APP_VERSION` in `js/main.js`). The old cache is deleted and the new version loads on the next launch.

## Structure

```
index.html              UI screens + HUD, loads the scripts
manifest.webmanifest    PWA manifest (relative paths)
sw.js                   service worker (precache + offline)
css/style.css           mobile-first styles, safe areas, landscape
js/util.js              math, collisions
js/data.js              enemies, upgrades, Workshop, bosses, difficulty curve
js/save.js              localStorage persistence
js/audio.js             SFX + generative music (Web Audio)
js/input.js             touch joystick, dash, keyboard
js/fx.js                game state, particles, shake, hitstop, slow-mo, quality
js/world.js             arena, pillars, doors, line of sight
js/entities.js          player, bullets, enemies, damage, pickups
js/bosses.js            top-down bosses with attack patterns
js/elevator.js          The Counterweight: side-view elevator boss
js/game.js              run & floor flow, rewards, death, records
js/render.js            Canvas 2D renderer
js/ui.js                DOM screens
js/main.js              loop (fixed 60 Hz step), lifecycle, SW registration
tools/                  dev server, Playwright audits and tests, icon generator
```

## Performance

- Fixed 60 Hz simulation step, rendering in `requestAnimationFrame`, max 5 steps per frame.
- Object pools for bullets and particles, hard caps (bullets, particles, enemies).
- The floor is pre-rendered once per room; glows are cached sprites; enemy bullets are 1 `drawImage` each (or one batched path on low quality).
- **Auto quality:** if the average frame drops below ~45 FPS the game lowers DPR, particle count and glow (only downwards, no oscillation). Quality can also be set manually.
- The game pauses and audio suspends when the tab/app goes to the background.

## Tests / audit

```bash
npm i -D playwright     # or a global playwright with Chromium
npm run serve &         # server under /One-More-Floor/
npm run audit           # bots play runs (fair and god-mode up to floor 31), invariants, JS errors
npm run audit:ui        # 5 device profiles: touch, dash, pause, rewards, doors, bosses,
                        # death, restart, Workshop, settings, continue, manifest, SW, offline
npm run test:slam       # Warden slam must be escapable on foot, target must not move
npm run test:blades     # Blade Halo speed upgrades
npm run test:upgrades   # all upgrade lines + Workshop upgrades (availability and effects)
npm run test:dungeon    # floor generation, room locking, abandon rule, boss hall
npm run test:resume     # Save & Quit restores the same floor, rooms and position
npm run test:softlock   # stragglers elsewhere never stall a room
npm run test:content    # new enemies, ascension, challenges, ships
npm run test:pc         # mouse & keyboard (click = dash, no joystick, aim modes, hover, touch switch) + guide arrow stability
npm run test:training   # barrier, counted hits, respawns, immortal bosses, save untouched
npm run test:checkpoint # unlocks, starting kit, resume mid-kit, shard rules, old-save migration
npm run test:bosses     # Counterweight (side view, no dash dodge, survive to win), Orrery, Forgemaster
npm run perf            # frame cost with 4x CPU throttling
```

Debug mode: append `?debug` to the URL and `window.OMF` exposes the game state.
