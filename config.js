const crypto = require('crypto');
const path = require('path');
const { loadEnv } = require('./lib');
loadEnv(path.join(__dirname, '..', '.env'));

const isProd = process.env.NODE_ENV === 'production';
let secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  if (isProd) { console.error('Falta JWT_SECRET (mínimo 32 caracteres) en producción.'); process.exit(1); }
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('[aviso] JWT_SECRET no configurado: se generó uno temporal (las sesiones se cierran al reiniciar).');
}
module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  jwtSecret: secret,
  sessionDays: Number(process.env.SESSION_DAYS) || 7,
  appUrl: (process.env.APP_URL || `http://localhost:${Number(process.env.PORT) || 3000}`).replace(/\/$/, ''),
  staleSeconds: Number(process.env.GPS_STALE_SECONDS) || 120, // pasado este tiempo sin señal se muestra "última ubicación conocida"
  frontendDir: path.resolve(process.env.FRONTEND_DIR || path.join(__dirname, '..', 'frontend')),
};
