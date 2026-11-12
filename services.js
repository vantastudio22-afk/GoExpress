// Lógica de negocio: cotización, alta de envíos, cambios de estado, puntos y seguimiento.
const crypto = require('crypto');
const { db, tx, getSettings } = require('./db');
const { HttpError, v } = require('./lib');
const { computePrice, applyCoupon } = require('./pricing');
const geo = require('./geo');
const cfg = require('./config');
const { STATUSES, STATUS_LABELS, SERVICES, SERVICE_LABELS, MOVING } = require('./constants');

// ---------- cotización ----------
function parsePackage(b) {
  return {
    weightKg: v.num(b.weightKg, 'weightKg', { min: 0.01, max: 70, label: 'El peso (kg)' }),
    lengthCm: v.num(b.lengthCm, 'lengthCm', { min: 1, max: 200, label: 'El largo (cm)' }),
    widthCm: v.num(b.widthCm, 'widthCm', { min: 1, max: 200, label: 'El ancho (cm)' }),
    heightCm: v.num(b.heightCm, 'heightCm', { min: 1, max: 200, label: 'El alto (cm)' }),
    service: v.oneOf(b.service, 'service', SERVICES, 'El tipo de envío'),
  };
}
async function quoteFrom(b) {
  const pkg = parsePackage(b);
  const [origin, destination] = [await geo.resolvePlace(b.origin, 'origin'), await geo.resolvePlace(b.destination, 'destination')];
  const dist = await geo.distanceBetween(origin, destination);
  if (dist.km > 3000) throw new HttpError(422, 'La distancia supera la cobertura del servicio', { field: 'destination' });
  const price = computePrice({ distanceKm: dist.km, ...pkg }, getSettings());
  return { origin, destination, pkg, distance: dist, price };
}

