/* Páginas públicas: inicio, cotización, seguimiento y acceso */
route('/', () => {
  view(`<section class="hero"><div><span class="badge">Entregas rápidas, siempre</span><h1 style="margin-top:.8rem">Tus encomiendas, de puerta a puerta</h1>
    <p class="lead">Cotizá al instante, solicitá tu envío online y seguí a tu repartidor en el mapa en tiempo real. Además, ganás puntos con cada envío para canjear por descuentos.</p>
    <div class="actions"><a class="btn" href="#/enviar">${icon('send')}Solicitar un envío</a><a class="btn alt" href="#/cotizar">${icon('calc')}Cotizar</a></div></div>
    <div class="hero-art"><svg viewBox="0 0 400 300" role="img" aria-label="Repartidor en moto llevando un paquete"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBF6EA"/><stop offset="1" stop-color="#EBDDBE"/></linearGradient></defs>
      <rect width="400" height="300" rx="24" fill="url(#sky)"/><circle cx="300" cy="80" r="46" fill="#F3EAD6" stroke="#B08A5B" stroke-width="3"/>
      <path d="M0 235h400" stroke="#B08A5B" stroke-width="3"/><path d="M20 255h70M120 255h40M200 255h90M320 255h60" stroke="#D8C6A0" stroke-width="4" stroke-linecap="round"/>
      <g class="float"><g stroke="#B08A5B" stroke-width="5" stroke-linecap="round"><path d="M40 150h50M20 172h70M50 194h40"/></g>
      <g transform="translate(100 60) scale(3.2)" fill="none" stroke="#5C432B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${SCOOTER.replace(/<\/?svg[^>]*>/g, '')}</g></g></svg></div></section>
    <section class="section"><div class="grid g3">
      <a class="card link" href="#/cotizar"><div class="ico">${icon('calc')}</div><h3>Cotizaciones</h3><p class="muted">Calculá el precio según distancia, peso, medidas y tipo de envío antes de confirmar.</p></a>
      <a class="card link" href="#/seguimiento"><div class="ico">${icon('map')}</div><h3>Seguimiento en vivo</h3><p class="muted">Ingresá tu número de seguimiento y mirá el recorrido y la ubicación del repartidor.</p></a>
      <a class="card link" href="#/puntos"><div class="ico">${icon('star')}</div><h3>Puntos y recompensas</h3><p class="muted">Sumá puntos con cada envío entregado y canjealos por descuentos.</p></a></div></section>
    <section class="section"><h2>Nuestros servicios</h2><div class="grid g3">
      <div class="card flat"><div class="ico">${icon('box')}</div><h3>Estándar</h3><p class="muted">La opción más económica para tus encomiendas del día a día.</p></div>
      <div class="card flat"><div class="ico">${icon('bolt')}</div><h3>Express</h3><p class="muted">Prioridad en la asignación y en el recorrido para que llegue antes.</p></div>
      <div class="card flat"><div class="ico">${icon('clock')}</div><h3>Urgente</h3><p class="muted">Máxima prioridad para lo que no puede esperar.</p></div></div></section>
    <section class="section"><h2>Cómo funciona</h2><div class="grid g4 steps">
      <div class="card"><h3>Cotizá</h3><p class="muted">Ingresá origen, destino y datos del paquete.</p></div>
      <div class="card"><h3>Solicitá</h3><p class="muted">Confirmá y recibí tu número de seguimiento.</p></div>
      <div class="card"><h3>Retiramos</h3><p class="muted">Un repartidor pasa a buscar tu paquete.</p></div>
      <div class="card"><h3>Seguí y recibí</h3><p class="muted">Mirá el recorrido en el mapa hasta la entrega.</p></div></div></section>
    <section class="section"><div class="card dark" style="display:flex;gap:1.5rem;align-items:center;justify-content:space-between;flex-wrap:wrap"><div><h2>¿Listo para tu primer envío?</h2><p style="margin:0">Creá tu cuenta gratis y empezá a sumar puntos.</p></div><a class="btn alt" href="#/registro">Crear cuenta</a></div></section>`);
});

