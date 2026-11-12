// Utilidades del servidor sin dependencias externas: router, seguridad, validación, tokens, contraseñas.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

// ---- configuración (.env opcional) ----
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---- router ----
class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  put(p, ...h) { this.add('PUT', p, ...h); }
  patch(p, ...h) { this.add('PATCH', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handlers: r.handlers, params };
    }
    return { handlers: null, pathMatched };
  }
}

// ---- helpers HTTP ----
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
async function readJson(req, limit = 100 * 1024) {
  if (['GET', 'HEAD', 'DELETE'].includes(req.method)) return {};
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Solicitud demasiado grande');
    chunks.push(c);
  }
  if (!size) return {};
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Se esperaba JSON');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'JSON inválido'); }
}
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; " +
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function sendJson(res, status, data, extra = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra });
  res.end(body);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webp': 'image/webp' };
function serveStatic(req, res, root, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // la app usa rutas con #, el resto cae en index
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep) && file !== root) throw new HttpError(403, 'Prohibido');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'No encontrado');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
  fs.createReadStream(file).pipe(res);
}

// ---- contraseñas (scrypt) ----
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? no(e) : ok(k))));
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(pw, salt)).toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const got = await scrypt(pw, Buffer.from(saltHex, 'hex'));
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
const DUMMY_HASH = 'scrypt$' + '00'.repeat(16) + '$' + '00'.repeat(64); // para igualar tiempos cuando el usuario no existe

// ---- tokens firmados (HS256) ----
const b64 = (b) => Buffer.from(b).toString('base64url');
function signToken(payload, secret, ttlSec) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyToken(token, secret) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const good = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (good.length !== given.length || !crypto.timingSafeEqual(good, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

// ---- validación ----
const bad = (field, msg) => new HttpError(422, msg, { field });
const v = {
  str(x, field, { min = 1, max = 200, label = field } = {}) {
    if (typeof x !== 'string') throw bad(field, `${label} es obligatorio`);
    const s = x.trim();
    if (s.length < min) throw bad(field, min === 1 ? `${label} es obligatorio` : `${label} debe tener al menos ${min} caracteres`);
    if (s.length > max) throw bad(field, `${label} es demasiado largo (máximo ${max})`);
    return s;
  },
  optStr(x, field, o = {}) { return x === undefined || x === null || x === '' ? null : v.str(x, field, o); },
  num(x, field, { min = -Infinity, max = Infinity, label = field, int = false } = {}) {
    const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(field, `${label} debe ser un número`);
    if (int && !Number.isInteger(n)) throw bad(field, `${label} debe ser un número entero`);
    if (n < min || n > max) throw bad(field, `${label} debe estar entre ${min} y ${max}`);
    return n;
  },
  email(x, field = 'email') {
    const s = v.str(x, field, { max: 120, label: 'El email' }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw bad(field, 'El email no es válido');
    return s;
  },
  password(x, field = 'password') {
    if (typeof x !== 'string' || x.length < 8 || x.length > 100) throw bad(field, 'La contraseña debe tener entre 8 y 100 caracteres');
    if (!/[A-Za-z]/.test(x) || !/\d/.test(x)) throw bad(field, 'La contraseña debe incluir letras y números');
    return x;
  },
  oneOf(x, field, list, label = field) {
    if (!list.includes(x)) throw bad(field, `${label} no es válido`);
    return x;
  },
  coords(o, field) {
    if (o === undefined || o === null) return null;
    return { lat: v.num(o.lat, field + '.lat', { min: -90, max: 90, label: 'Latitud' }), lng: v.num(o.lng, field + '.lng', { min: -180, max: 180, label: 'Longitud' }) };
  },
};

// ---- límite de solicitudes (en memoria) ----
const buckets = new Map();
function rateLimit(name, max, windowMs) {
  return (ctx) => {
    const key = name + ':' + ctx.ip;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
    if (++b.count > max) throw new HttpError(429, 'Demasiados intentos. Probá de nuevo en unos minutos.');
  };
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset < n) buckets.delete(k); }, 60000).unref();

// ---- envío de emails (Resend por HTTP). Sin credenciales: se muestra en consola (solo desarrollo) ----
async function sendMail({ to, subject, text }) {
  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'GoExpress <onboarding@resend.dev>', to, subject, text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error('El proveedor de email respondió ' + r.status);
    return true;
  }
  console.log(`\n[EMAIL no configurado - solo desarrollo]\nPara: ${to}\nAsunto: ${subject}\n${text}\n`);
  return false;
}

module.exports = { HttpError, loadEnv, Router, parseCookies, readJson, sendJson, serveStatic, SECURITY_HEADERS, hashPassword, verifyPassword, DUMMY_HASH,
  signToken, verifyToken, v, rateLimit, sendMail };
