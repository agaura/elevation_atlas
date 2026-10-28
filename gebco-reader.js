import {fromCustomClient} from './vendor/geotiff/geotiff.js';
import {GEBCO_URL, latitudeAt} from './gebco.js';
import {wrap} from './terrain.js';
import {createRangeClient} from './gebco-range.js';
let dataset;
const readers = new Set();
const client = createRangeClient(GEBCO_URL, () => {for (const reader of readers) reader();});
async function open() {
  if (!dataset) dataset = fromCustomClient(client, {allowFullFile: false})
    .then(async tiff => ({tiff, count: await tiff.getImageCount()}))
    .catch(error => {dataset = null; throw error;});
  return dataset;
}
export async function gebcoTile(tile, size, signal, onProgress = () => {}) {
  const progress = () => {if (!signal.aborted) onProgress();};
  readers.add(progress);
  try {return await readTile(tile, size, signal, progress);}
  finally {readers.delete(progress);}
}
async function readTile(tile, size, signal, onProgress) {
  const {tiff, count} = await open();
  signal.throwIfAborted();
  onProgress();
  const values = new Float32Array(size * size);
  // Geographic rows vary greatly in scale across broad Mercator tiles. Read
  // narrow bands at their own LOD instead of a huge full-resolution window.
  const bands = [];
  for (let row = 0; row < size; row += 32) {
    const end = Math.min(size, row + 32), overview = bandOverview(tile, size, row, end);
    const previous = bands.at(-1);
    if (previous?.overview === overview) previous.end = end;
    else bands.push({row, end, overview});
  }
  let next = 0;
  await Promise.all(Array.from({length: Math.min(2, bands.length)}, async () => {
    while (next < bands.length) {
      const band = bands[next++];
      signal.throwIfAborted();
      await readBand(tiff, count, tile, size, band.row, band.end, band.overview, values, signal);
      onProgress();
    }
  }));
  return {size, values, factor: 1, offsetX: 0, offsetY: 0};
}
function bandOverview(tile, size, row, end) {
  const n = 2 ** tile.z;
  const north = latitudeAt((tile.y + row / size) / n), south = latitudeAt((tile.y + end / size) / n);
  const ratio = 360 / (n * size) * Math.cos(Math.max(Math.abs(north), Math.abs(south)) * Math.PI / 180) * 240;
  return Math.max(0, Math.floor(Math.log2(ratio)));
}
async function readBand(tiff, count, tile, size, row, end, overview, values, signal) {
  const n = 2 ** tile.z;
  const north = latitudeAt((tile.y + row / size) / n);
  const south = latitudeAt((tile.y + end / size) / n);
  const sampling = {north, south, overview};
  const image = await tiff.getImage(Math.min(count - 1, sampling.overview));
  const width = image.getWidth(), height = image.getHeight();
  const x = wrap(tile.x, n);
  // Read a one-cell halo, wrapping horizontally across the date line.
  const left = x / n * width, right = (x + 1) / n * width;
  const top = (90 - sampling.north) / 180 * height;
  const bottom = (90 - sampling.south) / 180 * height;
  const x0 = Math.floor(left - .5), x1 = Math.floor(right - .5) + 2;
  const y0 = Math.max(0, Math.floor(top - .5)), y1 = Math.min(height, Math.floor(bottom - .5) + 2);
  const segments = [];
  for (let start = x0; start < x1;) {
    const sourceX = wrap(start, width), length = Math.min(x1 - start, width - sourceX);
    const values = await image.readRasters({window: [sourceX, y0, sourceX + length, y1], samples: [0], interleave: true, signal});
    segments.push({start, length, values}); start += length;
  }
  signal.throwIfAborted();
  const nodata = image.getGDALNoData();
  const read = (px, py) => {
    py = Math.max(y0, Math.min(y1 - 1, py));
    let part = segments[0];
    for (let i = 1; i < segments.length && px >= part.start + part.length; i++) part = segments[i];
    const value = part.values[(py - y0) * part.length + px - part.start];
    return value === nodata ? NaN : value;
  };
  for (let y = row; y < end; y++) {
    const py = (90 - latitudeAt((tile.y + (y + .5) / size) / n)) / 180 * height - .5;
    const iy = Math.floor(py), fy = py - iy;
    for (let x = 0; x < size; x++) {
      const px = left + (x + .5) / size * (right - left) - .5;
      const ix = Math.floor(px), fx = px - ix;
      const a = read(ix, iy), b = read(ix + 1, iy), c = read(ix, iy + 1), d = read(ix + 1, iy + 1);
      values[y * size + x] = Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d)
        ? (a * (1-fx) + b * fx) * (1-fy) + (c * (1-fx) + d * fx) * fy : NaN;
    }
  }
}
