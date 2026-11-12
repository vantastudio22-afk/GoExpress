const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'goexpress.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','driver','admin')),
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL, lng REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value REAL NOT NULL CHECK (discount_value > 0),
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reward_id INTEGER REFERENCES rewards(id),
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','used')),
  shipment_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  sender_name TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  origin_address TEXT NOT NULL, origin_lat REAL NOT NULL, origin_lng REAL NOT NULL,
  dest_address TEXT NOT NULL, dest_lat REAL NOT NULL, dest_lng REAL NOT NULL,
  weight_kg REAL NOT NULL, length_cm REAL NOT NULL, width_cm REAL NOT NULL, height_cm REAL NOT NULL,
  service TEXT NOT NULL,
  distance_km REAL NOT NULL, distance_source TEXT NOT NULL,
  price_total INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, price_final INTEGER NOT NULL,
  coupon_id INTEGER REFERENCES coupons(id),
  status TEXT NOT NULL DEFAULT 'received',
  driver_id INTEGER REFERENCES users(id),
  route_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ship_user ON shipments(user_id);
CREATE INDEX IF NOT EXISTS idx_ship_driver ON shipments(driver_id);
CREATE TABLE IF NOT EXISTS shipment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  by_user INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS driver_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id INTEGER NOT NULL REFERENCES users(id),
  lat REAL NOT NULL, lng REAL NOT NULL, accuracy REAL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_loc_driver ON driver_locations(driver_id, id);
CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earn','redeem')),
  shipment_id INTEGER REFERENCES shipments(id),
  reward_id INTEGER REFERENCES rewards(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_earn_once ON points_ledger(shipment_id) WHERE type = 'earn';
CREATE INDEX IF NOT EXISTS idx_ledger_user ON points_ledger(user_id);
`);

// Valores iniciales de configuración (el administrador los edita desde el panel)
const DEFAULT_SETTINGS = {
  base_price: 1500, price_per_km: 120, price_per_kg: 200, min_price: 2000,
  volumetric_divisor: 5000, mult_standard: 1, mult_express: 1.5, mult_urgent: 2,
  points_per_100: 1, // puntos que se ganan por cada $100 pagados
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, String(v));

if (db.prepare('SELECT COUNT(*) c FROM rewards').get().c === 0) {
  const ins = db.prepare('INSERT INTO rewards(name,description,points_cost,discount_type,discount_value,featured) VALUES (?,?,?,?,?,?)');
  ins.run('10% de descuento', 'Descuento del 10% en tu próximo envío', 50, 'percent', 10, 1);
  ins.run('$1.000 de descuento', 'Descuento fijo de $1.000 en tu próximo envío', 100, 'fixed', 1000, 1);
  ins.run('25% de descuento', 'Descuento del 25% en tu próximo envío', 200, 'percent', 25, 0);
}

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = Number(r.value);
  return out;
}
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}
const balanceOf = (userId) => db.prepare('SELECT COALESCE(SUM(points),0) b FROM points_ledger WHERE user_id=?').get(userId).b;

module.exports = { db, tx, getSettings, balanceOf, DEFAULT_SETTINGS };
