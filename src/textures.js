// 8-bit texture tiles (assets/) -> repeating canvas patterns.
//
// Node-safe: nothing touches the DOM at import time, so the headless test
// suites (which import world.js -> this module) still run. loadTextures(ctx)
// is called once from the browser entry (main.js). Until the tiles are in,
// the drawing code falls back to the old flat colors, so the game always runs.
//
// The 2048px generated tiles are downscaled step-by-step to TILE_PX so the
// repeat reads as chunky pixel-art rather than a high-res photo.

export const TILE_PX = 512; // on-screen size of one repeated tile

const state = { grass: null, road: null }; // CanvasPattern | null

function downscale(img, target) {
  let src = img;
  let size = Math.min(src.width, src.height);
  while (size > target) {
    const next = Math.max(target, Math.floor(size / 2));
    const c = document.createElement('canvas');
    c.width = next;
    c.height = next;
    const t = c.getContext('2d');
    t.imageSmoothingEnabled = true;
    t.imageSmoothingQuality = 'high';
    t.drawImage(src, 0, 0, next, next);
    src = c;
    size = next;
  }
  return src;
}

function load(src) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(null); // headless
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Call once with the game's 2d context. Resolves when both tiles are loaded
// (or failed). Safe to call more than once; it just re-loads and re-builds.
export async function loadTextures(ctx) {
  const [grass, road] = await Promise.all([
    load('assets/grass_tile.png'),
    load('assets/road_tile.png'),
  ]);
  if (grass) state.grass = ctx.createPattern(downscale(grass, TILE_PX), 'repeat');
  if (road) state.road = ctx.createPattern(downscale(road, TILE_PX), 'repeat');
  return { grass: !!state.grass, road: !!state.road };
}

// Paint values for drawScene: the pattern, or the flat fallback color until
// the tile is loaded (and if the file is missing, the fallback stays).
export function grassStyle(fallback) { return state.grass || fallback; }
export function roadStyle(fallback) { return state.road || fallback; }
