// GEBCO is a geographic grid: 240 samples per degree on each axis.
export const GEBCO_URL = 'https://data.source.coop/ausantarctic/gebco/GEBCO_2025.tif';
export const GEBCO_WIDTH = 86400;
export function latitudeAt(v) {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180 / Math.PI;
}
export function gebcoSampling(tile, size = 512) {
  const n = 2 ** tile.z;
  const north = latitudeAt(tile.y / n);
  const south = latitudeAt((tile.y + 1) / n);
  // Latitude spacing is finest at the poleward edge of a Mercator tile.
  const spacing = 360 / (n * size) * Math.cos(Math.max(Math.abs(north), Math.abs(south)) * Math.PI / 180);
  const ratio = spacing * 240;
  return {useGebco: ratio >= 1, overview: Math.max(0, Math.floor(Math.log2(ratio))), north, south};
}
