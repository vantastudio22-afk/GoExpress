/* Páginas del cliente y del repartidor: solicitud de envío, puntos, perfil y entregas */
const couponLabel = (c) => `${c.code} · ${c.discountType === 'percent' ? c.discountValue + '% de descuento' : money(c.discountValue) + ' de descuento'}`;
const couponDiscount = (total, c) => (!c ? 0 : Math.min(total, Math.round(c.discountType === 'percent' ? (total * Math.min(c.discountValue, 100)) / 100 : c.discountValue)));

route('/enviar', async () => {
  const [{ addresses }, pts] = await Promise.all([api('GET', '/me/addresses'), api('GET', '/points')]);
  const coupons = pts.coupons.filter((c) => c.status === 'available');
  const draft = JSON.parse(sessionStorage.getItem('gx_draft') || 'null') || {};
  view(`<h1>Solicitar un envío</h1><p class="muted mb">Completá los datos, consultá el precio y confirmá tu solicitud.</p>
    <div class="grid g2" style="align-items:start"><form class="card" id="sf" novalidate><div class="formerr"></div>
      <div class="grid g2"><div class="field"><label for="senderName">Remitente (nombre y apellido)</label><input id="senderName" name="senderName" required maxlength="100" value="${esc(draft.senderName || state.user.name)}"></div>
      <div class="field"><label for="receiverName">Destinatario (nombre y apellido)</label><input id="receiverName" name="receiverName" required maxlength="100" value="${esc(draft.receiverName || '')}"></div></div>
      ${addressField('origin', 'Domicilio de retiro', addresses)}${addressField('destination', 'Domicilio de entrega', addresses)}${packageFields(draft)}
      ${coupons.length ? `<div class="field"><label for="couponId">Cupón de descuento (opcional)</label><select id="couponId" name="couponId"><option value="">Sin cupón</option>${coupons.map((c) => `<option value="${c.id}">${esc(couponLabel(c))}</option>`).join('')}</select></div>` : ''}
      <div class="row"><button class="btn alt" type="button" id="qbtn">${icon('calc')}Consultar precio</button><button class="btn" type="submit" id="cbtn" disabled>${icon('check')}Confirmar solicitud</button></div></form>
      <div id="out"><div class="card flat"><h3>Precio del envío</h3><p class="muted">Consultá el precio para poder confirmar la solicitud.</p></div></div></div>`);
  const f = $('#sf');
  const stale = () => { $('#cbtn').disabled = true; };
  const a1 = bindAddress(f, 'origin', addresses, stale), a2 = bindAddress(f, 'destination', addresses, stale);
  if (draft.origin) a1.set(draft.origin.lat, draft.origin.lng, draft.origin.address);
  if (draft.destination) a2.set(draft.destination.lat, draft.destination.lng, draft.destination.address);
  f.addEventListener('input', stale); f.addEventListener('change', stale);
  const body = () => ({ origin: placeOf(f, 'origin'), destination: placeOf(f, 'destination'), ...pkgOf(f), senderName: f.senderName.value, receiverName: f.receiverName.value, couponId: f.couponId && f.couponId.value ? Number(f.couponId.value) : null });
  $('#qbtn').addEventListener('click', async (ev) => {
    clearErrors(f); if (!f.reportValidity()) return;
    await busy(ev.currentTarget, async () => {
      try {
        const q = await api('POST', '/quote', body());
        const c = coupons.find((x) => String(x.id) === (f.couponId ? f.couponId.value : '')), d = couponDiscount(q.price.total, c);
        $('#out').innerHTML = quoteCard(q) + (d ? `<div class="ok">Cupón aplicado: − ${money(d)}<br><b>Total a pagar: ${money(q.price.total - d)}</b></div>` : '');
        $('#cbtn').disabled = false;
      } catch (e) { showError(f, e); }
    });
  });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); clearErrors(f);
    await busy($('#cbtn'), async () => {
      try {
        const { shipment: s } = await api('POST', '/shipments', body()); sessionStorage.removeItem('gx_draft');
        view(`<div class="card" style="max-width:620px;margin:1rem auto;text-align:center"><div class="ico" style="margin:0 auto 1rem">${icon('check')}</div><h1 style="font-size:1.8rem">¡Solicitud recibida!</h1>
          <p>Guardá tu número de seguimiento:</p><p class="trk"><span class="code">${esc(s.trackingCode)}</span></p>
          <p class="muted">Total: <b>${money(s.priceFinal)}</b>${s.discount ? ` (descuento de ${money(s.discount)} aplicado)` : ''}<br>Vas a sumar puntos cuando el envío se entregue.</p>
          <div class="actions" style="display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap"><a class="btn" href="#/seguimiento/${encodeURIComponent(s.trackingCode)}">${icon('map')}Ver seguimiento</a><a class="btn alt" href="#/enviar">Nuevo envío</a></div></div>`);
      } catch (e) { showError(f, e); }
    });
  });
}, { auth: true });

