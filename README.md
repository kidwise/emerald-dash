# Emerald Dash — South Lake Union slice

A browser driving game set in a rainy blue-hour Seattle. You drive a delivery van up Westlake Ave from
Whole Foods at Denny Way to Lake Union Park, flinging parcels onto doorsteps without stopping.

This is the first playable slice: South Lake Union only (9th, Westlake and Terry avenues, Denny Way to Valley St,
plus the park, MOHAI and the lake, with the Space Needle on the western skyline).

## Run

```
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
```

Needs a WebGL2 browser with a real GPU. Resolution drops automatically if the frame rate falls below ~45 fps.

## Controls

| Key | Action |
|---|---|
| W A S D / arrows | Drive |
| Space | Throw a parcel (to whichever side the nearest doorstep is on) |
| Shift | Handbrake drift |
| R | Reset onto the nearest avenue |
| M | Mute |
| Enter | Start / restart a shift |

The white marker on the ground shows where a parcel thrown *now* would land; it carries the van's speed,
so release as the marker crosses the glowing ring. Faster throws, dead-centre drops and unbroken streaks score more.

Passing moving traffic fast and close without touching it scores a near miss. Bumping a car or wall breaks your
streak, and driving at pedestrians costs 50 points (they always jump clear).

## How it is built

Everything is generated in code: there are no model, texture or audio files.

- `src/config.js` — the street grid (shared by JavaScript and the shaders).
- `src/world/ground.js` — wet asphalt, lane paint, streetcar rails, puddles with rain ripples, analytic street-lamp light.
- `src/gfx/planar.js` — mirror pass that gives the wet streets true reflections.
- `src/world/facade.js` — building surfaces; windows use interior mapping so lit rooms have real parallax depth.
- `src/world/buildings.js` — the block-by-block building layout.
- `src/world/props.js` — lamps, light-wrapped trees, traffic signals, parked cars, neon signs, barriers.
- `src/world/landmarks.js` — the lake, park, museum, boats, far shore, Space Needle and streetcar.
- `src/world/rain.js` — rain streaks and steam.
- `src/world/traffic.js` — ambient cars that follow lanes, obey the signals, queue, and brake for the van and streetcar.
- `src/world/pedestrians.js` — people with umbrellas on the sidewalks; they jump clear of the van and are never hit.
- `src/game/van.js` — the van model and arcade driving physics.
- `src/game/game.js` — deliveries, scoring, camera, particles; `hud.js` and `audio.js` alongside.
- `src/gfx/post.js` — ambient occlusion, bloom, filmic tone mapping, grain, anti-aliasing.

## Checking visuals

`tools/shot.mjs` takes headless Chrome screenshots (dev server must be running):

```
node tools/shot.mjs name "cam=x,y,z,tx,ty,tz"     # fixed debug camera
node tools/shot.mjs drive "autostart=1&auto=1,0,0&wait=4000"
node tools/play.mjs                                # drives the game with real key presses
node tools/soak.mjs "" 60                           # 60 s of random driving and crashes; reports if the picture breaks
node tools/life.mjs                                # pedestrian and traffic close-ups plus traffic-flow statistics
node tools/scare.mjs                               # charges a pedestrian to check they dodge
```

## Naming

Street and place names are real; building signage, the van livery and the courier brand are invented.
Swap any real business names for stand-ins before publishing this anywhere public.