// ---------- envíos ----------
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newTrackingCode() {
  let s = '';
  for (const b of crypto.randomBytes(10)) s += ALPHABET[b % ALPHABET.length];
  return 'GX' + s;
}
async function createShipment(userId, b) {
  const q = await quoteFrom(b);
  const senderName = v.str(b.senderName, 'senderName', { max: 100, label: 'El nombre del remitente' });
  const receiverName = v.str(b.receiverName, 'receiverName', { max: 100, label: 'El nombre del destinatario' });
  const couponId = b.couponId === undefined || b.couponId === null || b.couponId === '' ? null : v.num(b.couponId, 'couponId', { int: true, min: 1 });
  return tx(() => {
    let coupon = null;
    if (couponId) {
      coupon = db.prepare("SELECT * FROM coupons WHERE id=? AND user_id=? AND status='available'").get(couponId, userId);
      if (!coupon) throw new HttpError(422, 'El cupón no existe o ya fue utilizado', { field: 'couponId' });
    }
    const discount = applyCoupon(q.price.total, coupon);
    const final = q.price.total - discount;
    let code, id;
    for (let i = 0; i < 5; i++) {
      code = newTrackingCode();
      try {
        id = db.prepare(`INSERT INTO shipments(tracking_code,user_id,sender_name,receiver_name,origin_address,origin_lat,origin_lng,dest_address,dest_lat,dest_lng,
          weight_kg,length_cm,width_cm,height_cm,service,distance_km,distance_source,price_total,discount,price_final,coupon_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, userId, senderName, receiverName, q.origin.address, q.origin.lat, q.origin.lng,
          q.destination.address, q.destination.lat, q.destination.lng, q.pkg.weightKg, q.pkg.lengthCm, q.pkg.widthCm, q.pkg.heightCm, q.pkg.service,
          q.distance.km, q.distance.source, q.price.total, discount, final, couponId).lastInsertRowid;
        break;
      } catch (e) { if (!String(e.message).includes('UNIQUE')) throw e; }
    }
    if (!id) throw new HttpError(500, 'No se pudo generar el número de seguimiento');
    db.prepare('INSERT INTO shipment_events(shipment_id,status,note,by_user) VALUES (?,?,?,?)').run(id, 'received', 'Solicitud recibida', userId);
    if (coupon) {
      const r = db.prepare("UPDATE coupons SET status='used', used_at=datetime('now'), shipment_id=? WHERE id=? AND status='available'").run(id, couponId);
      if (r.changes !== 1) throw new HttpError(409, 'El cupón ya fue utilizado');
    }
    return db.prepare('SELECT * FROM shipments WHERE id=?').get(id);
  });
}

// Cambio de estado: solo hacia adelante para el repartidor; el administrador puede corregir en cualquier sentido.
function setStatus(shipmentId, newStatus, actor, note) {
  v.oneOf(newStatus, 'status', STATUSES, 'El estado');
  return tx(() => {
    const sh = db.prepare('SELECT * FROM shipments WHERE id=?').get(shipmentId);
    if (!sh) throw new HttpError(404, 'Envío no encontrado');
    if (actor.role === 'driver') {
      if (sh.driver_id !== actor.id) throw new HttpError(403, 'Este envío no está asignado a vos');
      if (STATUSES.indexOf(newStatus) <= STATUSES.indexOf(sh.status)) throw new HttpError(422, 'El estado solo puede avanzar');
      if (newStatus === 'received' || newStatus === 'pickup_pending') throw new HttpError(422, 'Estado no permitido para repartidores');
    }
    if (sh.status === 'delivered' && actor.role !== 'admin') throw new HttpError(422, 'El envío ya fue entregado');
    if (sh.status === newStatus) return sh;
    if (newStatus !== 'received' && newStatus !== 'pickup_pending' && !sh.driver_id) throw new HttpError(422, 'Primero asigná un repartidor al envío');
    db.prepare("UPDATE shipments SET status=?, updated_at=datetime('now'), delivered_at=CASE WHEN ?='delivered' THEN datetime('now') ELSE NULL END WHERE id=?").run(newStatus, newStatus, shipmentId);
    db.prepare('INSERT INTO shipment_events(shipment_id,status,note,by_user) VALUES (?,?,?,?)').run(shipmentId, newStatus, note || STATUS_LABELS[newStatus], actor.id);
    if (newStatus === 'delivered') awardPoints(sh);
    return db.prepare('SELECT * FROM shipments WHERE id=?').get(shipmentId);
  });
}
// Puntos por envío entregado: una sola vez por envío (índice único en la base de datos)
function awardPoints(sh) {
  const pts = Math.floor((sh.price_final / 100) * getSettings().points_per_100);
  if (pts <= 0) return 0;
  db.prepare("INSERT OR IGNORE INTO points_ledger(user_id,points,type,shipment_id,note) VALUES (?,?,'earn',?,?)")
    .run(sh.user_id, pts, sh.id, `Envío ${sh.tracking_code} entregado`);
  return pts;
}
function assignDriver(shipmentId, driverId, actor) {
  return tx(() => {
    const sh = db.prepare('SELECT * FROM shipments WHERE id=?').get(shipmentId);
    if (!sh) throw new HttpError(404, 'Envío no encontrado');
    const d = db.prepare("SELECT id,name FROM users WHERE id=? AND role='driver' AND active=1").get(driverId);
    if (!d) throw new HttpError(422, 'Repartidor no válido', { field: 'driverId' });
    if (sh.status === 'delivered') throw new HttpError(422, 'El envío ya fue entregado');
    db.prepare("UPDATE shipments SET driver_id=?, updated_at=datetime('now'), status=CASE WHEN status='received' THEN 'pickup_pending' ELSE status END WHERE id=?").run(driverId, shipmentId);
    if (sh.status === 'received') db.prepare('INSERT INTO shipment_events(shipment_id,status,note,by_user) VALUES (?,?,?,?)').run(shipmentId, 'pickup_pending', `Repartidor asignado: ${d.name}`, actor.id);
    return db.prepare('SELECT * FROM shipments WHERE id=?').get(shipmentId);
  });
}

// ---------- serialización ----------
const iso = (s) => (s ? s.replace(' ', 'T') + 'Z' : null);
function shipmentView(r, { full = true } = {}) {
  const r3 = (x) => (full ? x : Math.round(x * 1000) / 1000);
  const o = {
    id: r.id, trackingCode: r.tracking_code, status: r.status, statusLabel: STATUS_LABELS[r.status],
    service: r.service, serviceLabel: SERVICE_LABELS[r.service], createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), deliveredAt: iso(r.delivered_at),
    origin: { lat: r3(r.origin_lat), lng: r3(r.origin_lng) }, destination: { lat: r3(r.dest_lat), lng: r3(r.dest_lng) },
  };
  if (full) Object.assign(o, {
    senderName: r.sender_name, receiverName: r.receiver_name, originAddress: r.origin_address, destinationAddress: r.dest_address,
    weightKg: r.weight_kg, lengthCm: r.length_cm, widthCm: r.width_cm, heightCm: r.height_cm,
    distanceKm: r.distance_km, distanceSource: r.distance_source, priceTotal: r.price_total, discount: r.discount, priceFinal: r.price_final,
    driverId: r.driver_id, userId: r.user_id,
  });
  return o;
}

// ---------- seguimiento en tiempo real (GPS del repartidor) ----------
async function trackInfo(sh, { full }) {
  const out = shipmentView(sh, { full });
  out.events = db.prepare('SELECT status,note,created_at FROM shipment_events WHERE shipment_id=? ORDER BY id').all(sh.id)
    .map((e) => ({ status: e.status, label: STATUS_LABELS[e.status], note: full ? e.note : STATUS_LABELS[e.status], at: iso(e.created_at) }));
  out.driverLocation = null; out.remainingKm = null; out.etaMinutes = null; out.etaAt = null; out.etaTarget = null; out.gps = { state: 'none', message: '' };

  // trazado de la ruta origen → destino (se guarda para no consultarlo cada vez)
  let route = sh.route_json ? JSON.parse(sh.route_json) : null;
  if (!route) {
    const r = await geo.route({ lat: sh.origin_lat, lng: sh.origin_lng }, { lat: sh.dest_lat, lng: sh.dest_lng }, { geometry: true });
    if (r && r.coordinates) { route = r.coordinates; db.prepare('UPDATE shipments SET route_json=? WHERE id=?').run(JSON.stringify(route), sh.id); }
  }
  out.route = route; // [[lng,lat],...] o null si el servicio de rutas no respondió

  if (sh.status === 'delivered') { out.gps = { state: 'delivered', message: 'El paquete fue entregado.' }; return out; }
  if (!sh.driver_id) { out.gps = { state: 'unassigned', message: 'Todavía no hay un repartidor asignado. El mapa en vivo se activa cuando retiran el paquete.' }; return out; }
  if (!MOVING.includes(sh.status) && sh.status !== 'pickup_pending') return out;

  const loc = db.prepare('SELECT lat,lng,accuracy,recorded_at FROM driver_locations WHERE driver_id=? ORDER BY id DESC LIMIT 1').get(sh.driver_id);
  if (!loc) { out.gps = { state: 'nosignal', message: 'Todavía no recibimos la ubicación del repartidor. Te mostramos el estado actual del envío.' }; return out; }
  const age = Math.max(0, Math.round((Date.now() - new Date(loc.recorded_at).getTime()) / 1000));
  const stale = age > cfg.staleSeconds;
  out.driverLocation = { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, recordedAt: loc.recorded_at, ageSeconds: age, stale };
  out.gps = stale
    ? { state: 'stale', message: `Sin señal GPS reciente. Última ubicación conocida hace ${age < 3600 ? Math.round(age / 60) + ' min' : Math.round(age / 3600) + ' h'}.` }
    : { state: 'live', message: 'Ubicación en vivo del repartidor.' };

  // ETA: hacia el retiro si todavía no retiraron, o hacia el destino si ya lo llevan
  const target = sh.status === 'pickup_pending' ? { lat: sh.origin_lat, lng: sh.origin_lng } : { lat: sh.dest_lat, lng: sh.dest_lng };
  out.etaTarget = sh.status === 'pickup_pending' ? 'pickup' : 'delivery';
  const r = await geo.route({ lat: loc.lat, lng: loc.lng }, target, { geometry: false, ttl: 20 * 1000 });
  if (r) {
    out.remainingKm = Math.round(r.km * 10) / 10;
    out.etaMinutes = Math.max(1, Math.round(r.minutes));
    out.etaAt = new Date(Date.now() + r.minutes * 60000).toISOString();
    out.etaDistanceSource = 'osrm';
  } else {
    out.remainingKm = Math.round(geo.haversineKm(loc, target) * 10) / 10; // línea recta, no se calcula ETA
    out.etaDistanceSource = 'straight';
    out.etaNote = 'No pudimos calcular el tiempo de llegada porque el servicio de rutas no responde. La distancia es en línea recta.';
  }
  return out;
}
module.exports = { quoteFrom, createShipment, setStatus, assignDriver, awardPoints, shipmentView, trackInfo, iso };
