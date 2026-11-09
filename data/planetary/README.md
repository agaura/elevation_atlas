# Planetary names

Approved IAU names from the USGS Gazetteer of Planetary Nomenclature:
https://planetarynames.wr.usgs.gov/GIS_Downloads

The JSON files are compact snapshots of the official KMZ center-point exports. Each file records its source URL, retrieval date, coordinate convention and tuple field order. Unapproved/dropped names and descriptive prose are excluded. Longitude is east-positive; latitude is planetocentric. Diameters are in kilometres and describe feature extent, not elevation.

Refresh both catalogs with `python3 tools/update-planetary-names.py` (Python standard library; network required). The app fetches these local files when Map Labels is enabled or a feature-name search is submitted for that body. It does not query the USGS or OpenSpace nomenclature services at runtime.
