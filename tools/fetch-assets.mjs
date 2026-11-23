// Downloads the photographic textures used by the hero landmarks from Poly Haven (CC0, https://polyhaven.com).
// The files are committed, so this only needs re-running to add or refresh textures.
// The committed copies were then recompressed to shrink the download:
//   for f in public/assets/tex/*.jpg; do sips -s format jpeg -s formatOptions 68 "$f" --out "$f"; done
import { writeFile, mkdir } from 'node:fs/promises';
const OUT = 'public/assets/tex';
const WANT = {
  red_brick_03: ['Diffuse', 'nor_gl'],
  brick_pavement_02: ['Diffuse', 'nor_gl'],
  weathered_brown_planks: ['Diffuse', 'nor_gl'],
  green_rough_planks: ['Diffuse', 'nor_gl'],
  painted_brick: ['Diffuse', 'nor_gl'],
  old_wood_floor: ['Diffuse', 'nor_gl'],
};
const SHORT = { Diffuse: 'diff', nor_gl: 'nor', Rough: 'rough' };
await mkdir(OUT, { recursive: true });
for (const [slug, maps] of Object.entries(WANT)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${slug}`, { headers: { 'User-Agent': 'asset-fetch' } })).json();
  for (const m of maps) {
    const url = files[m]?.['1k']?.jpg?.url;
    if (!url) { console.log('missing', slug, m); continue; }
    const buf = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': 'asset-fetch' } })).arrayBuffer());
    await writeFile(`${OUT}/${slug}_${SHORT[m]}.jpg`, buf);
    console.log(`${slug}_${SHORT[m]}.jpg`, Math.round(buf.length / 1024) + ' kB');
  }
}
