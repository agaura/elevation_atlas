# Elevation Atlas

A WebGPU elevation explorer with flat and globe views, wide-gamut HDR color maps, terrain edge highlighting, and optional roads, borders, and labels. Inspired by [Heightmapper](https://tangrams.github.io/heightmapper/).

## Run locally

Open `index.html` with a local web server, or run:

```sh
npm start
```

Visit http://localhost:8080. No build step or API keys are required. WebGPU needs a supported browser/GPU and localhost or HTTPS; a phone accessing a local server over plain HTTP will not have WebGPU access.

## Controls

- **Navigate:** drag to pan/rotate, scroll or pinch to zoom, and double-click/tap to zoom in. Arrow keys or WASD move continuously; +/− zoom. Search accepts coordinates or place/address names.
- **Color:** choose Grayscale, Thermal (default), Earth, Arctic Ocean, Hawaii, or Spirit. The arrow button reverses the palette.
- **Range:** Auto Color Range follows the visible elevations. Turn it off to edit the limits. Locks stop automatic adjustment while allowing manual edits; Auto Slider Range controls the sliders’ available bounds.
- **Highlight:** hover over the color strip to preview an elevation, or click/drag to select it. Adjust Elevation and Half-Width; their locks keep values fixed in meters instead of following the color range.
- **Rendering:** Water, Edge Highlighting, and Map Labels toggle their respective layers. Rendering Details shows resolution, tile coverage, and GEBCO refinement status.
- **Locations:** desktop hover shows coordinates and elevation. Right-click on desktop or press and hold on mobile to pin a location.
- **Fullscreen and download:** use the canvas/header buttons. Downloads save the rendered terrain and map layers as HDR AVIF at full device-pixel resolution, excluding UI overlays. HDR viewing requires a compatible viewer and display.

## Data and credits

- [Mapterhorn](https://mapterhorn.com/data-access/): land elevations; see [source attribution](https://mapterhorn.com/attribution).
- [Open Waters Seascape](https://github.com/openwatersio/seascape/blob/main/docs/schema.md): bathymetry and water classification; see [license](https://openwaters.io/charts/seascape#license).
- [GEBCO_2025](https://source.coop/ausantarctic/gebco): broad-scale ocean refinement, streamed from the Australian Antarctic Division’s public dataset; see [GEBCO terms](https://www.gebco.net/data-products/gridded-bathymetry-data).
- [OpenFreeMap](https://openfreemap.org/) / [OpenStreetMap contributors](https://www.openstreetmap.org/copyright): roads, boundaries, and labels.
- [Photon](https://photon.komoot.io/): address/place search, queried only on submission. Coordinate searches stay local.

Seascape loads first; broad ocean views refine to GEBCO in the background. Finer views retain Seascape when they exceed GEBCO’s native resolution. Refinement continues silently with Water off. Unknown-depth water falls back to Mapterhorn where available.

Rendering uses the full device pixel ratio and floating-point elevation textures. Detail is limited by the underlying surveys, and the polar caps beyond approximately ±85.05° are not covered. Sources have different vertical datums and may show seams. This is a visualization, not a navigation chart or seamless geodetic dataset.

Requests use bounded concurrency, retries, and memory/disk caches. Only needed terrain is requested; the app does not prefetch the whole Earth. HDR output depends on browser, OS, and display support.

Bundled libraries include [GeoTIFF.js](https://github.com/geotiffjs/geotiff.js) and [@jsquash/avif](https://github.com/jamsinclair/jSquash). Library and font license notices are included in `vendor/` and `fonts/`.

## Tests

```sh
npm test
```

Optional Chrome/WebGPU integration tests use a separately installed Playwright:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/webgpu.mjs
```

Additional integration scripts in `tests/` cover terrain gradients, map rendering, caching, GEBCO, and HDR export.
