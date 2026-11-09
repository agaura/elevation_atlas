# Administrative mask data

`countries.json` is a compact lookup derived from Natural Earth's 1:50m admin-0 countries (public domain):
https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson

Regenerate it with `python3 tools/update-mask-countries.py`. It loads only when administrative isolation is first used. Properties are reduced to a country code/name; coordinates are rounded to five decimal places.

The worker obtains the hovered country's ADM0/ADM1/ADM2 polygons from the geoBoundaries **gbOpen** API, using its simplified geometry download. Data and metadata: https://www.geoboundaries.org/api.html. Attribution: geoBoundaries, CC BY 4.0; country datasets retain their documented source/license information through the API. Credits appear in the app's footer.

Country, state/province, and county/district selection follow the map's boundary thresholds (zoom 0, 5, 9). Missing or oversized detailed datasets fall back to a coarser available level. The Natural Earth lookup is also the last fallback; coastlines and administrative boundaries can differ from the OpenStreetMap lines used for map labels. This is not an authoritative boundary service.

Queries are throttled and processed in a worker. It keeps at most six subdivision datasets with a 48 MiB estimated geometry budget, rejects downloads over 16 MiB, and caches downloaded polygons on disk. A released modifier cancels pending selections; an already-running shared download can finish into the cache. Mask rasterization is capped at 2048 pixels on its long edge. The GPU samples the geographic mask for either projection, leaving the color strip unaffected.

Masked automatic elevation limits are reduced on the GPU from the current viewport and selected polygon, excluding hidden water as usual. Mask entry/exit and region changes use short eased fades. Command/Ctrl-click pins the selected administrative region. Further modifier-hover previews other regions; releasing the modifier restores the pinned region. Clear removes the pin, as does changing the celestial body.
