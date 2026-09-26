# One More Floor

**Just one more floor.** A fast roguelike / arcade dungeon crawler for your phone, built as a real PWA (installable, works offline). No backend, no build step, no external assets: HTML + CSS + Canvas 2D + Web Audio.

## How to play

- **Move:** drag anywhere on the screen (floating joystick). On desktop use WASD / arrow keys.
- **Shoot:** automatic, at the nearest visible enemy.
- **DASH:** the corner button, a tap with a second finger, or Space/Shift. You are invulnerable while dashing. Dashing through an attack counts as a **perfect dodge** (slow motion, synergy with Adrenaline).
- **Loop:** fight, reward (pick 1 of 3 upgrades), choose a door (Combat / Elite / Rest), next floor. **A boss every 5 floors.**
- When you die you earn **shards**, which you spend in the **Workshop** on permanent upgrades and unlocks.

### Builds

Every upgrade has a tag. Card rolls slightly favour tags you already collect, so a build forms naturally:

| Tag | Style | Examples |
|---|---|---|
| SPRAY | more bullets | Splitter, Ricochet, Rear Guard, Seeker Chip |
| PRECISION | crits / sniper | Focus Lens, Executioner, Heavy Slugs, Glass Cannon |
| ELEMENT | status effects | Arc Coil, Ember, Cryo Rounds, Volatile |
| DASH | mobility | Thruster, Twin Thrusters, Dash Nova, Adrenaline |
| ARMOR | survival | Aegis, Blade Halo, Spin Coil, Overdrive Motor, Mender, Leech |

**Blade Halo line:** Blade Halo (epic, +1 orbiting blade), Overdrive Motor (rare, +10% blade spin, the first pick also adds a blade) and Spin Coil (common, +5% blade spin, offered once you own a blade). Faster blades also hit each enemy more often. The Blade Halo blueprint in the Workshop unlocks both Blade Halo and Overdrive Motor.

### Bosses (each one has a mechanic to learn)

1. **Tower Warden** (floor 5): spiral bullet streams, jump slams (the red circle is locked at take-off, so walk out of it) and aimed fans.
2. **The Loom** (floor 10): rotating lasers (chevrons on the warning line show the rotation direction), laser grids and homing orbs you can shoot down.
3. **The Mirror** (floor 15): splits into copies. **Only the real one has a solid white core**, and a shattered copy fires a ring of bullets. It also dashes from wall to wall leaving bullet trails and summons enemies.

From floor 20 the bosses return as **II** variants (more HP, rage phase from the start). Below 50% HP every boss enters a **rage phase**.

### Permanent progression (Workshop)

Deliberately modest: +3 HP, +25% damage, rerolls and one extra life. On top of that, 5 blueprints unlock epic upgrades, which means new builds rather than raw power. Skill still decides.

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
js/bosses.js            3 bosses with attack patterns
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
npm run perf            # frame cost with 4x CPU throttling
```

Debug mode: append `?debug` to the URL and `window.OMF` exposes the game state.
