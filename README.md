# Elevation Atlas

A WebGPU terrain and imagery explorer for **Earth, Mars, and the Moon**, with flat/globe views and wide-gamut HDR color maps. Inspired by [Heightmapper](https://tangrams.github.io/heightmapper/).

## Run locally

Open `index.html` through a local web server, or run:

```sh
npm start
```

Visit http://localhost:8080. No build step or API keys are required. WebGPU requires a compatible browser/GPU and a secure context (HTTPS or localhost). There is no WebGL fallback. HDR and P3 display capability warnings appear in the sidebar when needed.

## Explore

- **Navigate:** drag to pan/rotate, scroll or pinch to zoom, or double-click/tap to zoom in. Search accepts coordinates, Earth addresses/places, and named Mars/Moon features. Right-click on desktop or long-press on mobile to pin coordinates and elevation.
- **Terrain:** choose Grayscale, Amber, Thermal (default), Arctic Ocean, Hawaii, Phantom, Styx, or Rainbow; reverse the palette with the arrow button. Auto Color Range follows visible elevations. Turn it off to edit limits; locks hold values while allowing manual edits. Auto Slider Range adjusts the sliders’ bounds. Underwater is Earth-only.
- **Highlight:** hover over the vertical color strip to preview, or click/drag to select. Pulse sweeps the range every five seconds; turn it off to edit Elevation. Elevation and Half-Width locks hold meters instead of a position or fraction of the color range. Hold Shift over terrain to preview its elevation; Shift-click keeps the selection.
- **Map View:** toggle labels, contours, the coordinate grid, and Sphere. Earth labels include roads, borders, and geographic features; Mars/Moon labels use official planetary names. Contours brighten terrain within the selected color range, with matching levels beside the color strip. The scale bar appears in Sphere view.
- **Imagery:** the satellite/mountain button switches between photographic imagery and elevation colors. Imagery dates vary; these are not live feeds. Missing imagery stays dark. The Terrain section hides in imagery mode, while map overlays remain available.
- **Region masks (Earth):** hold Command (Mac) or Control while hovering to isolate an administrative region, even with Map Labels off. Click while holding the modifier to pin it; Clear removes it. Auto Color Range follows the visible region.
- **Toolbar:** open the Earth view in Google Maps, enter fullscreen, or download the rendered image as full-resolution HDR AVIF. Downloads include rendered map layers but exclude UI readouts. HDR playback depends on the viewer and display.

Location links include the map center/zoom and selected body (`?body=mars` or `?body=moon`), **not sidebar settings**.

## Keyboard

Shortcuts pause while typing in text or number inputs.

| Keys | Action |
| --- | --- |
| WASD / arrows; + / − | Pan; zoom |
| E / H / U | Edge Highlighting / Highlight / Underwater |
| M / C / G | Map Labels / Contours / Coordinate Grid |
| O / T / F | Sphere / Satellite–Terrain / Fullscreen |
| , / . | Lower / raise highlight elevation; Shift adjusts half-width |
| 0 / Shift + 0 | Set and lock min / max to sea level; repeat to restore |
| Shift + M | Full elevation range / Auto Color Range |
| R | Reset sidebar settings, preserving map mode and fullscreen |

## Data and credits

- **Earth terrain:** [Mapterhorn](https://mapterhorn.com/attribution), [Open Waters Seascape](https://openwaters.io/charts/seascape#license), and [GEBCO_2025](https://source.coop/ausantarctic/gebco) ([terms](https://www.gebco.net/data-products/gridded-bathymetry-data)). Seascape loads first; broad ocean views refine to GEBCO in the background, silently with Underwater off.
- **Planetary terrain:** [NASA Trek](https://trek.nasa.gov/) global meshes, with local [USGS Astrogeology](https://stac.astrogeology.usgs.gov/) elevation refinement where available.
- **Imagery:** [Esri World Imagery](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) (Earth), [Caltech CTX V01](https://murray-lab.caltech.edu/CTX/V01/SceneView/intro_c.html) (Mars; NASA/JPL-Caltech/MSSS), and JAXA/SELENE Kaguya TC via [NASA Trek](https://trek.nasa.gov/moon/) (Moon). Provider credits appear on the canvas.
- **Map labels:** [OpenFreeMap](https://openfreemap.org/) / [OpenStreetMap contributors](https://www.openstreetmap.org/copyright); [IAU / USGS Gazetteer](https://planetarynames.wr.usgs.gov/GIS_Downloads) for Mars/Moon names.
- **Region masks:** [geoBoundaries](https://www.geoboundaries.org/) (CC BY 4.0) and [Natural Earth](https://www.naturalearthdata.com/).
- **Earth search:** [Photon](https://photon.komoot.io/), queried on submission. Coordinate searches stay local.

Rendering uses device-pixel resolution and floating-point elevations, with bounded requests and caches. Source coverage, resolution, vertical datums, and mosaic illumination vary; seams and gaps can occur. Polar caps beyond approximately ±85.05° are not rendered. Planetary meshes can reveal triangular facets. Inland-water elevations use an experimental Mapterhorn surface estimate plus Seascape depth and may be inaccurate. This is a visualization, not a navigation chart.

Bundled library and font licenses are in `vendor/` and `fonts/`, including [GeoTIFF.js](https://github.com/geotiffjs/geotiff.js) and [@jsquash/avif](https://github.com/jamsinclair/jSquash).

## Tests

```sh
npm test
```

Optional browser/GPU checks use a separately installed Playwright:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/webgpu.mjs
```

Additional scripts in `tests/` cover imagery, overlays, terrain processing, caching, and HDR export.
