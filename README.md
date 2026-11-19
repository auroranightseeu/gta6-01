[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/auroranightseeu/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/auroranightseeu/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# gta6-01

**Solmar** is an original open-world crime game that plays offline in a desktop browser
from its own files. No Rockstar assets, names, or code: the city is **Solmar**, a
sun-soaked coastal city; the player is **Rio Vega**, back to collect what the city
owes him; his fixer is **Ana Deluca**.

Entered in the make.fun "Make GTA 6" bounty: https://make.fun/bounty/gta6-01

## Run it

```sh
node serve.ts
# then open http://localhost:8080 — no build step, no network requests.
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>

## The game

- **City**: a procedural 5×5-block grid city (three.js, vendored under `game/vendor/`),
  roads, sidewalks, varied buildings with lit-window facades, lamps, palms, sun, sky
  and fog. One seed always builds the same city.
- **On foot**: third-person character, walk/run (Shift), mouse-orbit camera (pointer
  lock), WASD movement.
- **Driving**: arcade car physics — acceleration, braking, steering, light drift,
  handbrake (Space) — with a chase camera and building collision. Press **E** near a
  parked car to take it; **E** again to get out.
- **Life**: NPC traffic cars drive the road network (and queue behind each other, so
  they never overlap at intersections) and pedestrians walk the sidewalks, stepping
  aside when Rio gets close. A traffic car that clips Rio hurts him; at zero health
  he is wasted and respawns at the safehouse, $50 lighter.
- **Wanted + police**: crimes raise wanted stars 1–5 (steal a car +1, hit a pedestrian
  +2, clip a traffic car +1, fire the pistol +1). Black-and-white police cars with
  flashing light bars spawn at the city edge and chase Rio on foot and by car; stay
  out of sight and the stars cool off one by one. Caught on foot, Rio is busted and
  wakes up at the safehouse.
- **Missions (v2)**: a five-job chain from fixer Ana Deluca — meet Ana ($100), pick up
  and deliver a package against the clock ($150), lose a 2-star wanted level ($200),
  a getaway drive under pursuit ($250), and a final run to the docks ending in a
  shootout ($500). Each job has a marker on the map and minimap, dialogue, and a
  banner on completion; progress saves.
- **Combat**: punch (F) to shove someone off, pistol (click / G) with hitscan tracer,
  muzzle flash, a 12-round magazine (R reloads) and green ammo crates around town.
- **Sound**: synthesised WebAudio only — engine hum that follows speed, a siren while
  wanted, gunshot, pickup chime, mission jingle, UI clicks. M mutes.
- **Save**: money, missions, position and ammo persist in localStorage; Continue
  resumes where Rio left off.

## Controls

WASD move/drive · Shift run · Mouse look (click to lock) · E enter/exit car ·
Space handbrake · Click / G fire pistol · F punch · R reload · M mute ·
P / Esc pause · Enter start.

## Files

- `game/index.html` — page, HUD, title/pause/game-over screens, three.js importmap.
- `game/src/main.js` — boot, fixed-step loop, screens, enter/exit (incl. car theft),
  crimes, missions, respawn.
- `game/src/police.js` — wanted stars, police spawns, chase, cool-off, busted.
  `game/src/missions.js` — the five-job Ana Deluca chain: targets, dialogue, rewards.
  `game/src/combat.js` — punch, pistol, tracer, muzzle flash, ammo, rivals.
  `game/src/save.js` — localStorage save/load (v2, migrates v1 saves).
- `game/src/world.js` — seeded city generation + circle-vs-building collision.
- `game/src/render.js` — three.js scene: sky, ground texture, buildings, props, meshes.
- `game/src/player.js` — Rio on foot. `game/src/vehicles.js` — drivable car physics.
- `game/src/traffic.js` — NPC cars + pedestrians (queueing, step-aside, fleeing). `game/src/hud.js` — HUD + minimap.
- `game/src/input.js` — keyboard/mouse. `game/src/audio.js` — WebAudio synth SFX.
- `game/src/config.js` — tuning + palette. `game/src/random.js` — seeded RNG.
- `game/src/shots.js` — staged screenshot scenes (`?shot=start|drive|foot|chase&seed=N`).
- `game/vendor/three.module.min.js` — three.js v0.170.0, vendored, no network at runtime.
- `main.ts` — the entry program: copies `game/` + `screenshots/` and writes `dossier.json`.
- `serve.ts` — local static server: `node serve.ts`, then http://localhost:8080.

Screenshots live in `screenshots/` (1-start.jpg cover, 2-play.jpg driving,
3-foot.jpg on foot, 4-chase.jpg mission-complete summary). Built for the make.fun gta6-01 bounty.
