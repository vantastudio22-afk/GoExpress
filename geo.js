// Servicios externos de mapas: Nominatim (geocodificación) y OSRM (rutas), ambos de OpenStreetMap.
// Se pueden cambiar por servidores propios o por otro proveedor mediante variables de entorno.
const NOMINATIM = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const UA = process.env.GEO_USER_AGENT || 'GoExpress/1.0 (configurar GEO_USER_AGENT con un contacto)';
const COUNTRY = process.env.GEO_COUNTRY || 'ar';
const cache = new Map();
const TTL = 24 * 3600 * 1000;
let lastCall = 0;

async function http(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
function remember(key, value, ttl = TTL) {
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  cache.set(key, { value, exp: Date.now() + ttl });
}
function recall(key) {
  const c = cache.get(key);
  if (c && c.exp > Date.now()) return c.value;
  cache.delete(key);
  return undefined;
}
// Nominatim pide máximo 1 consulta por segundo
async function throttle() {
  const wait = lastCall + 1100 - Date.now();
  lastCall = Math.max(Date.now(), lastCall) + (wait > 0 ? wait : 0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function geocode(q) {
  const key = 'g:' + q.toLowerCase().trim();
  const hit = recall(key);
  if (hit) return hit;
  await throttle();
  const url = `${NOMINATIM}/search?format=jsonv2&limit=5&addressdetails=0&countrycodes=${COUNTRY}&q=${encodeURIComponent(q)}`;
  const data = await http(url);
  const out = data.map((d) => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) }));
  remember(key, out);
  return out;
}

function haversineKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Ruta real por calles. Si el servicio no responde devuelve null (el llamador decide qué mostrar).
async function route(a, b, { geometry = false, ttl = 60 * 1000 } = {}) {
  const key = `r:${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}:${geometry}`;
  const hit = recall(key);
  if (hit !== undefined) return hit;
  try {
    const url = `${OSRM}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=${geometry ? 'full' : 'false'}&geometries=geojson`;
    const data = await http(url);
    const r = data.routes && data.routes[0];
    if (!r) throw new Error('sin ruta');
    const out = { km: r.distance / 1000, minutes: r.duration / 60, coordinates: geometry ? r.geometry.coordinates : null };
    remember(key, out, ttl);
    return out;
  } catch (e) {
    return null;
  }
}

// Distancia para cotizar: ruta por calles o, si no hay servicio, estimación en línea recta (se informa la fuente)
async function distanceBetween(a, b) {
  const r = await route(a, b, { geometry: false, ttl: 3600 * 1000 });
  if (r) return { km: Math.round(r.km * 10) / 10, source: 'osrm' };
  return { km: Math.round(haversineKm(a, b) * 1.3 * 10) / 10, source: 'estimate' };
}
module.exports = { geocode, route, haversineKm, distanceBetween };

// Convierte {address, lat?, lng?} en un lugar con coordenadas. Nunca inventa una ubicación.
const { HttpError } = require('./lib');
async function resolvePlace(p, field) {
  if (!p || typeof p.address !== 'string' || p.address.trim().length < 3) throw new HttpError(422, 'Ingresá una dirección válida', { field });
  const address = p.address.trim().slice(0, 250);
  if (p.lat !== undefined && p.lat !== null && p.lng !== undefined && p.lng !== null) {
    const lat = Number(p.lat), lng = Number(p.lng);
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) throw new HttpError(422, 'Coordenadas inválidas', { field });
    return { address, lat, lng };
  }
  let found;
  try { found = await geocode(address); }
  catch { throw new HttpError(503, 'El servicio de mapas no está disponible ahora. Probá de nuevo en unos minutos.', { field }); }
  if (!found.length) throw new HttpError(422, 'No pudimos ubicar esa dirección. Agregá calle, número y ciudad.', { field });
  return { address, lat: found[0].lat, lng: found[0].lng, resolvedAs: found[0].label };
}
module.exports.resolvePlace = resolvePlace;
