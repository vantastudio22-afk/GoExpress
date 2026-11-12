const { db } = require('./db');
const { HttpError, v, rateLimit } = require('./lib');
const { role } = require('./auth');
const S = require('./services');

function routes(r) {
  const driver = role('driver');
  r.get('/api/driver/shipments', driver, (ctx) => ({
    shipments: db.prepare("SELECT * FROM shipments WHERE driver_id=? AND (status!='delivered' OR delivered_at > datetime('now','-1 day')) ORDER BY status='delivered', id DESC").all(ctx.user.id).map((s) => S.shipmentView(s)),
  }));
  r.post('/api/driver/shipments/:id/status', driver, (ctx) => {
    const sh = S.setStatus(Number(ctx.params.id), ctx.body.status, ctx.user, v.optStr(ctx.body.note, 'note', { max: 200 }));
    return { shipment: S.shipmentView(sh) };
  });
  // El GPS lo envía el celular del repartidor; el servidor solo guarda lo que recibe
  r.post('/api/driver/location', driver, rateLimit('loc', 40, 60e3), (ctx) => {
    const lat = v.num(ctx.body.lat, 'lat', { min: -90, max: 90 });
    const lng = v.num(ctx.body.lng, 'lng', { min: -180, max: 180 });
    const acc = ctx.body.accuracy === undefined || ctx.body.accuracy === null ? null : v.num(ctx.body.accuracy, 'accuracy', { min: 0, max: 100000 });
    db.prepare('INSERT INTO driver_locations(driver_id,lat,lng,accuracy) VALUES (?,?,?,?)').run(ctx.user.id, lat, lng, acc);
    if (Math.random() < 0.02) db.prepare("DELETE FROM driver_locations WHERE recorded_at < datetime('now','-7 days')").run();
    return { ok: true };
  });
}
module.exports = { routes };