/* ---------- cotización ---------- */
route('/cotizar', () => {
  view(`<h1>Cotizá tu envío</h1><p class="muted mb">Calculá el precio aproximado antes de solicitar.</p>
    <div class="grid g2" style="align-items:start"><form class="card" id="qf" novalidate><div class="formerr"></div>
      ${addressField('origin', 'Dirección de origen')}${addressField('destination', 'Dirección de destino')}
      <div class="grid g2"><div class="field"><label for="senderName">Nombre y apellido del remitente</label><input id="senderName" name="senderName" maxlength="100" autocomplete="name"></div>
      <div class="field"><label for="receiverName">Nombre y apellido del destinatario</label><input id="receiverName" name="receiverName" maxlength="100"></div></div>
      ${packageFields()}<button class="btn" type="submit">${icon('calc')}Calcular precio</button></form>
      <div id="out"><div class="card flat"><h3>Tu cotización aparecerá acá</h3><p class="muted">Completá el formulario y calculá. El precio final se confirma al solicitar el envío.</p></div></div></div>`);
  const f = $('#qf'); bindAddress(f, 'origin'); bindAddress(f, 'destination');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); clearErrors(f);
    if (!f.reportValidity()) return;
    await busy($('button[type=submit]', f), async () => {
      try {
        const body = { origin: placeOf(f, 'origin'), destination: placeOf(f, 'destination'), ...pkgOf(f) };
        const q = await api('POST', '/quote', body);
        $('#out').innerHTML = quoteCard(q) + `<div class="mt"><button class="btn" id="goShip">${icon('send')}Solicitar este envío</button></div>`;
        $('#goShip').addEventListener('click', () => {
          sessionStorage.setItem('gx_draft', JSON.stringify({ ...body, senderName: f.senderName.value, receiverName: f.receiverName.value }));
          location.hash = '#/enviar';
        });
      } catch (e) { showError(f, e); }
    });
  });
});

/* ---------- seguimiento ---------- */
route('/seguimiento', () => {
  view(`<h1>Seguimiento de envíos</h1><form class="card" id="tf" style="max-width:560px"><div class="formerr"></div><label for="code">Número de seguimiento</label>
    <div class="row"><input id="code" name="code" required maxlength="20" placeholder="Ej.: GXA1B2C3D4E5" autocapitalize="characters" style="text-transform:uppercase"><button class="btn" type="submit">Buscar</button></div></form>`);
  $('#tf').addEventListener('submit', (e) => { e.preventDefault(); const c = $('#code').value.trim().toUpperCase(); if (c) location.hash = '#/seguimiento/' + encodeURIComponent(c); });
});

