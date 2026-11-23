// Real business names, and an optional set of stand-ins.
//
// The game shows real names, in development and when published, alongside a "not affiliated" notice
// on the title screen. Stand-ins are kept as a switch: add `?names=standin` to the URL, or set
// ALWAYS_STANDIN below to publish with invented names and the signs in public/assets/signs-standin/.
const ALWAYS_STANDIN = false;
export const STANDIN = ALWAYS_STANDIN || new URLSearchParams(location.search).get('names') === 'standin';

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