/* ---------- puntos ---------- */
route('/puntos', async () => {
  const p = await api('GET', '/points');
  const reward = (r) => { const miss = Math.max(0, r.pointsCost - p.balance), pct = Math.min(100, Math.round((p.balance / r.pointsCost) * 100));
    return `<div class="card flat"><div class="ico">${icon('gift')}</div><h3>${esc(r.name)}</h3><p class="muted small">${esc(r.description)}</p><b>${r.pointsCost} puntos</b><div class="prog"><i style="width:${pct}%"></i></div>
      <p class="small muted">${miss ? `Te faltan ${miss} puntos` : '¡Ya podés canjearla!'}</p><button class="btn sm" data-redeem="${r.id}" ${miss ? 'disabled' : ''}>Canjear</button></div>`; };
  view(`<h1>Puntos y recompensas</h1>
    <div class="card dark balance mb"><div><p style="margin:0">Tu saldo disponible</p><div class="big">${p.balance} <small style="font-size:1.1rem">puntos</small></div></div><div class="small">Ganados: <b>${p.earned}</b><br>Utilizados: <b>${p.used}</b></div><a class="btn alt" href="#/enviar">Enviar y sumar puntos</a></div>
    ${p.rewards.some((r) => r.featured) ? `<h2>Recompensas destacadas</h2><div class="grid g3 mb">${p.rewards.filter((r) => r.featured).map(reward).join('')}</div>` : ''}
    <h2>Catálogo de recompensas</h2>${p.rewards.length ? `<div class="grid g3 mb">${p.rewards.map(reward).join('')}</div>` : '<p class="muted">Todavía no hay recompensas disponibles.</p>'}
    <div class="grid g2" style="align-items:start"><div class="card"><h3>Mis cupones</h3>${p.coupons.length ? `<ul style="padding-left:1.1rem">${p.coupons.map((c) => `<li><span class="code">${esc(c.code)}</span> ${c.discountType === 'percent' ? c.discountValue + '%' : money(c.discountValue)} · ${c.status === 'available' ? '<span class="pos">Disponible</span>' : '<span class="muted">Usado</span>'}</li>`).join('')}</ul><p class="small muted">Elegí tu cupón al solicitar un envío.</p>` : '<p class="muted">Todavía no canjeaste recompensas.</p>'}</div>
      <div class="card"><h3>Historial de puntos</h3>${p.ledger.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>Fecha</th><th>Detalle</th><th>Puntos</th></tr></thead><tbody>${p.ledger.map((l) => `<tr><td>${fmtDate(l.at)}</td><td>${esc(l.note || '')}</td><td class="${l.points > 0 ? 'pos' : 'neg'}">${l.points > 0 ? '+' : ''}${l.points}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Todavía no tenés movimientos. Se suman puntos cuando se entrega un envío.</p>'}</div></div>`);
  $$('[data-redeem]').forEach((b) => b.addEventListener('click', async () => {
    const r = p.rewards.find((x) => String(x.id) === b.dataset.redeem);
    if (!(await confirmDialog('Confirmar canje', `Vas a canjear ${r.pointsCost} puntos por "${r.name}". Se descontarán de tu saldo y recibirás un cupón para usar en un próximo envío.`, 'Canjear'))) return;
    try { const res = await api('POST', '/points/redeem', { rewardId: r.id }); toast(`¡Listo! Tu cupón es ${res.coupon.code}`); navigate(); } catch (e) { toast(e.message, 'bad'); }
  }));
}, { auth: true });

/* ---------- perfil ---------- */
route('/perfil', async () => {
  const [{ addresses }, { shipments }, pts] = await Promise.all([api('GET', '/me/addresses'), api('GET', '/shipments/mine'), api('GET', '/points')]);
  const tabs = { datos: 'Datos personales', dir: 'Direcciones', envios: 'Mis envíos', pts: 'Mis puntos' };
  const panels = {
    datos: () => `<div class="grid g2" style="align-items:start"><form class="card" id="pf" novalidate><h3>Mis datos</h3><div class="formerr"></div><div class="field"><label>Email</label><input value="${esc(state.user.email)}" disabled></div>
      <div class="field"><label for="name">Nombre y apellido</label><input id="name" name="name" required minlength="2" maxlength="100" value="${esc(state.user.name)}"></div><div class="field"><label for="phone">Teléfono</label><input id="phone" name="phone" type="tel" maxlength="30" value="${esc(state.user.phone || '')}"></div><button class="btn" type="submit">Guardar</button></form>
      <form class="card" id="pwf" novalidate><h3>Cambiar contraseña</h3><div class="formerr"></div><div class="field"><label for="current">Contraseña actual</label><input id="current" name="current" type="password" required autocomplete="current-password"></div><div class="field"><label for="password">Contraseña nueva</label><input id="password" name="password" type="password" required minlength="8" autocomplete="new-password"></div><button class="btn" type="submit">Cambiar</button></form></div>`,
    dir: () => `<div class="grid g2" style="align-items:start"><form class="card" id="af" novalidate><h3>Agregar dirección</h3><div class="formerr"></div><div class="field"><label for="label">Nombre (ej.: Casa, Trabajo)</label><input id="label" name="label" required maxlength="40"></div>${addressField('address', 'Dirección')}<button class="btn" type="submit">Guardar dirección</button></form>
      <div class="card"><h3>Direcciones guardadas</h3>${addresses.length ? `<ul style="list-style:none;padding:0">${addresses.map((a) => `<li style="display:flex;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line);padding:.5rem 0"><span><b>${esc(a.label)}</b><br><span class="small muted">${esc(a.address)}</span></span><button class="btn alt sm" data-del="${a.id}">Eliminar</button></li>`).join('')}</ul>` : '<p class="muted">No tenés direcciones guardadas.</p>'}</div></div>`,
    envios: () => `<div class="card"><h3>Historial de envíos</h3>${shipments.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>Seguimiento</th><th>Fecha</th><th>Destinatario</th><th>Estado</th><th>Total</th></tr></thead><tbody>${shipments.map((s) => `<tr><td><a href="#/seguimiento/${esc(s.trackingCode)}"><span class="code">${esc(s.trackingCode)}</span></a></td><td>${fmtDate(s.createdAt)}</td><td>${esc(s.receiverName)}</td><td><span class="badge ${s.status === 'delivered' ? 'done' : ''}">${esc(s.statusLabel)}</span></td><td>${money(s.priceFinal)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Todavía no solicitaste envíos.</p>'}</div>`,
    pts: () => `<div class="card"><h3>Historial de puntos</h3><p>Saldo actual: <b>${pts.balance} puntos</b> · <a href="#/puntos">Ver recompensas</a></p>${pts.ledger.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>Fecha</th><th>Detalle</th><th>Puntos</th></tr></thead><tbody>${pts.ledger.map((l) => `<tr><td>${fmtDate(l.at)}</td><td>${esc(l.note || '')}</td><td class="${l.points > 0 ? 'pos' : 'neg'}">${l.points > 0 ? '+' : ''}${l.points}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin movimientos todavía.</p>'}</div>`,
  };
  const show = (tab) => {
    view(`<h1>Mi cuenta</h1><div class="tabs" role="tablist">${Object.entries(tabs).map(([k, n]) => `<button role="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>${panels[tab]()}`);
    $$('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
    const pf = $('#pf'); if (pf) pf.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(pf); try { state.user = (await api('PUT', '/me', formObj(pf))).user; renderNav(); toast('Datos actualizados'); } catch (er) { showError(pf, er); } });
    const pwf = $('#pwf'); if (pwf) pwf.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(pwf); try { await api('POST', '/me/password', formObj(pwf)); pwf.reset(); toast('Contraseña actualizada'); } catch (er) { showError(pwf, er); } });
    const af = $('#af'); if (af) {
      bindAddress(af, 'address');
      af.addEventListener('submit', async (e) => { e.preventDefault(); clearErrors(af); try { await api('POST', '/me/addresses', { label: af.label.value, ...placeOf(af, 'address') }); toast('Dirección guardada'); navigate(); } catch (er) { showError(af, er); } });
    }
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog('Eliminar dirección', '¿Querés eliminar esta dirección guardada?', 'Eliminar')) { await api('DELETE', '/me/addresses/' + b.dataset.del); navigate(); } }));
  };
  show('datos');
}, { auth: true });