route('/seguimiento/:code', async ({ code }) => {
  let map, layers = {}, first = true, timer;
  view(`<a href="#/seguimiento" class="small">← Buscar otro envío</a><div id="head" class="mt"></div><div id="stepper" class="card"></div><div id="gps"></div><div id="kpis" class="kpis mb"></div>
    <div id="map" role="region" aria-label="Mapa de seguimiento"></div><div class="grid g2 mt" style="align-items:start"><div class="card"><h3>Historial del envío</h3><ul class="timeline" id="events"></ul></div><div id="details"></div></div>`);
  const draw = (t) => {
    $('#head').innerHTML = `<h1 class="trk">Envío <span class="code">${esc(t.trackingCode)}</span> <span class="badge ${t.status === 'delivered' ? 'done' : 'live'}">${esc(t.statusLabel)}</span></h1>`;
    const idx = STATUSES.indexOf(t.status);
    $('#stepper').innerHTML = `<div class="stepper">${STATUSES.map((s, i) => `<div class="stp ${i < idx || t.status === 'delivered' ? 'done' : ''} ${i === idx && t.status !== 'delivered' ? 'cur' : ''}"><i>${i <= idx ? '✓' : i + 1}</i>${esc(STATUS_LABELS[s])}</div>`).join('')}</div>`;
    $('#gps').innerHTML = t.gps && t.gps.message ? `<div class="gps ${esc(t.gps.state)}" role="status"><span class="dot"></span><span>${esc(t.gps.message)}</span></div>` : '';
    const eta = t.etaMinutes != null ? `${t.etaMinutes} min` : '—', target = t.etaTarget === 'pickup' ? 'Llegada al retiro' : 'Entrega estimada';
    $('#kpis').innerHTML = `<div class="kpi"><small>Estado actual</small><b>${esc(t.statusLabel)}</b></div><div class="kpi"><small>Tiempo estimado (ETA)</small><b>${eta}</b></div>
      <div class="kpi"><small>Distancia restante</small><b>${t.remainingKm != null ? t.remainingKm + ' km' : '—'}</b></div>
      <div class="kpi"><small>${t.status === 'delivered' ? 'Entregado el' : target}</small><b>${t.status === 'delivered' ? fmtDate(t.deliveredAt) : t.etaAt ? fmtDate(t.etaAt) : 'No disponible'}</b></div>`;
    $('#events').innerHTML = [...t.events].reverse().map((e) => `<li><b>${esc(e.label)}</b><br><span class="small muted">${fmtDate(e.at)}${e.note && e.note !== e.label ? ' · ' + esc(e.note) : ''}</span></li>`).join('');
    $('#details').innerHTML = t.senderName ? `<div class="card"><h3>Detalle</h3><p class="small"><b>Remitente:</b> ${esc(t.senderName)}<br><b>Origen:</b> ${esc(t.originAddress)}<br><b>Destinatario:</b> ${esc(t.receiverName)}<br><b>Destino:</b> ${esc(t.destinationAddress)}<br><b>Servicio:</b> ${esc(t.serviceLabel)} · <b>Total:</b> ${money(t.priceFinal)}</p></div>`
      : `<div class="card flat"><h3>Privacidad</h3><p class="small muted">Por seguridad, los nombres y direcciones exactas solo se muestran al titular del envío.</p></div>`;
    if (t.etaNote) $('#details').insertAdjacentHTML('afterbegin', `<div class="info">${esc(t.etaNote)}</div>`);
    // mapa
    if (!map) { map = makeMap('map'); layers.o = L.marker([t.origin.lat, t.origin.lng], { icon: pinIcon('o', 'A') }).addTo(map).bindPopup('Origen'); layers.d = L.marker([t.destination.lat, t.destination.lng], { icon: pinIcon('d', 'B') }).addTo(map).bindPopup('Destino'); }
    const line = t.route ? t.route.map(([lng, lat]) => [lat, lng]) : [[t.origin.lat, t.origin.lng], [t.destination.lat, t.destination.lng]];
    if (layers.r) layers.r.remove();
    layers.r = L.polyline(line, { color: '#7A5C3E', weight: 5, opacity: .85, dashArray: t.route ? null : '8 10' }).addTo(map);
    if (!t.route && first) toast('No pudimos obtener el recorrido por calles. Se muestra una línea recta de referencia.');
    if (layers.v) { layers.v.remove(); layers.v = null; }
    if (t.driverLocation) {
      const p = [t.driverLocation.lat, t.driverLocation.lng];
      layers.v = L.marker(p, { icon: pinIcon(t.driverLocation.stale ? 'stale' : '', '🛵') }).addTo(map).bindPopup(t.driverLocation.stale ? 'Última ubicación conocida' : 'Repartidor (en vivo)<br>' + fmtDate(t.driverLocation.recordedAt));
    }
    if (first) { map.fitBounds(L.featureGroup([layers.o, layers.d, layers.r, ...(layers.v ? [layers.v] : [])]).getBounds().pad(.2)); first = false; }
    setTimeout(() => map.invalidateSize(), 50);
  };
  const load = async () => {
    try { draw((await api('GET', '/track/' + encodeURIComponent(code))).tracking); }
    catch (e) { clearInterval(timer); view(`<div class="card"><h2>${esc(e.message)}</h2><p>Revisá el número e intentá de nuevo.</p><a class="btn" href="#/seguimiento">Buscar otro envío</a></div>`); }
  };
  await load();
  timer = setInterval(load, 10000); // se actualiza cada 10 segundos con lo último que informó el repartidor
  onLeave(() => { clearInterval(timer); if (map) map.remove(); });
});

