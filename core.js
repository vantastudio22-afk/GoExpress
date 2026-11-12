/* Núcleo del frontend: utilidades, API, rutas, iconos y componentes compartidos */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$ ' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const STATUSES = ['received', 'pickup_pending', 'picked_up', 'in_transit', 'in_distribution', 'delivered'];
const STATUS_LABELS = { received: 'Solicitud recibida', pickup_pending: 'Retiro pendiente', picked_up: 'Paquete retirado', in_transit: 'En camino', in_distribution: 'En distribución', delivered: 'Entregado' };
const SERVICES = [['standard', 'Estándar', 'Económico'], ['express', 'Express', 'Más rápido'], ['urgent', 'Urgente', 'Prioridad máxima']];
const state = { user: null };

class ApiError extends Error { constructor(m, status, field) { super(m); this.status = status; this.field = field; } }
async function api(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-GX': '1' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch { throw new ApiError('No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.', 0); }
  let data = {}; try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) throw new ApiError(data.error || 'Ocurrió un error inesperado', res.status, data.field);
  return data;
}

/* ---------- iconos (SVG propios) ---------- */
const ICONS = {
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  calc: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.800 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  star: '<path d="m12 3 2.700 5.600 6.100.9-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100L3.200 9.500l6.100-.9z"/>',
  truck: '<path d="M2 6h12v10H2zM14 9h4l3 3v4h-7z"/><circle cx="6.500" cy="17.500" r="2"/><circle cx="17.500" cy="17.500" r="2"/>',
  gift: '<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M12 9v12M3 13h18M12 9c-3 0-4.500-4-2-4.500 1.800 0 2 2.500 2 4.500zm0 0c3 0 4.500-4 2-4.500-1.800 0-2 2.500-2 4.500z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.400 3.600-7 8-7s8 2.600 8 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.500 8 8 9 4.500-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  send: '<path d="m3 11 18-8-8 18-2-8z"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const SCOOTER = `<svg viewBox="0 0 64 64" fill="none" stroke="#5C432B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="12" y="6" width="22" height="18" rx="2" fill="#EBDDBE"/><path d="M23 6v7l3-2 3 2V6" stroke-width="2"/><path d="M8 26h30M10 36c0-5 4-8 9-8h18l4-8h6M44 20l5 18"/><circle cx="16" cy="48" r="6"/><circle cx="48" cy="48" r="6"/><path d="M22 48h20"/></svg>`;

/* ---------- interfaz ---------- */
function toast(msg, type = '') {
  const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 4500);
}
function confirmDialog(title, text, ok = 'Confirmar') {
  return new Promise((resolve) => {
    const d = $('#dlg');
    d.innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="acts"><button class="btn alt sm" value="no">Cancelar</button><button class="btn sm" value="yes">${esc(ok)}</button></div>`;
    d.onclose = () => resolve(d.returnValue === 'yes');
    $$('button', d).forEach((b) => b.addEventListener('click', () => d.close(b.value)));
    d.returnValue = 'no'; d.showModal();
  });
}
const cleanups = [];
const onLeave = (fn) => cleanups.push(fn);
function view(html) { const v = $('#view'); v.innerHTML = html; v.focus({ preventScroll: true }); window.scrollTo(0, 0); }
function showError(form, e) {
  $$('.err', form).forEach((x) => x.remove()); $$('input.bad', form).forEach((x) => x.classList.remove('bad'));
  const box = document.createElement('div'); box.className = 'err'; box.setAttribute('role', 'alert'); box.textContent = e.message || String(e);
  const first = form.querySelector('.formerr') || form; first.prepend(box);
  if (e.field) { const f = form.querySelector(`[name="${e.field.split('.')[0]}"]`); if (f) f.classList.add('bad'); }
}
const clearErrors = (form) => $$('.err', form).forEach((x) => x.remove());
async function busy(btn, fn) {
  const label = btn.innerHTML; btn.disabled = true; btn.textContent = 'Un momento…';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
}
const formObj = (form) => Object.fromEntries(new FormData(form).entries());

/* ---------- direcciones con búsqueda en el mapa ---------- */
function addressField(name, label, saved = []) {
  return `<div class="field addr" data-addr="${name}"><label for="${name}_in">${label}</label>
    ${saved.length ? `<select class="saved" aria-label="Direcciones guardadas"><option value="">Elegir una dirección guardada…</option>${saved.map((a) => `<option value="${a.id}">${esc(a.label)} · ${esc(a.address)}</option>`).join('')}</select><div style="height:.4rem"></div>` : ''}
    <div class="row"><input id="${name}_in" name="${name}" required minlength="3" maxlength="250" autocomplete="street-address" placeholder="Calle, número y ciudad"><button type="button" class="btn alt sm find">${icon('pin')}Buscar</button></div>
    <ul class="cands hide"></ul><div class="picked small"></div></div>`;
}
function bindAddress(root, name, saved = [], onChange = () => {}) {
  const box = $(`[data-addr="${name}"]`, root), input = $('input[name]', box), list = $('.cands', box), picked = $('.picked', box);
  const set = (lat, lng, text) => { input.dataset.lat = lat ?? ''; input.dataset.lng = lng ?? ''; picked.textContent = lat != null ? '✓ Ubicación confirmada en el mapa' : ''; if (text != null) input.value = text; onChange(); };
  input.addEventListener('input', () => { set(null, null); list.classList.add('hide'); });
  $('.find', box).addEventListener('click', async () => {
    const q = input.value.trim(); if (q.length < 3) return toast('Escribí una dirección más completa', 'bad');
    list.innerHTML = '<li><button type="button" disabled>Buscando…</button></li>'; list.classList.remove('hide');
    try {
      const { results } = await api('GET', '/geo/search?q=' + encodeURIComponent(q));
      list.innerHTML = results.length ? results.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.label)}</button></li>`).join('') : '<li><button type="button" disabled>No encontramos esa dirección. Probá agregando la ciudad.</button></li>';
      $$('button[data-i]', list).forEach((b) => b.addEventListener('click', () => { const r = results[b.dataset.i]; set(r.lat, r.lng, r.label); list.classList.add('hide'); }));
    } catch (e) { list.innerHTML = `<li><button type="button" disabled>${esc(e.message)}</button></li>`; }
  });
  const sel = $('.saved', box);
  if (sel) sel.addEventListener('change', () => { const a = saved.find((x) => String(x.id) === sel.value); if (a) set(a.lat, a.lng, a.address); });
  return { set };
}
const placeOf = (form, name) => { const i = form.elements[name]; return { address: i.value, ...(i.dataset.lat ? { lat: Number(i.dataset.lat), lng: Number(i.dataset.lng) } : {}) }; };
function packageFields(v = {}) {
  return `<div class="grid g2"><div class="field"><label for="weightKg">Peso (kg)</label><input id="weightKg" name="weightKg" type="number" min="0.01" max="70" step="0.01" required value="${esc(v.weightKg ?? '')}" inputmode="decimal"></div>
    <div class="field"><label>Dimensiones (cm): largo × ancho × alto</label><div class="grid g3" style="gap:.4rem"><input name="lengthCm" type="number" min="1" max="200" required placeholder="Largo" aria-label="Largo en cm" value="${esc(v.lengthCm ?? '')}"><input name="widthCm" type="number" min="1" max="200" required placeholder="Ancho" aria-label="Ancho en cm" value="${esc(v.widthCm ?? '')}"><input name="heightCm" type="number" min="1" max="200" required placeholder="Alto" aria-label="Alto en cm" value="${esc(v.heightCm ?? '')}"></div></div></div>
    <div class="field"><label>Tipo de envío</label><div class="opts">${SERVICES.map(([k, n, d]) => `<label class="opt"><input type="radio" name="service" value="${k}" ${(v.service || 'standard') === k ? 'checked' : ''}><span>${n}<small>${d}</small></span></label>`).join('')}</div></div>`;
}
const pkgOf = (f) => ({ weightKg: f.weightKg.value, lengthCm: f.lengthCm.value, widthCm: f.widthCm.value, heightCm: f.heightCm.value, service: f.service.value });
function quoteCard(q) {
  const b = q.price.breakdown;
  return `<div class="card" id="quoteOut"><p class="muted small" style="margin:0">Precio estimado · ${esc(q.serviceLabel)}</p><div class="price">${money(q.price.total)}</div>
    <table class="bd"><tr><td>Tarifa base</td><td>${money(b.base)}</td></tr><tr><td>Distancia (${q.distanceKm} km)</td><td>${money(b.distance)}</td></tr>
    <tr><td>Peso facturable (${q.price.billableKg} kg)</td><td>${money(b.weight)}</td></tr>${q.price.multiplier !== 1 ? `<tr><td>Servicio ${esc(q.serviceLabel)}</td><td>× ${q.price.multiplier}</td></tr>` : ''}${q.price.minApplied ? '<tr><td>Se aplicó la tarifa mínima</td><td></td></tr>' : ''}</table>
    ${q.note ? `<div class="info">${esc(q.note)}</div>` : ''}<p class="small muted">Origen: ${esc(q.origin.address)}<br>Destino: ${esc(q.destination.address)}</p></div>`;
}