/* ---------- panel del repartidor ---------- */
route('/repartidor', async () => {
  let watchId = null, lastSent = 0, sharing = false;
  const mapsLink = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  const stopShare = () => { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; sharing = false; };
  onLeave(stopShare);
  const render = async () => {
    const { shipments } = await api('GET', '/driver/shipments');
    view(`<h1>Mis entregas</h1><div class="card mb" id="gpsCard"><div style="display:flex;gap:1rem;align-items:center;justify-content:space-between;flex-wrap:wrap"><div><h3 style="margin:0">Compartir mi ubicación</h3><p class="small muted" style="margin:.2rem 0 0">El cliente ve tu posición en el mapa mientras tengas esta pantalla abierta. Se necesita permiso de GPS${window.isSecureContext ? '' : ' y conexión segura (https)'}.</p></div>
      <button class="btn ${sharing ? 'danger' : ''}" id="shareBtn">${icon('pin')}${sharing ? 'Dejar de compartir' : 'Compartir ubicación'}</button></div><div id="gpsMsg" class="small mt muted"></div></div>
      ${shipments.length ? shipments.map((s) => { const idx = STATUSES.indexOf(s.status), next = STATUSES[idx + 1];
        return `<div class="card mb"><div style="display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap"><span class="code">${esc(s.trackingCode)}</span><span class="badge ${s.status === 'delivered' ? 'done' : 'live'}">${esc(s.statusLabel)}</span></div>
          <div class="grid g2 mt"><div><b>Retiro</b><br>${esc(s.originAddress)}<br><span class="small muted">Remitente: ${esc(s.senderName)}</span><br><a class="small" target="_blank" rel="noopener" href="${mapsLink(s.origin.lat, s.origin.lng)}">Ver en el mapa</a></div>
          <div><b>Entrega</b><br>${esc(s.destinationAddress)}<br><span class="small muted">Destinatario: ${esc(s.receiverName)}</span><br><a class="small" target="_blank" rel="noopener" href="${mapsLink(s.destination.lat, s.destination.lng)}">Ver en el mapa</a></div></div>
          <p class="small muted">Paquete: ${s.weightKg} kg · ${s.lengthCm}×${s.widthCm}×${s.heightCm} cm · ${esc(s.serviceLabel)}</p>
          ${s.status === 'delivered' ? '' : `<div class="row" style="margin-top:.4rem">${next ? `<button class="btn" data-st="${next}" data-id="${s.id}">${esc(STATUS_LABELS[next])}</button>` : ''}${next && next !== 'delivered' ? `<button class="btn alt" data-st="delivered" data-id="${s.id}">Marcar como entregado</button>` : ''}</div>`}</div>`; }).join('')
        : '<div class="card"><p class="muted">No tenés pedidos asignados por ahora.</p></div>'}`);
    $('#shareBtn').addEventListener('click', toggleShare);
    $$('[data-st]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.st === 'delivered' && !(await confirmDialog('Confirmar entrega', '¿Confirmás que el paquete fue entregado?', 'Sí, entregado'))) return;
      try { await api('POST', `/driver/shipments/${b.dataset.id}/status`, { status: b.dataset.st }); toast('Estado actualizado'); render(); } catch (e) { toast(e.message, 'bad'); }
    }));
    if (sharing) $('#gpsMsg').textContent = 'Compartiendo ubicación…';
  };
  function toggleShare() {
    if (sharing) { stopShare(); return render(); }
    if (!navigator.geolocation) return toast('Este dispositivo no permite usar el GPS', 'bad');
    sharing = true;
    watchId = navigator.geolocation.watchPosition(async (pos) => {
      if (Date.now() - lastSent < 8000) return; lastSent = Date.now();
      try {
        await api('POST', '/driver/location', { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        const m = $('#gpsMsg'); if (m) m.textContent = `Última ubicación enviada: ${new Date().toLocaleTimeString('es-AR')} (precisión ±${Math.round(pos.coords.accuracy)} m)`;
      } catch (e) { const m = $('#gpsMsg'); if (m) m.textContent = 'No se pudo enviar la ubicación: ' + e.message; }
    }, (err) => {
      const msg = err.code === 1 ? 'Permiso de ubicación denegado. Activalo en los ajustes del navegador.' : 'No se pudo obtener la ubicación GPS. Verificá que el GPS esté activado.';
      stopShare(); render().then(() => { $('#gpsMsg').textContent = msg; }); toast(msg, 'bad');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    render();
  }
  await render();
}, { role: 'driver' });
