// https://developers.google.com/maps/documentation/urls/get-started
export function googleMapsUrl(view, zoom = view.zoom) {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878,
    Math.atan(Math.sinh(Math.PI * (1 - 2 * view.y))) * 180 / Math.PI));
  const longitude = ((view.x % 1 + 1) % 1) * 360 - 180;
  const url = new URL('https://www.google.com/maps/@');
  url.searchParams.set('api', '1');
  url.searchParams.set('map_action', 'map');
  url.searchParams.set('center', `${latitude.toFixed(7)},${longitude.toFixed(7)}`);
  // Maps URLs accept integer zoom levels; use the closest supported scale.
  url.searchParams.set('zoom', String(Math.max(0, Math.min(21, Math.round(zoom)))));
  return url.href;
}
