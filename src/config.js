// Shared constants, and the questions every system asks the map.
// Units are metres. +x = east, -z = north, +y = up. The origin is Westlake Ave & Denny Way.
//
// The city itself is built from real map data by src/real/world.js, which registers itself here with setMap().

export const CURB = 0.16;       // kerb height used by the hand-built set pieces
export const LAMP_H = 8.2;      // street lamp height
export const FOG_COLOR = [0.045, 0.07, 0.115];
export const FOG_DENSITY = 0.0036;

// The Pike Place set (world/market.js, world/districts.js) is modelled in its own local frame and then
// moved onto the real street. These are that frame's ground level and its strip along the west kerb.
export const MARKET_Y = -32;
export const MARKET = { x0: -520, x1: -448, z0: 352, z1: 800 };

// asset URLs are relative to wherever the game is hosted
export const asset = (path) => import.meta.env.BASE_URL + path;

let MAP = null;
export function setMap(map) { MAP = map; }

export const heightAt = (x, z) => (MAP ? MAP.heightAt(x, z) : 0);
export const groundHeight = heightAt;
export const inBounds = (x, z) => (MAP ? MAP.inBounds(x, z) : true);
export const district = (x, z) => (MAP ? MAP.district(x, z) : 'slu');
// shortest drive from a to b along the streets: a list of [x, z] corner points
export const routeBetween = (ax, az, bx, bz) => (MAP ? MAP.route(ax, az, bx, bz) : [[ax, az], [bx, bz]]);

export const DISTRICT_LABEL = { slu: 'South Lake Union', downtown: 'Downtown', center: 'Seattle Center', belltown: 'Belltown', pike: 'Pike Place Market', none: '' };
