# Emerald Dash

A browser driving game set in a rainy blue-hour Seattle. You drive a delivery van, flinging parcels onto
doorsteps without stopping, across three connected districts:

- **South Lake Union** — Westlake Ave from Whole Foods at Denny Way to Lake Union Park, MOHAI and the lake, with the streetcar.
- **Downtown & Pike Place** — the retail core (Westlake Center, Westlake Park, Pacific Place), the monorail over 5th Ave,
  and four stepped blocks downhill to Pike Place Market and the bay.
- **Seattle Center** — west along Denny Way under the monorail to the Space Needle, the glass garden and the International Fountain.

The map is one continuous world; a shift just picks which district its jobs are in.

## Two maps

- **The hand-built city** (default): a compressed, regular street grid with every game feature: hills, streetcar,
  monorail, all landmarks.
- **The real map** (`?map=real`, linked from the title screen): true-scale streets, building footprints and shoreline
  baked from OpenStreetMap, from Lake Union to Pike Place and Seattle Center. Pike Place Market and the Space Needle
  are placed at their real addresses, with traffic and pedestrians. Still a preview: the ground is flat, and the
  streetcar, signals and most other landmarks are not there yet.

Play is one continuous city in both: jobs are dispatched near wherever you drive, or choose Explore for no clock.
Stop beside a landmark for a close look; Pike Place Market is walking pace, and its shops hand over cargo with
their own rules (catch the thrown fish, flowers that must not tip, heavy cheese, yogurt on a clock).

## Run

```
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
```

Needs a WebGL2 browser with a real GPU. Resolution drops automatically if the frame rate falls below ~45 fps.

## Controls

| Key | Gamepad | Action |
|---|---|---|
| W A S D / arrows | left stick, triggers | Drive |
| Space | A | Throw (to whichever side the nearest job is on) |
| Shift | B / RB | Handbrake drift |
| 1 2 3 | | Pick a district on the title screen |
| Enter | Start | Start / restart a shift |
| R | | Reset onto the nearest road |
| T | | Toggle rain / clear evening |
| M | | Mute |

The white marker on the ground shows where a parcel thrown *now* would land; it carries the van's speed,
so release as the marker crosses the glowing ring. Faster throws, dead-centre drops and unbroken streaks score more.

## Jobs

| Colour | Job |
|---|---|
| Cyan | Parcel to a doorstep |
| Pink | Rush order: triple pay, but it expires |
| Amber, then green | Pick-up run (groceries in SLU, fish from Pike Place): drive gently and hand over below 20 mph |
| Purple | Land a parcel on the moving streetcar's roof (SLU) |
| Blue | Throw onto a dock at the lake (SLU) |

Other scoring: near misses with moving traffic, air time off the downtown hill, discovering landmarks, coffee-cup turbos.
Bumping things breaks your streak; driving at pedestrians costs 50 points (they always jump clear).

## How it is built

City blocks are generated in code. Hero landmarks also use asset files in `public/assets/`: CC0 photographic
textures, hand-designed SVG signage and the baked real map (credits in `public/assets/CREDITS.md`).

- `src/config.js` — the whole map: avenues and streets with their extents, the hill profile, drivable areas and the
  block generator. The same data is exported to the shaders. Extending or replacing the map starts here.
- `src/world/ground.js` — wet asphalt, lane paint, rails, brick paving, puddles with rain ripples, analytic street-lamp light.
- `src/gfx/planar.js` — mirror pass that gives the wet streets true reflections (it follows the level the van is on).
- `src/world/facade.js` — building surfaces; windows use interior mapping so lit rooms have real parallax depth.
- `src/world/buildings.js` — fills every block: hand-authored SLU, generated downtown (stepped on the hill) and backdrop.
- `src/world/props.js` — lamps, light-wrapped trees, signals, parked cars, neon signs, barriers; split into map tiles that are skipped when far away.
- `src/world/cars.js` — car models shared by parked cars and traffic.
- `src/world/landmarks.js` — Lake Union, the park, MOHAI, boats and the streetcar.
- `src/world/market.js` — Pike Place Market, modelled by hand: arcade, stalls, shopfronts, people.
- `src/real/world.js` — builds a district from real map data: roads at any angle, footprints, shoreline, routing.
- `src/world/districts.js` — monorail, Pike Place sign and bay with the Great Wheel, Westlake Park tree, Space Needle, glass garden, fountain.
- `src/world/traffic.js`, `pedestrians.js` — street life.
- `src/world/rain.js` — rain streaks and steam.
- `src/game/van.js` — the van model and arcade driving physics, including hills and air time.
- `src/game/game.js` — jobs, scoring, districts, camera, particles; `hud.js` and `audio.js` alongside.
- `src/gfx/post.js` — ambient occlusion, bloom, filmic tone mapping, grain, anti-aliasing.

## Checking it

All tools drive headless Chrome against the dev server:

```
node tools/shot.mjs name "cam=x,y,z,tx,ty,tz"     # fixed debug camera screenshot
node tools/play.mjs                                # drives with real key presses and makes a delivery
node tools/missions.mjs                            # every special job type
node tools/hill.mjs                                # district starts and a fast run down Pike St
node tools/life.mjs                                # pedestrian and traffic close-ups, traffic-flow statistics
node tools/scare.mjs                               # charges a pedestrian to check they dodge
node tools/weather.mjs                             # the clear-evening toggle
node tools/soak.mjs "" 60 downtown                 # 60 s of random driving and crashes in a district
node tools/market.mjs                              # Pike Place: slow zone, postcards, shop cargo
node tools/realmap.mjs                             # real map: drive, walls, traffic, a delivery
node tools/realheroes.mjs                          # real map: photograph each landmark in place
node tools/fetch-assets.mjs                        # re-download the CC0 textures
node tools/bake-map.mjs city                       # rebuild the real map from raw OpenStreetMap data
```

## Not a survey map

Street and place names are real, but the layout is a regular grid for play: real downtown streets are rotated against
South Lake Union's, Westlake Ave runs diagonally, and distances here are compressed. Building signage, the van livery and
the courier brand are invented. Swap any real business names for stand-ins before publishing this anywhere public.
