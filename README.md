# Solmar — Rio Vega (make.fun gta6-01)

An original open-world crime game that plays offline in a desktop browser from its own
files. No Rockstar assets, names, or code: the city is **Solmar**, a sun-soaked coastal
city; the player is **Rio Vega**, back to collect what the city owes him; his fixer is
**Ana Deluca**.

## The game

- **City**: a procedural 5×5-block grid city (three.js, vendored under `game/vendor/`),
  roads, sidewalks, varied buildings with lit-window facades, lamps, palms, sun, sky
  and fog. One seed always builds the same city.
- **On foot**: third-person character, walk/run (Shift), mouse-orbit camera (pointer
  lock), WASD movement.
- **Driving**: arcade car physics — acceleration, braking, steering, light drift,
  handbrake (Space) — with a chase camera and building collision. Press **E** near a
  parked car to take it; **E** again to get out.
- **Life**: NPC traffic cars drive the road network and pedestrians walk the sidewalks.
  A traffic car that clips Rio hurts him; at zero health he is wasted and respawns.
- **Objective (v1)**: reach Ana Deluca's amber marker to earn $100, then free roam.
  Wanted stars, missions, police, combat and saves beyond position/money come in later
  slices — the HUD already carries the wanted-star slot, minimap, money, health, speed
  and objective line.

## Controls

WASD move/drive · Shift run · Mouse look (click to lock) · E enter/exit car ·
Space handbrake · P / Esc pause · Enter start.

## Files

- `game/index.html` — page, HUD, title/pause/game-over screens, three.js importmap.
- `game/src/main.js` — boot, fixed-step loop, screens, save/load, enter/exit, mission.
- `game/src/world.js` — seeded city generation + circle-vs-building collision.
- `game/src/render.js` — three.js scene: sky, ground texture, buildings, props, meshes.
- `game/src/player.js` — Rio on foot. `game/src/vehicles.js` — drivable car physics.
- `game/src/traffic.js` — NPC cars + pedestrians. `game/src/hud.js` — HUD + minimap.
- `game/src/input.js` — keyboard/mouse. `game/src/audio.js` — WebAudio stub (v2 sounds).
- `game/src/config.js` — tuning + palette. `game/src/random.js` — seeded RNG.
- `game/src/shots.js` — staged screenshot scenes (`?shot=start|drive|foot&seed=N`).
- `game/vendor/three.module.min.js` — three.js v0.170.0, vendored, no network at runtime.
- `main.ts` — the entry program: copies `game/` + `screenshots/` and writes `dossier.json`.
- `serve.ts` — local static server: `node serve.ts`, then http://localhost:8080.

## Play it

```
node serve.ts
# open http://localhost:8080 — no build step, no network requests.
```

Screenshots live in `screenshots/` (1-start.jpg cover, 2-play.jpg driving,
3-foot.jpg on foot). Built for the make.fun gta6-01 bounty.
