# Elevation Atlas

A WebGPU elevation explorer with flat and globe views, wide-gamut HDR color maps, terrain edge highlighting, and optional roads, borders, and labels. Inspired by [Heightmapper](https://tangrams.github.io/heightmapper/).

## Run locally

Open `index.html` with a local web server, or run:

```sh
npm start
```

Visit http://localhost:8080. No build step or API keys are required. WebGPU needs a supported browser/GPU and localhost or HTTPS; a phone accessing a local server over plain HTTP will not have WebGPU access.

## Controls

Sphere is the default view. The top-bar selector switches between **Earth, Mars, and the Moon**, remembering each view during the session. Planetary views support the same HDR palettes, highlighting, coordinates, scale bar and exports; water, streets and address search are Earth-only. Search on Mars and the Moon accepts coordinates or geographic feature names, such as Olympus Mons or Tycho. Map Labels also works on Mars and the Moon, showing official IAU/USGS names. Share a planetary view using its URL (`?body=mars` or `?body=moon`).

- **Navigate:** drag to pan/rotate, scroll or pinch to zoom, and double-click/tap to zoom in. Arrow keys or WASD move continuously; +/− zoom. Search accepts coordinates or place/address names.
- **Color:** choose Grayscale, Thermal (default), Earth, Arctic Ocean, Hawaii, Phantom, or Styx. The arrow button reverses the palette.
- **Range:** Auto Color Range follows the visible elevations. Turn it off to edit the limits. Locks stop automatic adjustment while allowing manual edits; Auto Slider Range controls the sliders’ available bounds.
- **Highlight:** hover over the color strip to preview an elevation, or click/drag to select it. Adjust Elevation and Half-Width; their locks keep values fixed in meters instead of following the color range.
- **Pulse:** enabled initially with Highlight and remembered when Highlight is toggled; sweeps the color range every 5 seconds without a delay. Turn Pulse off to reveal and lock the Elevation control.
- **Rendering:** Underwater, Edge Highlighting, and Map Labels toggle their respective layers. Map labels include rivers, peaks, lakes and parks where supplied, with smaller features appearing as you zoom in. Rendering Details shows resolution, tile coverage, and GEBCO refinement status.
- **Locations:** desktop hover shows coordinates and elevation. Right-click on desktop or press and hold on mobile to pin a location.
- **Fullscreen and download:** use the canvas/header buttons. Downloads save the rendered terrain and map layers as HDR AVIF at full device-pixel resolution, excluding UI overlays. HDR viewing requires a compatible viewer and display.

Keyboard shortcuts: **E** toggles edge highlighting, **H** toggles highlighting, **U** toggles water, **F** toggles fullscreen, **M** toggles map labels, **Shift + M** locks the full elevation range for the selected body (press again to restore Auto Color Range), and **O** toggles Flat/Sphere. **G** opens Google Maps; **0** / **Shift + 0** set and lock the minimum/maximum to sea level; press again to restore the previous value and lock state. **R** restores sidebar defaults while preserving map mode and fullscreen. With highlighting enabled, **, / .** lower/raise its elevation; hold **Shift** to adjust half-width instead. Hold a punctuation key for smooth, continuous adjustment. Shortcuts remain available on buttons and toggles, but pause while typing in any text or number field.

Hold **Command** (Mac) or **Control** while hovering over Earth to isolate the country, state/province, or county/district under the cursor, following the map boundary zoom levels. This works with Map Labels off. Release the key or leave the canvas to restore the full view. Command/Ctrl-click pins the mask; hold Command/Ctrl to preview another region and release to return to the pinned region. Use Clear in its bottom-right readout to remove it. Mask changes fade, and automatic elevation limits use only visible terrain inside the selected region. Boundaries load on demand; unavailable detailed coverage falls back to a coarser region.

Hold **Shift** to preview highlight at the hovered elevation; release to restore the previous highlight. **Shift-click** keeps the selected elevation. Active highlight elevation and half-width appear below the canvas location readings.

## Data and credits

- [geoBoundaries](https://www.geoboundaries.org/) (CC BY 4.0) and [Natural Earth](https://www.naturalearthdata.com/): administrative hover masks.
- [IAU / USGS Gazetteer](https://planetarynames.wr.usgs.gov/GIS_Downloads): approved Mars/Moon feature names, bundled as compact catalogs and loaded on demand. Refresh with `python3 tools/update-planetary-names.py`.
- [NASA Trek](https://trek.nasa.gov/): global Mars/Moon terrain meshes; [USGS Astrogeology](https://stac.astrogeology.usgs.gov/): local Mars CTX and lunar Kaguya elevation refinement.
- [Mapterhorn](https://mapterhorn.com/data-access/): land elevations; see [source attribution](https://mapterhorn.com/attribution).
- [Open Waters Seascape](https://github.com/openwatersio/seascape/blob/main/docs/schema.md): bathymetry and water classification; see [license](https://openwaters.io/charts/seascape#license).
- [GEBCO_2025](https://source.coop/ausantarctic/gebco): broad-scale ocean refinement, streamed from the Australian Antarctic Division’s public dataset; see [GEBCO terms](https://www.gebco.net/data-products/gridded-bathymetry-data).
- [OpenFreeMap](https://openfreemap.org/) / [OpenStreetMap contributors](https://www.openstreetmap.org/copyright): roads, boundaries, and labels.
- [Photon](https://photon.komoot.io/): address/place search, queried only on submission. Coordinate searches stay local.

Seascape loads first; broad ocean views refine to GEBCO in the background. Finer views retain Seascape when they exceed GEBCO’s native resolution. Refinement continues silently with Underwater off. Unknown-depth water falls back to Mapterhorn where available.

Inland-water elevations use an experimental Mapterhorn surface estimate plus Seascape’s negative depth, using nearby water samples to reduce shoreline outliers. Unknown depths retain Mapterhorn elevations. GEBCO refines the ocean while inland water retains the same estimate. This assumes positive Mapterhorn water elevations represent the surface, and can be inaccurate where they represent the lake bed.

Rendering uses the full device pixel ratio and floating-point elevation textures. Detail is limited by the underlying surveys, and the polar caps beyond approximately ±85.05° are not covered. Sources have different vertical datums and may show seams. This is a visualization, not a navigation chart or seamless geodetic dataset.

Visible planetary terrain requests two extra mesh levels (four times finer nominal spacing), while retaining a coarse world preview and bounded requests. High-latitude cells refine further according to their projected Mercator height, with a per-output-tile budget; the flat projection still stretches polar terrain. Planetary global terrain is a simplified mesh, so edge highlighting can reveal triangles. At close zooms, available USGS raster patches refine it in the background; these surveys have partial coverage and varying quality. Mars uses MOLA/areoid-adjusted heights; lunar heights use a 1,737.4 km reference sphere. The current Mercator renderer also leaves planetary polar caps uncovered.

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
