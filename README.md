# Emerald Dash

A browser driving game set in a rainy blue-hour Seattle. You drive a delivery van through a true-scale city built
from real map data, from Lake Union to Pike Place Market and the Space Needle, flinging parcels onto doorsteps
without stopping.

## The city

Streets, building footprints, hills and shorelines are baked from OpenStreetMap and public elevation data, covering
South Lake Union, Belltown, the downtown retail core, Pike Place and Seattle Center (about 2 km by 2.6 km).
Hand-built landmarks stand at their real positions: Pike Place Market (arcade, stalls and shopfronts), the Public
Market sign, the Space Needle and Chihuly Garden and Glass, the Amazon Spheres, the monorail, the streetcar, the
Westlake Park holiday tree, MOHAI and the Great Wheel. Another two dozen places (museums, theatres, stores, parks)
are marked on the map to discover by driving past. Traffic obeys the signals, pedestrians walk the kerbs, cars are parked along the wider
streets and neon signs hang from the shopfronts.

Jobs are dispatched near wherever you drive; choose Explore for no clock. Stop beside a landmark for a close look.
Pike Place Market is walking pace, and its shops hand over cargo with their own rules: catch the thrown fish,
flowers that must not tip, heavy cheese, yogurt on a clock.

## Run

```
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
```

Needs a WebGL2 browser with a real GPU. Resolution drops automatically if the frame rate falls below ~45 fps.
If it is still slow at the lowest resolution, distant parked cars, trees and lamps are dropped and then pedestrians.

## Controls

| Key | Gamepad | Action |
|---|---|---|
| W A S D / arrows | left stick, triggers | Drive |
| Space | A | Throw (to whichever side the nearest job is on), or catch |
| Shift | B / RB | Handbrake drift |
| Tab | | Route to the next job |
| Enter / E | Start | Start a shift / explore |
| R | | Reset onto the nearest road |
| T | | Toggle rain / clear evening |
| Esc | | End the session |
| M, or the speaker button | | Sound on / off (remembered) |

On a touch screen, on-screen buttons appear for steering, GO, BRAKE, DRIFT and THROW (add `?touch=1` to try them
with a mouse).

The white marker on the ground shows where a parcel thrown *now* would land; it carries the van's speed,
so release as the marker crosses the glowing ring. Faster throws, dead-centre drops and unbroken streaks score more.

## Jobs

| Colour | Job |
|---|---|
| Cyan | Parcel to a doorstep |
| Pink | Rush order: triple pay, but it expires |
| Amber, then green | Pick-up run from Whole Foods or a Pike Place shop, each with its own rule |
| Purple | Land a parcel on the moving streetcar's roof (offered when you are near it) |
| Blue | Throw onto a floating dock on Lake Union (offered when you are near the lake) |

Two set pieces: drive into a gold ring at either end of the monorail to race the train to the other end, and stop
at the Space Needle to ride to the top for a view over the city.

The clock runs down and every delivery adds time, more for longer drives. Other scoring: near misses with moving
traffic, air time over hill crests, landmarks found, coffee-cup turbos. Bumping things breaks your streak; driving
at pedestrians costs 50 points (they always jump clear).

## How it is built

City blocks are generated in code from the map data. Landmarks also use asset files in `public/assets/`: CC0
photographic textures, hand-designed SVG signage, and the baked map and height grid (credits in
`public/assets/CREDITS.md`).

- `src/config.js` — shared constants, and the questions every system asks the map (height, bounds, routes).
- `src/real/world.js` — builds the city from the baked map: road ribbons at any angle, terrain, footprints,
  shorelines, lamps and trees, signals, traffic, routing, and the placement of every landmark.
- `src/world/ground.js` — the wet ground shader: asphalt, lane paint, paving, puddles with rain ripples.
- `src/gfx/planar.js` — mirror pass for the wet streets; the mirror tilts to lie along the street the van is on.
- `src/world/facade.js` — building surfaces; windows use interior mapping so lit rooms have real parallax depth.
- `src/world/market.js` — Pike Place Market, modelled by hand: arcade, stalls, shopfronts, people.
- `src/world/icons.js` — MoPOP, the Central Library, the arena roof, the Science Center arches, the Eagle,
  Hammering Man and the Gum Wall.
- `src/world/scenes.js` — street-level life at the Needle plaza, the MOHAI waterfront and Westlake Park.
- `src/world/districts.js` — monorail, market sign and Great Wheel, holiday tree, Space Needle, glass garden, fountain.
- `src/world/props.js`, `cars.js`, `pedestrians.js`, `landmarks.js`, `rain.js`, `sky.js` — lamps and trees, car
  models, pedestrians, water and the streetcar model, rain, sky.
- `src/game/van.js` — the van model and arcade driving physics, including hills and air time.
- `src/game/game.js` — jobs, scoring, camera, particles; `hud.js` and `audio.js` alongside.
- `src/gfx/post.js` — ambient occlusion, bloom, filmic tone mapping, grain, anti-aliasing.

## Tools

All test tools drive headless Chrome against the dev server:

```
node tools/shot.mjs name "cam=x,y,z,tx,ty,tz"     # fixed debug camera screenshot
node tools/realmap.mjs                             # drive, walls, traffic, a delivery, streetcar and dock jobs
node tools/realheroes.mjs                          # photograph each landmark in place
node tools/realhill.mjs                            # drive down the steepest street
node tools/market.mjs                              # Pike Place: slow zone, postcards, shop cargo
node tools/setpieces.mjs                           # the monorail race and the Space Needle ride
node tools/weather.mjs                             # the clear-evening toggle
node tools/soak.mjs "" 60                          # 60 s of random driving and crashes
node tools/fetch-assets.mjs                        # re-download the CC0 textures
node tools/bake-map.mjs city                       # rebuild the map from raw OpenStreetMap data
node tools/bake-dem.mjs city                       # rebuild its ground heights from public elevation tiles
```

## Names

Street, place and building names come from the map data. Shop signage is our own artwork using real shop names as
place labels, with no company logos; the van livery and courier brand are invented. Replace real business names
with stand-ins before publishing the game publicly, and keep the OpenStreetMap credit visible.
