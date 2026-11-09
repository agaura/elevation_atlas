# Mars and Moon source investigation

Verified with real cross-origin browser requests on 2026-11-08. Implemented in the body selector and worker terrain pipeline.

## Global terrain

NASA Trek's own configuration points to these public datasets:

- Mars: https://marshub.s3.amazonaws.com/mars_v14/layer.json
- Moon: https://marshub.s3.amazonaws.com/moon_v14/layer.json
- Configuration: https://trek.nasa.gov/mars/jpl/config/config.json and https://trek.nasa.gov/moon/jpl/config/config.json

Both allow browser CORS, need no key, and serve quantized-mesh-1.0 in geographic TMS: 2×1 root tiles, south-origin Y. Tiles follow `{z}/{x}/{y}.terrain?v=2.0`.

The probe decodes real height vertices at z0 and z8. Sample tile payloads were 3–16 KB. Manifests advertise maximum levels 18 (Mars) and 16 (Moon), but the availability rectangles must be checked; these levels do not imply uniform global resolution.

Meshes are simplified surfaces, not native DEM raster samples. Rasterizing them can introduce triangle-related gradient artifacts. Native device-pixel rendering cannot recover terrain detail absent from the mesh.

Mars Trek shifts its mesh heights upward by 8,201 m (its configuration pairs `elevationMinValue: -8201` with `cesiumElevationMinValue: 0`). The reader removes that shift. A matched CTX sample at 168.27922° E, 4.71803° N measured −2,933.19 m in `geoid_adjusted_dem`, versus −2,937.50 m in the corrected z9 mesh; the roughly 4 m residual is consistent with mesh simplification. This is a spot check, not a global datum validation. For example, the Mars z8 Olympus-region tile (65,154) has header heights 26,327–28,607 m; do not assume these are MOLA areoid heights. NASA's Mars viewer configuration uses a 3,390,000 m sphere, while the sampled CTX raster specifies 3,396,190 m. The raw CTX sphere-referenced asset is not used; its 6,190 m radius difference does not explain the mesh offset.

## High-resolution raster refinement

Official catalog: https://stac.astrogeology.usgs.gov/api/collections

- Mars collection: `mro_ctx_controlled_usgs_dtms`; use `geoid_adjusted_dem` rather than mixing the raw DEM datum with MOLA elevation.
- Moon collection: `kaguya_terrain_camera_usgs_dtms_v2_equi`; use `dtm`. Separate north/south polar collections are also listed.

Assets are public COGs in `astrogeo-ard` S3. Real browser range requests returned HTTP 206 and decoded numerical float elevation patches with the repository's existing GeoTIFF library:

| Sample | Pixel spacing | Overviews including full image | Valid 16×16 patch heights | Transferred for opening, patch, and metadata |
| --- | --- | --- | --- | --- |
| Mars CTX | 20 m | 3 | −2941.85 to −2925.48 m | 842,113 bytes / 5 requests |
| Moon Kaguya | 13.503 m | 3 | −457.85 to −449.85 m | 469,858 bytes / 7 requests |

These are individual samples, not guarantees of uniform coverage, resolution, performance, or quality. The CTX collection explicitly flags some poor DTMs with jitter or missing data. Use spatial catalog queries, bounded caching, nodata-aware fallback, and quality selection. A 16×16 read still decompresses entire storage blocks.

Both sampled rasters are planetary equirectangular projections, with different radii and central meridians. Their meter-based coordinates must be transformed before sampling. The Moon sample uses central meridian 180°; the Mars sample uses 0°.

## Implementation

1. Body metadata (radius, horizontal/vertical reference, native sampling limits), body-specific caches, and cancel old requests on body changes.
2. Decode and rasterize global NASA meshes into the existing float-height GPU pipeline. Clearly preserve their simplified-source status.
3. Add spatially queried COG refinement in workers, choosing overviews from the actual device-pixel footprint. Resolve datum differences before merging.
4. Supply correct scale bars, coordinate navigation and planetary zoom ceilings. Disable Earth-only water, roads, address search and Google Maps actions for other bodies.
5. Treat full polar rendering as additional projection work: the current Mercator terrain path stops near ±85° even though the planetary sources can cover the poles.

The older `planetarymaps.usgs.gov` global GeoTIFF URLs returned 403 in this environment. That is an observed access limitation, not proof that those datasets are unavailable everywhere.

## Reproduce

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/planetary-sources-browser.mjs
```

This optional live test only reads manifests, two terrain tiles per body, catalog samples, and small COG windows. It does not bulk-download the datasets or change app state.

Refinement uses GeoTIFF.js’s bounded range source because Astrogeology does not expose `Content-Range` through CORS. Reader caches, scene counts and raster windows are bounded; a missing or invalid local DEM leaves the global mesh intact. A tile queries up to eight catalog results and reads at most two scenes. Catalog truncation, unsupported projections and nodata can leave some otherwise available detail unused.

Polar mesh selection measures the Mercator-projected height of geographic source cells. Visible tiles can refine up to three levels beyond the base density, within 192 unique source meshes per output tile. Refinement proceeds across complete latitude rows to avoid arbitrary longitude strips, and only available descendants are requested. The two-read per tile concurrency and 32 MiB decoded mesh cache remain unchanged. This reduces faceting; it does not remove Mercator distortion or fill the missing polar caps.
