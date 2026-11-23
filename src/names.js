// Real business names, and the stand-ins used when the game is published.
//
// In development the game shows real names (they come from the map data and from our own research).
// A production build (`npm run build`) shows stand-ins instead, and loads the stand-in shop signs from
// public/assets/signs-standin/. Add `?names=standin` to preview that in development.
export const STANDIN = import.meta.env.PROD || new URLSearchParams(location.search).get('names') === 'standin';

// applied in order to names, descriptions and sign lettering
const SWAPS = [
  ['Whole Foods Market', 'Denny Way Grocer'],
  ['Pike Place Fish Market', 'Flying Salmon Fish Co.'], ['Pike Place Fish', 'Flying Salmon Fish Co.'],
  ['Beecher’s Handmade Cheese', 'Curd & Kettle Cheese'],
  ['Ellenos Real Greek Yogurt', 'Blue Door Greek Yogurt'],
  ['The First Starbucks', 'The First Coffee Shop'],
  ['Le Panier', 'La Corbeille'],
  ['NORDSTROM', 'FLAGSHIP'], ['Nordstrom', 'Fifth Avenue Flagship'],
  ['WESTLAKE CENTER', 'WESTLAKE ARCADE'], ['Westlake Center', 'Westlake Arcade'],
  ['PACIFIC PLACE', 'PINE ST GALLERIA'], ['Pacific Place', 'Pine Street Galleria'],
  ['Chihuly Garden and Glass', 'Glass Garden'],
  ['Kenmore Air', 'Lake Union Seaplanes'],
  ['at Amazon’s headquarters', 'on a tech campus'], ['The first of the downtown Amazon towers', 'One of the downtown tech towers'],
  [/^Amazon(\.com)? /, ''], [/^Meta /, ''], [/^Google$/, 'Search Campus'], [/^REI$/, 'Outdoor Co-op Flagship'], [/^Apple /, ''],
];

export function show(text) {
  if (!STANDIN || !text) return text;
  for (const [a, b] of SWAPS) text = typeof a === 'string' ? text.split(a).join(b) : text.replace(a, b);
  return text;
}
export const SIGN_DIR = STANDIN ? 'assets/signs-standin' : 'assets/signs';
