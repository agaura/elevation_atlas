// Experimental inland-water surface estimate. Mapterhorn is not guaranteed to
// contain a water surface: this is a visualization heuristic, not a datum
// transformation. Never add a negative ocean/bed elevation to a depth.
export function waterSurfaceBaseline(samples) {
  const heights = samples
    .filter(({land, sea}) => Number.isFinite(land) && land > 0 && Number.isFinite(sea) && sea <= 0)
    .map(({land}) => land)
    .sort((a, b) => a - b);
  if (!heights.length) return 0;
  // A lower quartile resists high shoreline pixels without letting one low
  // outlier set the surface. Flat water stays exactly flat.
  return heights[Math.floor((heights.length - 1) * .25)];
}

export function mergeWaterSurface(land, sea, baseline) {
  if (Number.isFinite(sea) && sea < 0) return sea + baseline;
  return Number.isFinite(land) ? land : NaN;
}

// Decode each source once. The neighborhood filter runs only for above-zero
// water, not for the ocean, and reads an immutable input to avoid scan-order
// dependencies. Border samples are taken in source coordinates when available.
export function correctWaterSurfaceGrid(land, sea, size, borderSample) {
  const result = new Float32Array(land.length);
  const heights = new Float32Array(9);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, l = land[i], s = sea[i];
      if (!(s < 0) || !Number.isFinite(s) || !(l > 0) || !Number.isFinite(l)) {
        result[i] = mergeWaterSurface(l, s, 0);
        continue;
      }
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = x + dx, py = y + dy;
          let height, depth;
          if (px >= 0 && py >= 0 && px < size && py < size) {
            const j = py * size + px;
            height = land[j]; depth = sea[j];
          } else if (borderSample) {
            ({land: height, sea: depth} = borderSample(px, py));
          } else {
            const j = Math.max(0, Math.min(size - 1, py)) * size + Math.max(0, Math.min(size - 1, px));
            height = land[j]; depth = sea[j];
          }
          if (height > 0 && Number.isFinite(height) && depth <= 0 && Number.isFinite(depth)) heights[count++] = height;
        }
      }
      // Insertion sort is inexpensive for at most nine numbers and avoids
      // allocating an array or sample objects for each water texel.
      for (let j = 1; j < count; j++) {
        const value = heights[j]; let k = j - 1;
        while (k >= 0 && heights[k] > value) { heights[k + 1] = heights[k]; k--; }
        heights[k + 1] = value;
      }
      result[i] = s + (count ? heights[Math.floor((count - 1) * .25)] : 0);
    }
  }
  return result;
}
