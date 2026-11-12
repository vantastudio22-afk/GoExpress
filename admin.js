/* Panel de administración */
const SETTING_LABELS = {
  base_price: 'Tarifa base ($)', price_per_km: 'Precio por km ($)', price_per_kg: 'Precio por kg facturable ($)', min_price: 'Tarifa mínima ($)', volumetric_divisor: 'Divisor volumétrico (cm³/kg)',
  mult_standard: 'Multiplicador Estándar', mult_express: 'Multiplicador Express', mult_urgent: 'Multiplicador Urgente', points_per_100: 'Puntos por cada $100 pagados',
};
function formDialog(title, fields, onSubmit, okLabel = 'Guardar') {
  const d = $('#dlg');
  d.innerHTML = `<h3>${esc(title)}</h3><form id="df" novalidate><div class="formerr"></div>${fields}<div class="acts"><button type="button" class="btn alt sm" id="dx">Cancelar</button><button class="btn sm" type="submit">${esc(okLabel)}</button></div></form>`;
  d.onclose = null; d.showModal();
  $('#dx').addEventListener('click', () => d.close());
  $('#df').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; clearErrors(f); try { await onSubmit(f); d.close(); } catch (er) { showError(f, er); } });
}

route('/admin', async () => {
  let drivers = [];
  const tabs = { resumen: 'Resumen', envios: 'Envíos', clientes: 'Clientes', repartidores: 'Repartidores', tarifas: 'Tarifas', recompensas: 'Recompensas' };
  const shell = (tab, html) => { view(`<h1>Panel de administración</h1><div class="tabs" role="tablist">${Object.entries(tabs).map(([k, n]) => `<button role="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div><div id="tabbody">${html}</div>`);
    $$('[data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab))); };
  const bars = (rows, label, val, max) => rows.map((r) => `<div class="bar-row"><span class="t">${esc(label(r))}</span><span class="b"><i style="width:${max ? Math.round((val(r) / max) * 100) : 0}%"></i></span><b>${val(r)}</b></div>`).join('');

  const tabsImpl = {
    async resumen() {
      const s = await api('GET', '/admin/stats'), t = s.totals;
      shell('resumen', `<div class="grid g4 mb">${[['Envíos', t.shipments, 'box'], ['Clientes', t.clients, 'user'], ['Repartidores activos', t.drivers, 'truck'], ['Ingresos (entregados)', money(t.revenue), 'chart']].map(([n, v, i]) => `<div class="card"><div class="ico">${icon(i)}</div><div class="stat">${v}</div><span class="muted">${n}</span></div>`).join('')}</div>
        <div class="grid g2" style="align-items:start"><div class="card"><h3>Envíos por estado</h3>${bars(s.byStatus, (r) => r.label, (r) => r.count, Math.max(1, ...s.byStatus.map((r) => r.count)))}</div>
        <div class="card"><h3>Envíos de los últimos 14 días</h3>${s.perDay.length ? bars(s.perDay, (r) => r.d, (r) => r.c, Math.max(1, ...s.perDay.map((r) => r.c))) : '<p class="muted">Sin envíos en el período.</p>'}</div>
        <div class="card"><h3>Puntos</h3><p>Emitidos: <b>${t.pointsIssued}</b><br>Canjeados: <b>${t.pointsRedeemed}</b></p></div>
        <div class="card"><h3>Por tipo de servicio</h3>${s.byService.length ? bars(s.byService, (r) => r.service, (r) => r.c, Math.max(1, ...s.byService.map((r) => r.c))) : '<p class="muted">Sin datos todavía.</p>'}</div></div>`);
    },
    async envios(filter = {}) {
      const qs = new URLSearchParams(filter).toString();
      drivers = (await api('GET', '/admin/drivers')).drivers; // siempre la lista actualizada
      const { shipments } = await api('GET', '/admin/shipments' + (qs ? '?' + qs : ''));
      shell('envios', `<form class="card mb row" id="flt"><div><label for="fs">Estado</label><select id="fs" name="status"><option value="">Todos</option>${STATUSES.map((s) => `<option value="${s}" ${filter.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>
        <div><label for="fq">Buscar</label><input id="fq" name="q" placeholder="Seguimiento o nombre" value="${esc(filter.q || '')}"></div><button class="btn" type="submit">Filtrar</button></form>
        <div class="card"><div class="scroll"><table class="tbl"><thead><tr><th>Seguimiento</th><th>Cliente</th><th>Destinatario</th><th>Estado</th><th>Repartidor</th><th>Total</th></tr></thead><tbody>${shipments.map((s) => `<tr>
          <td><a href="#/seguimiento/${esc(s.trackingCode)}"><span class="code">${esc(s.trackingCode)}</span></a><br><span class="small muted">${fmtDate(s.createdAt)}</span></td><td>${esc(s.clientName)}<br><span class="small muted">${esc(s.clientEmail)}</span></td><td>${esc(s.receiverName)}</td>
          <td><select data-status="${s.id}" aria-label="Estado">${STATUSES.map((x) => `<option value="${x}" ${x === s.status ? 'selected' : ''}>${STATUS_LABELS[x]}</option>`).join('')}</select></td>
          <td><select data-assign="${s.id}" aria-label="Repartidor"><option value="">Sin asignar</option>${drivers.filter((d) => d.active).map((d) => `<option value="${d.id}" ${d.id === s.driverId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></td><td>${money(s.priceFinal)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No hay envíos.</td></tr>'}</tbody></table></div></div>`);
      $('#flt').addEventListener('submit', (e) => { e.preventDefault(); const o = formObj(e.target); Object.keys(o).forEach((k) => !o[k] && delete o[k]); go('envios', o); });
      $$('[data-status]').forEach((sel) => sel.addEventListener('change', async () => { try { await api('PATCH', `/admin/shipments/${sel.dataset.status}/status`, { status: sel.value }); toast('Estado actualizado'); } catch (e) { toast(e.message, 'bad'); go('envios', filter); } }));
      $$('[data-assign]').forEach((sel) => sel.addEventListener('change', async () => { if (!sel.value) return; try { await api('POST', `/admin/shipments/${sel.dataset.assign}/assign`, { driverId: Number(sel.value) }); toast('Repartidor asignado'); go('envios', filter); } catch (e) { toast(e.message, 'bad'); go('envios', filter); } }));
    },
    async clientes() {
      const { clients } = await api('GET', '/admin/clients');
      shell('clientes', `<div class="card"><div class="scroll"><table class="tbl"><thead><tr><th>Cliente</th><th>Alta</th><th>Envíos</th><th>Puntos</th><th></th></tr></thead><tbody>${clients.map((c) => `<tr><td>${esc(c.name)}<br><span class="small muted">${esc(c.email)}${c.phone ? ' · ' + esc(c.phone) : ''}</span></td><td>${fmtDate(c.createdAt)}</td><td>${c.shipments}</td><td>${c.points}</td>
        <td><button class="btn alt sm" data-pts="${c.id}" data-name="${esc(c.name)}">Ajustar puntos</button> <button class="btn alt sm" data-act="${c.id}" data-on="${c.active ? 1 : 0}">${c.active ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Todavía no hay clientes.</td></tr>'}</tbody></table></div></div>`);
      $$('[data-act]').forEach((b) => b.addEventListener('click', async () => { try { await api('PATCH', '/admin/users/' + b.dataset.act, { active: b.dataset.on !== '1' }); go('clientes'); } catch (e) { toast(e.message, 'bad'); } }));
      $$('[data-pts]').forEach((b) => b.addEventListener('click', () => formDialog('Ajustar puntos de ' + b.dataset.name,
        '<div class="field"><label for="points">Puntos (positivo suma, negativo resta)</label><input id="points" name="points" type="number" step="1" required></div><div class="field"><label for="note">Motivo</label><input id="note" name="note" required maxlength="150"></div>',
        async (f) => { await api('POST', '/admin/points/adjust', { userId: Number(b.dataset.pts), points: Number(f.points.value), note: f.note.value }); toast('Puntos actualizados'); go('clientes'); })));
    },
    async repartidores() {
      const { drivers: list } = await api('GET', '/admin/drivers');
      shell('repartidores', `<div class="grid g2" style="align-items:start"><div><div class="card mb"><h3>Ubicación de los repartidores</h3><div id="dmap" class="map" style="height:340px"></div><p class="small muted mt" id="dnote"></p></div></div>
        <div><div class="card mb"><h3>Repartidores</h3>${list.length ? `<ul style="list-style:none;padding:0">${list.map((d) => `<li style="border-bottom:1px solid var(--line);padding:.5rem 0"><b>${esc(d.name)}</b> ${d.active ? '' : '<span class="badge">Inactivo</span>'}<br><span class="small muted">${esc(d.email)} · ${d.openShipments} envío(s) en curso<br>${d.location ? 'Última ubicación: ' + fmtDate(d.location.recordedAt) : 'Sin ubicación informada'}</span></li>`).join('')}</ul>` : '<p class="muted">Todavía no hay repartidores.</p>'}</div>
        <form class="card" id="nd" novalidate><h3>Nuevo repartidor</h3><div class="formerr"></div><div class="field"><label for="n">Nombre y apellido</label><input id="n" name="name" required></div><div class="field"><label for="e">Email</label><input id="e" name="email" type="email" required></div><div class="field"><label for="p">Contraseña inicial</label><input id="p" name="password" type="password" required minlength="8"><small class="muted">Mínimo 8 caracteres con letras y números.</small></div><button class="btn" type="submit">Crear repartidor</button></form></div></div>`);
      const map = makeMap('dmap'), group = L.featureGroup().addTo(map); let fitted = false;
      const refresh = async () => {
        const { drivers: ds } = await api('GET', '/admin/drivers'); group.clearLayers();
        ds.filter((d) => d.location).forEach((d) => L.marker([d.location.lat, d.location.lng], { icon: pinIcon(d.location.ageSeconds > 120 ? 'stale' : '', '🛵') }).addTo(group).bindPopup(`<b>${esc(d.name)}</b><br>${d.location.ageSeconds > 120 ? 'Última ubicación conocida: ' : 'En vivo: '}${fmtDate(d.location.recordedAt)}`));
        $('#dnote').textContent = group.getLayers().length ? 'Los marcadores grises indican más de 2 minutos sin señal GPS.' : 'Ningún repartidor informó su ubicación todavía.';
        if (!fitted && group.getLayers().length) { map.fitBounds(group.getBounds().pad(.3)); fitted = true; }
      };
      await refresh(); const timer = setInterval(refresh, 15000); repCleanup = () => { clearInterval(timer); map.remove(); };
      $('#nd').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; clearErrors(f); try { await api('POST', '/admin/drivers', formObj(f)); toast('Repartidor creado'); go('repartidores'); } catch (er) { showError(f, er); } });
    },
    async tarifas() {
      const { settings } = await api('GET', '/admin/settings');
      shell('tarifas', `<form class="card" id="sf" novalidate style="max-width:720px"><h3>Tarifas y puntos</h3><p class="muted small">Precio = (tarifa base + km × precio por km + kg facturable × precio por kg) × multiplicador del servicio, con una tarifa mínima. El peso facturable es el mayor entre el peso real y el volumétrico (largo × ancho × alto ÷ divisor).</p><div class="formerr"></div>
        <div class="grid g2">${Object.entries(SETTING_LABELS).map(([k, n]) => `<div class="field"><label for="${k}">${n}</label><input id="${k}" name="${k}" type="number" step="any" min="0" required value="${settings[k]}"></div>`).join('')}</div><button class="btn" type="submit">Guardar cambios</button></form>`);
      $('#sf').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; clearErrors(f); try { await api('PUT', '/admin/settings', formObj(f)); toast('Tarifas actualizadas'); } catch (er) { showError(f, er); } });
    },
    async recompensas() {
      const { rewards } = await api('GET', '/admin/rewards');
      const fields = (r = {}) => `<div class="field"><label for="rn">Nombre</label><input id="rn" name="name" required maxlength="80" value="${esc(r.name || '')}"></div><div class="field"><label for="rd">Descripción</label><input id="rd" name="description" maxlength="200" value="${esc(r.description || '')}"></div>
        <div class="grid g3"><div class="field"><label for="rc">Puntos necesarios</label><input id="rc" name="pointsCost" type="number" min="1" step="1" required value="${r.pointsCost || ''}"></div><div class="field"><label for="rt">Tipo</label><select id="rt" name="discountType"><option value="percent" ${r.discountType !== 'fixed' ? 'selected' : ''}>Porcentaje (%)</option><option value="fixed" ${r.discountType === 'fixed' ? 'selected' : ''}>Monto fijo ($)</option></select></div><div class="field"><label for="rv">Valor</label><input id="rv" name="discountValue" type="number" min="0.01" step="any" required value="${r.discountValue || ''}"></div></div>
        <label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" name="featured" style="width:auto" ${r.featured ? 'checked' : ''}> Destacada</label><label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" name="active" style="width:auto" ${r.active !== false ? 'checked' : ''}> Activa (visible para los clientes)</label>`;
      const body = (f) => ({ name: f.name.value, description: f.description.value, pointsCost: Number(f.pointsCost.value), discountType: f.discountType.value, discountValue: Number(f.discountValue.value), featured: f.featured.checked, active: f.active.checked });
      shell('recompensas', `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap"><h3 style="margin:0">Catálogo de recompensas</h3><button class="btn sm" id="newR">Nueva recompensa</button></div><div class="scroll mt"><table class="tbl"><thead><tr><th>Nombre</th><th>Puntos</th><th>Descuento</th><th>Estado</th><th></th></tr></thead><tbody>${rewards.map((r) => `<tr><td>${esc(r.name)}${r.featured ? ' ⭐' : ''}<br><span class="small muted">${esc(r.description)}</span></td><td>${r.pointsCost}</td><td>${r.discountType === 'percent' ? r.discountValue + '%' : money(r.discountValue)}</td><td>${r.active ? '<span class="badge done">Activa</span>' : '<span class="badge">Inactiva</span>'}</td><td><button class="btn alt sm" data-edit="${r.id}">Editar</button></td></tr>`).join('')}</tbody></table></div></div>`);
      $('#newR').addEventListener('click', () => formDialog('Nueva recompensa', fields(), async (f) => { await api('POST', '/admin/rewards', body(f)); toast('Recompensa creada'); go('recompensas'); }));
      $$('[data-edit]').forEach((b) => b.addEventListener('click', () => { const r = rewards.find((x) => String(x.id) === b.dataset.edit); formDialog('Editar recompensa', fields(r), async (f) => { await api('PUT', '/admin/rewards/' + r.id, body(f)); toast('Recompensa actualizada'); go('recompensas'); }); }));
    },
  };
  let repCleanup = null;
  const go = (tab, arg) => { if (repCleanup) { repCleanup(); repCleanup = null; } return tabsImpl[tab](arg); };
  onLeave(() => { if (repCleanup) repCleanup(); });
  await go('resumen');
}, { role: 'admin' });
