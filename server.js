const http = require('http');
const cfg = require('./config');
const { Router, HttpError, parseCookies, readJson, sendJson, serveStatic } = require('./lib');
const { loadUser, routes: authRoutes } = require('./auth');

function createApp() {
  const router = new Router();
  for (const m of ['auth', 'shipments', 'points', 'driver', 'admin']) (m === 'auth' ? authRoutes : require('./' + m).routes)(router);

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const ctx = {
        req, res, params: {}, query: Object.fromEntries(url.searchParams), body: {}, user: null,
        cookies: parseCookies(req.headers.cookie), ip: req.socket.remoteAddress || 'ip',
        _cookies: [], cookie(c) { this._cookies.push(c); },
      };
      if (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for']) ctx.ip = String(req.headers['x-forwarded-for']).split(',')[0].trim();

      if (!url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Método no permitido');
        return serveStatic(req, res, cfg.frontendDir, url.pathname);
      }
      // Protección CSRF: las acciones que modifican datos exigen un encabezado propio y el mismo origen
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.headers.origin;
        if (req.headers['x-gx'] !== '1' || (origin && new URL(origin).host !== req.headers.host)) throw new HttpError(403, 'Solicitud no permitida');
      }
      const { handlers, params, pathMatched } = router.match(req.method, url.pathname);
      if (!handlers) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Método no permitido' : 'No encontrado');
      ctx.params = params;
      ctx.body = await readJson(req);
      loadUser(ctx);
      let result;
      for (const h of handlers) { const r = await h(ctx); if (r !== undefined) result = r; }
      const headers = ctx._cookies.length ? { 'Set-Cookie': ctx._cookies } : {};
      if (result && result.status && result.data !== undefined) return sendJson(res, result.status, result.data, headers);
      return sendJson(res, 200, result === undefined ? { ok: true } : result, headers);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, ...(e.details || {}) });
      console.error(e);
      sendJson(res, 500, { error: 'Ocurrió un error inesperado. Intentá de nuevo.' });
    }
  });
}
module.exports = { createApp };
if (require.main === module) {
  createApp().listen(cfg.port, () => console.log(`GoExpress escuchando en ${cfg.appUrl}`));
}
