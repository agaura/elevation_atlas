const cooldowns = new Map();
let paused = false, resume;
let resumed = Promise.resolve();
export function setBackgroundPaused(value) {
  if (value === paused) return;
  paused = value;
  if (value) resumed = new Promise(resolve => {resume = resolve;});
  else resume?.();
}
export async function waitForBackground() {while (paused) await resumed;}
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - now) || 0;
}
export function retryDelay(error, attempt = 1, random = Math.random, base = 1000) {
  const backoff = error.name === 'TimeoutError' ? 250 : Math.min(60000, base * 2 ** Math.min(attempt - 1, 6));
  return Math.max(error.retryAfterMs || 0, backoff * (.8 + .4 * random()));
}
export async function politeFetch(url, options, fetcher = fetch) {
  const origin = new URL(url, 'http://localhost').origin;
  const blockedUntil = cooldowns.get(origin) || 0;
  if (blockedUntil > Date.now()) {
    throw Object.assign(new Error('Provider is cooling down'), {status: 429, retryAfterMs: blockedUntil - Date.now()});
  }
  const response = await fetcher(url, options);
  if (!response.ok && (response.status === 429 || response.status === 503)) {
    const delay = Math.max(1000, retryAfterMs(response.headers.get('retry-after')) || 30000);
    cooldowns.set(origin, Date.now() + delay);
    await response.body?.cancel();
    throw Object.assign(new Error(`Provider HTTP ${response.status}`), {status: response.status, retryAfterMs: delay});
  }
  return response;
}
