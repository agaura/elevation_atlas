const earthRadius = 6378137;

// Reference scale at the viewport center. Orthographic globe scale varies
// across the disk, so use the surface arc of a centered horizontal segment.
export function distanceScale(view, viewportWidth, sphereRadius = null) {
  const maximumWidth = Math.max(20, Math.min(120, viewportWidth - 40));
  const cosLatitude = 1 / Math.cosh(Math.PI * (1 - 2 * view.y));
  const metresPerPixel = 2 * Math.PI * earthRadius * cosLatitude / (256 * 2 ** view.zoom);
  const maximumDistance = sphereRadius
    ? 2 * earthRadius * Math.asin(Math.min(.9, maximumWidth / (2 * sphereRadius)))
    : maximumWidth * metresPerPixel;
  const magnitude = 10 ** Math.floor(Math.log10(maximumDistance));
  const distance = [5, 2, 1].map(step => step * magnitude).find(value => value <= maximumDistance);
  const width = sphereRadius
    ? 2 * sphereRadius * Math.sin(distance / (2 * earthRadius))
    : distance / metresPerPixel;
  const label = distance >= 1000 ? `${Number((distance / 1000).toPrecision(3))} km` : `${Number(distance.toPrecision(3))} m`;
  return {width, label};
}