/* ---------- navegación ---------- */
const routes = [];
const route = (pattern, handler, guard = {}) => routes.push({ re: new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '/?$'), keys: (pattern.match(/:\w+/g) || []).map((k) => k.slice(1)), handler, guard });
function renderNav() {
  const u = state.user, cur = (location.hash.slice(1) || '/').split('?')[0];
  const L = (h, t, cls = '') => `<a href="#${h}" class="${cls} ${cur === h ? 'on' : ''}">${t}</a>`;
  let h = L('/', 'Inicio') + L('/cotizar', 'Cotizar') + L('/seguimiento', 'Seguimiento') + L('/puntos', 'Puntos');
  if (u && u.role === 'admin') h += L('/admin', 'Panel admin');
  if (u && u.role === 'driver') h += L('/repartidor', 'Mis entregas');
  if (!u) h += L('/login', 'Ingresar') + L('/registro', 'Crear cuenta', 'cta');
  else h += L('/enviar', 'Solicitar envío', 'cta') + L('/perfil', esc(u.name.split(' ')[0])) + '<button id="logout">Salir</button>';
  $('#nav').innerHTML = h; $('#nav').classList.remove('open'); $('#burger').setAttribute('aria-expanded', 'false');
  const lo = $('#logout'); if (lo) lo.addEventListener('click', async () => { await api('POST', '/auth/logout'); state.user = null; toast('Sesión cerrada'); location.hash = '#/'; renderNav(); });
}
async function navigate() {
  cleanups.splice(0).forEach((f) => { try { f(); } catch { /* ignorar */ } });
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  renderNav();
  for (const r of routes) {
    const m = r.re.exec(path); if (!m) continue;
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const g = r.guard;
    if ((g.auth || g.role) && !state.user) { toast('Iniciá sesión para continuar', 'bad'); sessionStorage.setItem('gx_next', location.hash); location.hash = '#/login'; return; }
    if (g.role && state.user.role !== g.role) { view('<div class="card"><h2>Sin permiso</h2><p>Tu cuenta no tiene acceso a esta sección.</p></div>'); return; }
    view('<div class="loading">Cargando…</div>');
    try { await r.handler(params); } catch (e) { view(`<div class="card"><h2>Algo salió mal</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Volver al inicio</a></div>`); }
    return;
  }
  view('<div class="card"><h2>Página no encontrada</h2><a class="btn" href="#/">Ir al inicio</a></div>');
}
async function boot() {
  $('#brandIco').innerHTML = SCOOTER; $('#year').textContent = new Date().getFullYear();
  $('#burger').addEventListener('click', () => { const o = $('#nav').classList.toggle('open'); $('#burger').setAttribute('aria-expanded', String(o)); });
  try { state.user = (await api('GET', '/auth/me')).user; } catch { state.user = null; }
  window.addEventListener('hashchange', navigate); navigate();
}

/* ---------- mapa compartido ---------- */
function makeMap(el) {
  const map = L.map(el, { scrollWheelZoom: false }).setView([-34.6, -58.4], 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  map.on('focus', () => map.scrollWheelZoom.enable()); map.on('blur', () => map.scrollWheelZoom.disable());
  return map;
}
const pinIcon = (cls, ch) => L.divIcon({ className: '', html: `<div class="pin ${cls}">${ch}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
