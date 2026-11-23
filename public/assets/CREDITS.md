# Asset credits

## Textures (`tex/`)

Photographic textures from [Poly Haven](https://polyhaven.com), released under CC0 (public domain):
`red_brick_03`, `brick_pavement_02`, `weathered_brown_planks`, `green_rough_planks`, `painted_brick`, `old_wood_floor`.
Re-download with `node tools/fetch-assets.mjs`. The committed copies are recompressed to shrink the download.

## Signs (`signs/`, `signs-standin/`)

Original SVG artwork made for this project. Shop names on them are real Pike Place Market businesses, used as
place labels only; the lettering and layouts are our own and no company logos are reproduced. `signs-standin/` holds the same
artwork with invented shop names, used only when the stand-in switch in `src/names.js` is on.

## Map (`map/`)

`city.json` and `slu.json` are baked from OpenStreetMap by `tools/bake-map.mjs`.
Map data © OpenStreetMap contributors, available under the Open Database License (ODbL):
https://www.openstreetmap.org/copyright. Keep this credit visible wherever the real-map mode is shown.

`city-height.json` is baked by `tools/bake-dem.mjs` from the Mapzen/AWS Terrain Tiles open dataset
(https://registry.opendata.aws/terrain-tiles/), which in this area derives from USGS 3DEP elevation data.
