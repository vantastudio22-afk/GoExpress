// Prueba de punta a punta: levanta el servidor con una base de datos temporal y recorre todas las funciones.
process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.GPS_STALE_SECONDS = '1';
process.env.OSRM_URL = 'http://127.0.0.1:9';        // simula servicio de rutas caído (se prueba la rutina de contingencia)
process.env.NOMINATIM_URL = 'http://127.0.0.1:9';   // simula geocodificador caído
const assert = require('assert');
const { createApp } = require('../server');
const { db } = require('../db');
const { hashPassword } = require('../lib');

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✔', name); } catch (e) { failed++; console.log('  ✘', name, '\n     ', e.message); } }

(async () => {
  const server = createApp();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;

  // cliente HTTP con "cookie jar" por sesión
  const session = () => {
    let cookie = '';
    return async (method, path, body, headers = {}) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-GX': '1', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      const sc = res.headers.getSetCookie();
      if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
      let data = null; try { data = await res.json(); } catch {}
      return { status: res.status, data };
    };
  };
  const anon = session(), alice = session(), bob = session(), admin = session(), drv = session(), drv2 = session();
  const A = { lat: -34.0981, lng: -59.0286 }, B = { lat: -34.1700, lng: -58.9600 };
  const pkg = (o = {}) => ({ origin: { address: 'Calle Falsa 123, Zárate', ...A }, destination: { address: 'Av. Siempre Viva 742, Campana', ...B }, weightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10, service: 'standard', ...o });

  console.log('\nFrontend y seguridad');
  await t('sirve la página de inicio', async () => { const r = await fetch(base + '/'); assert.equal(r.status, 200); assert.match(await r.text(), /GoExpress/); });
  await t('bloquea acceso fuera de la carpeta del frontend', async () => { const r = await fetch(base + '/..%2f..%2fbackend%2fdb.js'); assert.ok([403, 404].includes(r.status)); });
  await t('rechaza POST sin encabezado anti-CSRF', async () => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(r.status, 403); });
  await t('envía cabeceras de seguridad', async () => { const r = await fetch(base + '/'); assert.ok(r.headers.get('content-security-policy')); });

  console.log('\nRegistro, sesión y validación');
  await t('rechaza email inválido y contraseña débil', async () => {
    assert.equal((await anon('POST', '/api/auth/register', { name: 'Ana Pérez', email: 'no-es-email', password: 'abc12345' })).status, 422);
    assert.equal((await anon('POST', '/api/auth/register', { name: 'Ana Pérez', email: 'ana@test.com', password: 'corta' })).status, 422);
    assert.equal((await anon('POST', '/api/auth/register', { name: 'Ana Pérez', email: 'ana@test.com', password: 'soloLetrasaaa' })).status, 422);
  });
  await t('registra usuarios y abre sesión', async () => {
    const r = await alice('POST', '/api/auth/register', { name: 'Ana Pérez', email: 'ana@test.com', password: 'Clave1234' });
    assert.equal(r.status, 201); assert.equal(r.data.user.role, 'client');
    assert.equal((await bob('POST', '/api/auth/register', { name: 'Beto Gómez', email: 'beto@test.com', password: 'Clave1234' })).status, 201);
    assert.equal((await alice('GET', '/api/auth/me')).data.user.email, 'ana@test.com');
  });
  await t('no permite email repetido', async () => assert.equal((await anon('POST', '/api/auth/register', { name: 'Otra', email: 'ana@test.com', password: 'Clave1234' })).status, 409));
  await t('rechaza credenciales incorrectas con mensaje genérico', async () => {
    const r = await anon('POST', '/api/auth/login', { email: 'ana@test.com', password: 'incorrecta1' });
    assert.equal(r.status, 401);
    assert.equal((await anon('POST', '/api/auth/login', { email: 'nadie@test.com', password: 'incorrecta1' })).data.error, r.data.error);
  });
  await t('no se puede escalar el rol al registrarse', async () => {
    const s = session(); const r = await s('POST', '/api/auth/register', { name: 'Mal Intencionado', email: 'mal@test.com', password: 'Clave1234', role: 'admin' });
    assert.equal(r.data.user.role, 'client');
  });
  await t('recuperación de contraseña por enlace de un solo uso', async () => {
    let captured = ''; const orig = console.log; console.log = (...a) => { captured += a.join(' '); };
    const f = await anon('POST', '/api/auth/forgot', { email: 'beto@test.com' });
    console.log = orig; assert.equal(f.status, 200);
    const token = (captured.match(/token=([a-f0-9]+)/) || [])[1]; assert.ok(token, 'no se generó el enlace');
    assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'NuevaClave99' })).status, 200);
    assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'OtraClave99' })).status, 400);
    assert.equal((await bob('POST', '/api/auth/login', { email: 'beto@test.com', password: 'NuevaClave99' })).status, 200);
    const unknown = await anon('POST', '/api/auth/forgot', { email: 'noexiste@test.com' }); assert.equal(unknown.data.message, f.data.message);
  });
  await t('perfil y direcciones guardadas', async () => {
    assert.equal((await alice('PUT', '/api/me', { name: 'Ana P.', phone: '3487123456' })).status, 200);
    const a = await alice('POST', '/api/me/addresses', { label: 'Casa', address: 'Calle Falsa 123, Zárate', ...A }); assert.equal(a.status, 201);
    assert.equal((await alice('GET', '/api/me/addresses')).data.addresses.length, 1);
    assert.equal((await bob('GET', '/api/me/addresses')).data.addresses.length, 0);
    assert.equal((await anon('GET', '/api/me/addresses')).status, 401);
  });

  console.log('\nCotizaciones');
  let std, exp, urg;
  await t('calcula precio por distancia, peso, dimensiones y servicio', async () => {
    std = (await anon('POST', '/api/quote', pkg())).data; exp = (await anon('POST', '/api/quote', pkg({ service: 'express' }))).data; urg = (await anon('POST', '/api/quote', pkg({ service: 'urgent' }))).data;
    assert.ok(std.price.total > 0 && exp.price.total > std.price.total && urg.price.total > exp.price.total);
    const heavy = (await anon('POST', '/api/quote', pkg({ weightKg: 20 }))).data; assert.ok(heavy.price.total > std.price.total);
    const bulky = (await anon('POST', '/api/quote', pkg({ lengthCm: 100, widthCm: 80, heightCm: 60 }))).data; assert.ok(bulky.price.billableKg > 2, 'debe usar peso volumétrico');
  });
  await t('informa cuando la distancia es una estimación (rutas no disponibles)', async () => { assert.equal(std.distanceSource, 'estimate'); assert.ok(std.note); });
  await t('valida peso, medidas y tipo de envío', async () => {
    assert.equal((await anon('POST', '/api/quote', pkg({ weightKg: 0 }))).status, 422);
    assert.equal((await anon('POST', '/api/quote', pkg({ weightKg: 500 }))).status, 422);
    assert.equal((await anon('POST', '/api/quote', pkg({ service: 'volando' }))).status, 422);
    assert.equal((await anon('POST', '/api/quote', pkg({ heightCm: 'abc' }))).status, 422);
  });
  await t('sin coordenadas y sin geocodificador responde un error claro (no inventa ubicaciones)', async () => {
    const r = await anon('POST', '/api/quote', pkg({ origin: { address: 'Calle Sin Coordenadas 1' } })); assert.equal(r.status, 503);
  });

  console.log('\nSolicitud de envíos');
  let ship;
  await t('exige sesión para solicitar un envío', async () => assert.equal((await anon('POST', '/api/shipments', { ...pkg(), senderName: 'A', receiverName: 'B' })).status, 401));
  await t('crea el envío con número de seguimiento único y precio recalculado en el servidor', async () => {
    const r = await alice('POST', '/api/shipments', { ...pkg(), senderName: 'Ana Pérez', receiverName: 'Carlos Ruiz', priceFinal: 1, price_final: 1, status: 'delivered', driver_id: 1 });
    assert.equal(r.status, 201); ship = r.data.shipment;
    assert.match(ship.trackingCode, /^GX[A-Z0-9]{10}$/); assert.equal(ship.status, 'received'); assert.equal(ship.priceFinal, std.price.total);
  });
  await t('guarda historial de estados', async () => { const tr = (await anon('GET', `/api/track/${ship.trackingCode}`)).data.tracking; assert.equal(tr.events[0].status, 'received'); });
  await t('lista los envíos del cliente y no los de otros', async () => {
    assert.equal((await alice('GET', '/api/shipments/mine')).data.shipments.length, 1);
    assert.equal((await bob('GET', '/api/shipments/mine')).data.shipments.length, 0);
  });

  console.log('\nPermisos');
  await t('el cliente no puede cambiar estados, tarifas ni puntos', async () => {
    assert.equal((await alice('PATCH', `/api/admin/shipments/${ship.id}/status`, { status: 'delivered' })).status, 403);
    assert.equal((await alice('PUT', '/api/admin/settings', { base_price: 1 })).status, 403);
    assert.equal((await alice('POST', '/api/admin/points/adjust', { userId: 2, points: 9999, note: 'x' })).status, 403);
    assert.equal((await alice('POST', `/api/driver/shipments/${ship.id}/status`, { status: 'delivered' })).status, 403);
    assert.equal((await anon('GET', '/api/admin/stats')).status, 401);
  });
  // crear administrador y repartidores (el administrador inicial se crea con el script create-admin)
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES ('Admin','admin@test.com',?,'admin')").run(await hashPassword('Admin12345'));
  await t('el administrador inicia sesión y crea repartidores', async () => {
    assert.equal((await admin('POST', '/api/auth/login', { email: 'admin@test.com', password: 'Admin12345' })).data.user.role, 'admin');
    assert.equal((await admin('POST', '/api/admin/drivers', { name: 'Repartidor Uno', email: 'r1@test.com', password: 'Repar1234' })).status, 201);
    assert.equal((await admin('POST', '/api/admin/drivers', { name: 'Repartidor Dos', email: 'r2@test.com', password: 'Repar1234' })).status, 201);
    assert.equal((await drv('POST', '/api/auth/login', { email: 'r1@test.com', password: 'Repar1234' })).data.user.role, 'driver');
    await drv2('POST', '/api/auth/login', { email: 'r2@test.com', password: 'Repar1234' });
  });

  console.log('\nRepartidor, GPS y seguimiento');
  let driverId;
  await t('el administrador asigna el repartidor y el estado pasa a "Retiro pendiente"', async () => {
    driverId = (await admin('GET', '/api/admin/drivers')).data.drivers.find((d) => d.email === 'r1@test.com').id;
    const r = await admin('POST', `/api/admin/shipments/${ship.id}/assign`, { driverId }); assert.equal(r.status, 200); assert.equal(r.data.shipment.status, 'pickup_pending');
  });
  await t('sin GPS no se simula ubicación: se informa el estado', async () => {
    const tr = (await anon('GET', `/api/track/${ship.trackingCode}`)).data.tracking; assert.equal(tr.driverLocation, null); assert.equal(tr.gps.state, 'nosignal');
  });
  await t('el repartidor ve solo sus pedidos y no puede tocar los de otro', async () => {
    assert.equal((await drv('GET', '/api/driver/shipments')).data.shipments.length, 1);
    assert.equal((await drv2('GET', '/api/driver/shipments')).data.shipments.length, 0);
    assert.equal((await drv2('POST', `/api/driver/shipments/${ship.id}/status`, { status: 'picked_up' })).status, 403);
  });
  await t('valida la ubicación GPS que envía el repartidor', async () => {
    assert.equal((await drv('POST', '/api/driver/location', { lat: 999, lng: 0 })).status, 422);
    assert.equal((await drv('POST', '/api/driver/location', { lat: 'x', lng: 0 })).status, 422);
    assert.equal((await alice('POST', '/api/driver/location', { lat: 1, lng: 1 })).status, 403);
  });
  await t('el repartidor retira el paquete y comparte su ubicación; el cliente la ve con distancia restante', async () => {
    assert.equal((await drv('POST', `/api/driver/shipments/${ship.id}/status`, { status: 'picked_up' })).status, 200);
    assert.equal((await drv('POST', '/api/driver/location', { lat: -34.12, lng: -59.0, accuracy: 12 })).status, 200);
    const tr = (await alice('GET', `/api/track/${ship.trackingCode}`)).data.tracking;
    assert.equal(tr.gps.state, 'live'); assert.equal(tr.driverLocation.lat, -34.12); assert.ok(tr.remainingKm > 0);
    assert.equal(tr.etaMinutes, null, 'no debe inventar un ETA si el servicio de rutas no responde'); assert.ok(tr.etaNote);
  });
  await t('si se pierde la señal GPS se muestra la última ubicación conocida', async () => {
    await new Promise((ok) => setTimeout(ok, 1500));
    const tr = (await anon('GET', `/api/track/${ship.trackingCode}`)).data.tracking;
    assert.equal(tr.gps.state, 'stale'); assert.equal(tr.driverLocation.stale, true); assert.match(tr.gps.message, /Última ubicación conocida/);
  });
  await t('el seguimiento público oculta nombres y direcciones exactas', async () => {
    const pub = (await anon('GET', `/api/track/${ship.trackingCode}`)).data.tracking, own = (await alice('GET', `/api/track/${ship.trackingCode}`)).data.tracking;
    assert.equal(pub.senderName, undefined); assert.equal(pub.originAddress, undefined); assert.equal(own.senderName, 'Ana Pérez');
    assert.equal((await anon('GET', '/api/track/GXNOEXISTE1')).status, 404);
  });
  await t('el repartidor solo puede avanzar estados', async () => {
    assert.equal((await drv('POST', `/api/driver/shipments/${ship.id}/status`, { status: 'in_transit' })).status, 200);
    assert.equal((await drv('POST', `/api/driver/shipments/${ship.id}/status`, { status: 'picked_up' })).status, 422);
    assert.equal((await drv('POST', `/api/driver/shipments/${ship.id}/status`, { status: 'inventado' })).status, 422);
  });

  console.log('\nPuntos y recompensas');
  await t('no suma puntos hasta que el envío esté entregado', async () => assert.equal((await alice('GET', '/api/points')).data.balance, 0));
  await t('al entregar suma puntos automáticamente, una sola vez', async () => {
    assert.equal((await drv('POST', `/api/driver/shipments/${ship.id}/status`, { status: 'in_distribution' })).status, 200);
    assert.equal((await drv('POST', `/api/driver/shipments/${ship.id}/status`, { status: 'delivered' })).status, 200);
    const expected = Math.floor(ship.priceFinal / 100);
    assert.equal((await alice('GET', '/api/points')).data.balance, expected);
    await admin('PATCH', `/api/admin/shipments/${ship.id}/status`, { status: 'in_distribution' });
    await admin('PATCH', `/api/admin/shipments/${ship.id}/status`, { status: 'delivered' });
    const p = (await alice('GET', '/api/points')).data; assert.equal(p.balance, expected); assert.equal(p.ledger.filter((l) => l.type === 'earn').length, 1);
  });
  await t('muestra historial y catálogo con los puntos necesarios', async () => {
    const p = (await alice('GET', '/api/points')).data; assert.ok(p.rewards.length >= 1 && p.rewards[0].pointsCost > 0); assert.equal(p.ledger[0].type, 'earn');
  });
  await t('no permite canjear sin puntos suficientes', async () => {
    const rw = (await alice('GET', '/api/points')).data.rewards[0]; const r = await alice('POST', '/api/points/redeem', { rewardId: rw.id });
    assert.equal(r.status, 422); assert.match(r.data.error, /Te faltan/);
  });
  await t('el cliente no puede darse puntos a sí mismo, el administrador sí puede ajustarlos', async () => {
    const uid = (await alice('GET', '/api/auth/me')).data.user.id;
    assert.equal((await alice('POST', '/api/admin/points/adjust', { userId: uid, points: 500, note: 'x' })).status, 403);
    const r = await admin('POST', '/api/admin/points/adjust', { userId: uid, points: 100, note: 'Bonificación de prueba' }); assert.equal(r.status, 200);
  });
  let coupon, before;
  await t('canjea una recompensa: descuenta puntos y entrega un cupón', async () => {
    const p = (await alice('GET', '/api/points')).data; before = p.balance; const rw = p.rewards.find((x) => x.discountType === 'percent');
    const r = await alice('POST', '/api/points/redeem', { rewardId: rw.id }); assert.equal(r.status, 201); coupon = r.data.coupon;
    assert.equal(r.data.balance, before - rw.pointsCost); assert.equal((await alice('GET', '/api/points')).data.balance, before - rw.pointsCost);
  });
  let ship2;
  await t('el cupón descuenta en un futuro envío y solo se usa una vez', async () => {
    const r = await alice('POST', '/api/shipments', { ...pkg(), senderName: 'Ana', receiverName: 'Luis', couponId: coupon.id }); assert.equal(r.status, 201); ship2 = r.data.shipment;
    assert.equal(ship2.discount, Math.round(std.price.total * coupon.discountValue / 100)); assert.equal(ship2.priceFinal, std.price.total - ship2.discount);
    assert.equal((await alice('POST', '/api/shipments', { ...pkg(), senderName: 'Ana', receiverName: 'Luis', couponId: coupon.id })).status, 422);
  });
  await t('un cupón ajeno no se puede usar', async () => {
    const c2 = (await alice('POST', '/api/admin/points/adjust', {})).status; assert.equal(c2, 403);
    assert.equal((await bob('POST', '/api/shipments', { ...pkg(), senderName: 'Beto', receiverName: 'X', couponId: coupon.id })).status, 422);
  });

  console.log('\nPanel de administración');
  await t('estadísticas, clientes y envíos', async () => {
    const s = (await admin('GET', '/api/admin/stats')).data; assert.equal(s.totals.shipments, 2); assert.ok(s.totals.revenue > 0);
    assert.ok((await admin('GET', '/api/admin/clients')).data.clients.length >= 2);
    assert.equal((await admin('GET', '/api/admin/shipments?status=received')).data.shipments.length, 1);
    assert.equal((await admin('GET', `/api/admin/shipments?q=${ship.trackingCode}`)).data.shipments.length, 1);
  });
  await t('consulta la ubicación de los repartidores', async () => {
    const d = (await admin('GET', '/api/admin/drivers')).data.drivers.find((x) => x.id === driverId); assert.equal(d.location.lat, -34.12);
  });
  await t('cambia tarifas y el precio cotizado cambia', async () => {
    assert.equal((await admin('PUT', '/api/admin/settings', { base_price: 5000 })).status, 200);
    const q2 = (await anon('POST', '/api/quote', pkg())).data; assert.ok(q2.price.total > std.price.total);
    assert.equal((await admin('PUT', '/api/admin/settings', { base_price: -5 })).status, 422);
  });
  await t('gestiona recompensas', async () => {
    const c = await admin('POST', '/api/admin/rewards', { name: 'Envío con 50% off', pointsCost: 400, discountType: 'percent', discountValue: 50, featured: true }); assert.equal(c.status, 201);
    assert.equal((await admin('PUT', `/api/admin/rewards/${c.data.id}`, { name: 'Envío con 50% off', pointsCost: 350, discountType: 'percent', discountValue: 50, active: false })).status, 200);
    assert.equal((await alice('GET', '/api/points')).data.rewards.some((r) => r.name === 'Envío con 50% off'), false, 'una recompensa inactiva no debe aparecer');
    assert.equal((await admin('POST', '/api/admin/rewards', { name: 'x', pointsCost: -1, discountType: 'percent', discountValue: 500 })).status, 422);
  });
  await t('desactiva clientes', async () => {
    const bid = (await bob('GET', '/api/auth/me')).data.user.id; assert.equal((await admin('PATCH', `/api/admin/users/${bid}`, { active: false })).status, 200);
    assert.equal((await bob('GET', '/api/auth/me')).data.user, null);
  });

  server.close();
  console.log(`\n${passed} pruebas correctas, ${failed} con errores\n`);
  process.exit(failed ? 1 : 0);
})();