/* ---------- acceso ---------- */
const authPage = (title, body) => view(`<div class="card" style="max-width:480px;margin:1rem auto"><h1 style="font-size:1.8rem">${title}</h1>${body}</div>`);
route('/login', () => {
  authPage('Ingresar', `<form id="f" novalidate><div class="formerr"></div><div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email"></div>
    <div class="field"><label for="password">Contraseña</label><input id="password" name="password" type="password" required autocomplete="current-password"></div>
    <button class="btn" style="width:100%" type="submit">Ingresar</button></form><p class="small mt"><a href="#/recuperar">Olvidé mi contraseña</a> · <a href="#/registro">Crear cuenta</a></p>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; clearErrors(f);
    await busy($('button', f), async () => {
      try {
        state.user = (await api('POST', '/auth/login', formObj(f))).user; toast('¡Bienvenido/a, ' + state.user.name.split(' ')[0] + '!');
        const next = sessionStorage.getItem('gx_next'); sessionStorage.removeItem('gx_next');
        location.hash = next || (state.user.role === 'admin' ? '#/admin' : state.user.role === 'driver' ? '#/repartidor' : '#/');
      } catch (er) { showError(f, er); }
    });
  });
});
route('/registro', () => {
  authPage('Crear cuenta', `<form id="f" novalidate><div class="formerr"></div><div class="field"><label for="name">Nombre y apellido</label><input id="name" name="name" required minlength="2" maxlength="100" autocomplete="name"></div>
    <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email"></div>
    <div class="field"><label for="phone">Teléfono (opcional)</label><input id="phone" name="phone" type="tel" maxlength="30" autocomplete="tel"></div>
    <div class="field"><label for="password">Contraseña</label><input id="password" name="password" type="password" required minlength="8" autocomplete="new-password"><small class="muted">Mínimo 8 caracteres, con letras y números.</small></div>
    <button class="btn" style="width:100%" type="submit">Crear cuenta</button></form><p class="small mt">¿Ya tenés cuenta? <a href="#/login">Ingresá</a></p>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; clearErrors(f);
    await busy($('button', f), async () => { try { state.user = (await api('POST', '/auth/register', formObj(f))).user; toast('¡Cuenta creada!'); location.hash = '#/'; } catch (er) { showError(f, er); } });
  });
});
route('/recuperar', () => {
  authPage('Recuperar contraseña', `<form id="f" novalidate><div class="formerr"></div><p class="muted">Ingresá tu email y te enviaremos un enlace para crear una contraseña nueva.</p><div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required></div><button class="btn" style="width:100%" type="submit">Enviar enlace</button></form><p class="small mt"><a href="#/login">Volver</a></p>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; clearErrors(f);
    await busy($('button', f), async () => { try { const r = await api('POST', '/auth/forgot', formObj(f)); f.innerHTML = `<div class="ok">${esc(r.message)}</div>`; } catch (er) { showError(f, er); } });
  });
});
route('/reset', ({ token }) => {
  authPage('Nueva contraseña', `<form id="f" novalidate><div class="formerr"></div><div class="field"><label for="password">Nueva contraseña</label><input id="password" name="password" type="password" required minlength="8" autocomplete="new-password"></div><button class="btn" style="width:100%" type="submit">Guardar contraseña</button></form>`);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; clearErrors(f);
    await busy($('button', f), async () => { try { await api('POST', '/auth/reset', { token, password: f.password.value }); toast('Contraseña actualizada. Ya podés ingresar.'); location.hash = '#/login'; } catch (er) { showError(f, er); } });
  });
});
