const crypto = require('crypto');
const { db } = require('./db');
const cfg = require('./config');
const { HttpError, v, hashPassword, verifyPassword, DUMMY_HASH, signToken, verifyToken, rateLimit, sendMail } = require('./lib');
const geo = require('./geo');

// ---- middlewares ----
function loadUser(ctx) {
  const p = verifyToken(ctx.cookies.gx_session, cfg.jwtSecret);
  if (!p) return;
  const u = db.prepare('SELECT id,name,email,role,phone,active FROM users WHERE id=?').get(p.uid);
  if (u && u.active) ctx.user = u; // el rol siempre sale de la base de datos, nunca del token
}
const auth = (ctx) => { if (!ctx.user) throw new HttpError(401, 'Iniciá sesión para continuar'); };
const role = (...roles) => (ctx) => {
  auth(ctx);
  if (!roles.includes(ctx.user.role)) throw new HttpError(403, 'No tenés permisos para esta acción');
};
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone });
function startSession(ctx, user) {
  const token = signToken({ uid: user.id }, cfg.jwtSecret, cfg.sessionDays * 86400);
  ctx.cookie(`gx_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${cfg.sessionDays * 86400}${cfg.isProd ? '; Secure' : ''}`);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function routes(r) {
  r.post('/api/auth/register', rateLimit('register', 10, 3600e3), async (ctx) => {
    const b = ctx.body;
    const name = v.str(b.name, 'name', { min: 2, max: 100, label: 'El nombre' });
    const email = v.email(b.email);
    const password = v.password(b.password);
    const phone = v.optStr(b.phone, 'phone', { max: 30, label: 'El teléfono' });
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'Ya existe una cuenta con ese email', { field: 'email' });
    const id = db.prepare("INSERT INTO users(name,email,password_hash,role,phone) VALUES (?,?,?, 'client', ?)").run(name, email, await hashPassword(password), phone).lastInsertRowid;
    const user = db.prepare('SELECT id,name,email,role,phone FROM users WHERE id=?').get(id);
    startSession(ctx, user);
    return { status: 201, data: { user: publicUser(user) } };
  });

  r.post('/api/auth/login', rateLimit('login', 15, 15 * 60e3), async (ctx) => {
    const email = v.email(ctx.body.email);
    const pw = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const ok = await verifyPassword(pw, u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok || !u.active) throw new HttpError(401, 'Email o contraseña incorrectos');
    startSession(ctx, u);
    return { user: publicUser(u) };
  });

  r.post('/api/auth/logout', (ctx) => {
    ctx.cookie('gx_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  });
  r.get('/api/auth/me', (ctx) => ({ user: ctx.user ? publicUser(ctx.user) : null }));

  // Recuperación de contraseña: siempre responde igual para no revelar qué emails existen
  r.post('/api/auth/forgot', rateLimit('forgot', 5, 15 * 60e3), async (ctx) => {
    const email = v.email(ctx.body.email);
    const u = db.prepare('SELECT id,name FROM users WHERE email=? AND active=1').get(email);
    if (u) {
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES (?,?,?)').run(u.id, sha(token), new Date(Date.now() + 3600e3).toISOString());
      try {
        await sendMail({ to: email, subject: 'Recuperá tu contraseña - GoExpress',
          text: `Hola ${u.name},\n\nPara crear una contraseña nueva ingresá a este enlace (vence en 1 hora):\n${cfg.appUrl}/#/reset?token=${token}\n\nSi no lo pediste, ignorá este mensaje.` });
      } catch (e) { console.error('No se pudo enviar el email de recuperación:', e.message); }
    }
    return { ok: true, message: 'Si el email está registrado, te enviamos las instrucciones para recuperar tu contraseña.' };
  });
  r.post('/api/auth/reset', rateLimit('reset', 10, 15 * 60e3), async (ctx) => {
    const token = v.str(ctx.body.token, 'token', { max: 200, label: 'El enlace' });
    const password = v.password(ctx.body.password);
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash=? AND used=0').get(sha(token));
    if (!row || new Date(row.expires_at) < new Date()) throw new HttpError(400, 'El enlace no es válido o ya venció');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(password), row.user_id);
    db.prepare('UPDATE password_resets SET used=1 WHERE user_id=?').run(row.user_id);
    return { ok: true };
  });

  // ---- perfil ----
  r.put('/api/me', auth, (ctx) => {
    const name = v.str(ctx.body.name, 'name', { min: 2, max: 100, label: 'El nombre' });
    const phone = v.optStr(ctx.body.phone, 'phone', { max: 30, label: 'El teléfono' });
    db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(name, phone, ctx.user.id);
    return { user: publicUser({ ...ctx.user, name, phone }) };
  });
  r.post('/api/me/password', auth, async (ctx) => {
    const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(ctx.user.id);
    if (!(await verifyPassword(String(ctx.body.current || ''), u.password_hash))) throw new HttpError(422, 'La contraseña actual no es correcta', { field: 'current' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(v.password(ctx.body.password)), ctx.user.id);
    return { ok: true };
  });
  r.get('/api/me/addresses', auth, (ctx) =>
    ({ addresses: db.prepare('SELECT id,label,address,lat,lng FROM addresses WHERE user_id=? ORDER BY id DESC').all(ctx.user.id) }));
  r.post('/api/me/addresses', auth, async (ctx) => {
    const label = v.str(ctx.body.label, 'label', { max: 40, label: 'El nombre de la dirección' });
    const place = await geo.resolvePlace(ctx.body, 'address');
    if (db.prepare('SELECT COUNT(*) c FROM addresses WHERE user_id=?').get(ctx.user.id).c >= 20) throw new HttpError(422, 'Alcanzaste el máximo de 20 direcciones guardadas');
    const id = db.prepare('INSERT INTO addresses(user_id,label,address,lat,lng) VALUES (?,?,?,?,?)').run(ctx.user.id, label, place.address, place.lat, place.lng).lastInsertRowid;
    return { status: 201, data: { address: { id, label, address: place.address, lat: place.lat, lng: place.lng } } };
  });
  r.delete('/api/me/addresses/:id', auth, (ctx) => {
    db.prepare('DELETE FROM addresses WHERE id=? AND user_id=?').run(Number(ctx.params.id), ctx.user.id);
    return { ok: true };
  });
}
module.exports = { routes, loadUser, auth, role, publicUser };
