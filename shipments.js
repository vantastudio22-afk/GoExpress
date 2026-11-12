const { db } = require('./db');
const { HttpError, v, rateLimit } = require('./lib');
const { auth } = require('./auth');
const geo = require('./geo');
const S = require('./services');
const { SERVICE_LABELS } = require('./constants');

function routes(r) {
  // Búsqueda de direcciones (OpenStreetMap / Nominatim)
  r.get('/api/geo/search', rateLimit('geo', 40, 60e3), async (ctx) => {
    const q = v.str(ctx.query.q, 'q', { min: 3, max: 200, label: 'La dirección' });
    try { return { results: await geo.geocode(q) }; }
    catch { throw new HttpError(503, 'El servicio de mapas no está disponible ahora'); }
  });

  // Cotización (pública, no guarda nada)
  r.post('/api/quote', rateLimit('quote', 60, 60e3), async (ctx) => {
    const q = await S.quoteFrom(ctx.body);
    return {
      origin: q.origin, destination: q.destination,
      distanceKm: q.distance.km, distanceSource: q.distance.source,
      serviceLabel: SERVICE_LABELS[q.pkg.service], price: q.price, currency: 'ARS',
      note: q.distance.source === 'estimate' ? 'Distancia estimada en línea recta (el servicio de rutas no respondió). El precio final puede variar.' : null,
    };
  });

  // Solicitud de envío (cliente con sesión). El precio se recalcula siempre en el servidor.
  r.post('/api/shipments', auth, rateLimit('ship', 30, 3600e3), async (ctx) => {
    const sh = await S.createShipment(ctx.user.id, ctx.body);
    return { status: 201, data: { shipment: S.shipmentView(sh) } };
  });
  r.get('/api/shipments/mine', auth, (ctx) => ({
    shipments: db.prepare('SELECT * FROM shipments WHERE user_id=? ORDER BY id DESC LIMIT 200').all(ctx.user.id).map((s) => S.shipmentView(s)),
  }));

  // Seguimiento: público por número de seguimiento (sin nombres ni direcciones exactas)
  r.get('/api/track/:code', rateLimit('track', 120, 60e3), async (ctx) => {
    const code = String(ctx.params.code).trim().toUpperCase();
    const sh = db.prepare('SELECT * FROM shipments WHERE tracking_code=?').get(code);
    if (!sh) throw new HttpError(404, 'No encontramos un envío con ese número de seguimiento');
    const full = !!ctx.user && (ctx.user.id === sh.user_id || ctx.user.role === 'admin' || (ctx.user.role === 'driver' && ctx.user.id === sh.driver_id));
    return { tracking: await S.trackInfo(sh, { full }) };
  });
}
module.exports = { routes };
