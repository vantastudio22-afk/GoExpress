const crypto = require('crypto');
const { db, tx, balanceOf } = require('./db');
const { HttpError, v } = require('./lib');
const { auth } = require('./auth');
const { iso } = require('./services');

const rewardView = (r) => ({ id: r.id, name: r.name, description: r.description, pointsCost: r.points_cost, discountType: r.discount_type, discountValue: r.discount_value, featured: !!r.featured });
function routes(r) {
  r.get('/api/points', auth, (ctx) => {
    const uid = ctx.user.id;
    const ledger = db.prepare('SELECT id,points,type,note,created_at FROM points_ledger WHERE user_id=? ORDER BY id DESC LIMIT 200').all(uid)
      .map((l) => ({ id: l.id, points: l.points, type: l.type, note: l.note, at: iso(l.created_at) }));
    const coupons = db.prepare('SELECT id,code,discount_type,discount_value,status,created_at FROM coupons WHERE user_id=? ORDER BY id DESC').all(uid)
      .map((c) => ({ id: c.id, code: c.code, discountType: c.discount_type, discountValue: c.discount_value, status: c.status, createdAt: iso(c.created_at) }));
    const rewards = db.prepare('SELECT * FROM rewards WHERE active=1 ORDER BY featured DESC, points_cost').all().map(rewardView);
    const earned = ledger.filter((l) => l.points > 0).reduce((a, l) => a + l.points, 0);
    return { balance: balanceOf(uid), earned, used: earned - balanceOf(uid), ledger, coupons, rewards };
  });

  // Canje: descuenta puntos y crea el cupón en una sola transacción
  r.post('/api/points/redeem', auth, (ctx) => {
    const rewardId = v.num(ctx.body.rewardId, 'rewardId', { int: true, min: 1, label: 'La recompensa' });
    return tx(() => {
      const rw = db.prepare('SELECT * FROM rewards WHERE id=? AND active=1').get(rewardId);
      if (!rw) throw new HttpError(404, 'La recompensa no está disponible');
      const bal = balanceOf(ctx.user.id);
      if (bal < rw.points_cost) throw new HttpError(422, `Te faltan ${rw.points_cost - bal} puntos para canjear esta recompensa`);
      db.prepare("INSERT INTO points_ledger(user_id,points,type,reward_id,note) VALUES (?,?,'redeem',?,?)").run(ctx.user.id, -rw.points_cost, rw.id, `Canje: ${rw.name}`);
      const code = 'GX-' + crypto.randomBytes(5).toString('hex').toUpperCase();
      const id = db.prepare('INSERT INTO coupons(user_id,reward_id,code,discount_type,discount_value) VALUES (?,?,?,?,?)').run(ctx.user.id, rw.id, code, rw.discount_type, rw.discount_value).lastInsertRowid;
      return { status: 201, data: { coupon: { id, code, discountType: rw.discount_type, discountValue: rw.discount_value }, balance: bal - rw.points_cost } };
    });
  });
}
module.exports = { routes, rewardView };
