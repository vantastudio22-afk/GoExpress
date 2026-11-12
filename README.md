# GoExpress · plataforma de encomiendas

Cotizaciones, solicitud de envíos, **seguimiento por GPS en un mapa**, puntos canjeables, panel de administración y panel del repartidor.
Paleta beige y marrón de la marca. **No tiene dependencias de npm**: usa solo lo que trae Node.

## Requisitos
- **Node.js 22.13 o superior** (usa el SQLite incluido en Node).
- Conexión a internet para los mapas (tiles de OpenStreetMap, Leaflet desde unpkg, buscador de direcciones y rutas).

## Puesta en marcha (5 minutos)
```bash
cp .env.example .env            # y completá JWT_SECRET (instrucciones dentro del archivo)
npm run create-admin -- "Tu Nombre" tu-email@dominio.com     # crea el primer administrador (te pide la contraseña)
npm start                        # abre http://localhost:3000
```
Después, desde **Panel admin → Repartidores** creá las cuentas de los repartidores y desde **Panel admin → Tarifas** cargá tus precios reales.

## Cómo se usa
| Rol | Qué hace |
|---|---|
| **Cliente** | Se registra, cotiza, solicita envíos (obtiene un número `GX…`), sigue su paquete en el mapa, suma y canjea puntos. |
| **Administrador** | Ve todos los envíos, asigna repartidores, cambia estados, edita tarifas y recompensas, ajusta puntos, ve estadísticas y la ubicación de los repartidores. |
| **Repartidor** | Ve sus pedidos asignados, actualiza estados, marca entregas y **comparte su GPS** desde el celular. |

Estados del envío: Solicitud recibida → Retiro pendiente → Paquete retirado → En camino → En distribución → Entregado.

## Servicios externos y credenciales que necesitás
| Servicio | Para qué | Credenciales | Notas |
|---|---|---|---|
| **OpenStreetMap (tiles) + Leaflet** | Mostrar el mapa | Ninguna | Cumplir la [política de uso de tiles](https://operations.osmfoundation.org/policies/tiles/). Para mucho tráfico usá un proveedor de tiles (Mapbox, MapTiler, Stadia). |
| **Nominatim** | Convertir direcciones en coordenadas | Ninguna, pero **definí `GEO_USER_AGENT` con tu contacto** | El servidor público limita a 1 consulta/seg. En producción usá un Nominatim propio o un servicio compatible. |
| **OSRM** | Distancia por calles, recorrido y tiempo estimado (ETA) | Ninguna | El servidor público es solo de demostración. En producción: OSRM propio u OpenRouteService/Mapbox (ver "Cambiar de proveedor"). |
| **Resend** (o similar) | Enviar el email de "recuperar contraseña" | `RESEND_API_KEY` y un dominio verificado para `EMAIL_FROM` | Sin esta clave el enlace de recuperación **solo se imprime en la consola del servidor** (útil para desarrollo, no para producción). |
| **GPS del celular del repartidor** | Ubicación real | Permiso del navegador | **Requiere HTTPS** (excepto en `localhost`). |

### Cambiar de proveedor de mapas (Google Maps, Mapbox)
Todo lo externo está aislado en `backend/geo.js` (`geocode` y `route`) y en `frontend/js/core.js` (`makeMap`). Para usar Google/Mapbox cambiá esas dos funciones por llamadas a su API con tu clave (la clave **nunca** va en el frontend si es secreta: hacé las llamadas desde el backend).

## Seguimiento en tiempo real: cómo funciona (y qué NO hace)
1. El repartidor abre **Mis entregas → Compartir ubicación**. Su celular envía el GPS real cada ~8 segundos a `POST /api/driver/location`.
2. El cliente abre el seguimiento; la página consulta al servidor cada 10 segundos y mueve el marcador.
3. La distancia restante y el ETA se calculan desde la **última posición recibida** hasta el destino (o el retiro) con el servicio de rutas.
4. **No se simula nada**: sin repartidor asignado, sin GPS, o con más de 2 minutos sin señal, se muestra un aviso claro y la *última ubicación conocida*. Si el servicio de rutas no responde, no se inventa un ETA: se informa la distancia en línea recta.
5. Limitación de la web: el GPS se envía **mientras la pantalla del repartidor está abierta**. Para seguimiento en segundo plano haría falta una app nativa.

## Seguridad implementada
- Contraseñas con **scrypt** + sal; sesión en cookie `HttpOnly`, `SameSite=Strict` (y `Secure` en producción); el **rol se lee siempre de la base de datos**.
- Rutas de administración y repartidor protegidas por rol; cada repartidor solo toca sus envíos.
- Los clientes **no pueden modificar** puntos, precios ni estados: el precio se recalcula en el servidor, los puntos se acreditan solo al entregar (una vez por envío, garantizado por un índice único) y los canjes/cupones se procesan en transacciones.
- Validación de todos los formularios en el servidor, límite de intentos (login, registro, recuperación, cotización, búsqueda), protección CSRF (encabezado propio + mismo origen), cabeceras de seguridad y CSP.
- El seguimiento público oculta nombres y direcciones exactas; el titular y el administrador ven el detalle.
- Recuperación de contraseña con enlace de un solo uso que vence en 1 hora; la respuesta no revela si el email existe.

## Frontend y backend separados
Están en carpetas distintas (`frontend/` y `backend/`) y se comunican solo por la API `/api`. Por defecto el backend sirve el frontend. Para publicarlos en servidores distintos, ponelos **bajo el mismo dominio** con un proxy inverso (por ejemplo Nginx: `/` → archivos estáticos, `/api` → Node). Es lo que permite usar cookies seguras `SameSite=Strict`.

## Datos iniciales
Al crear la base se cargan **valores de ejemplo editables**: tarifas (base $1.500, $120/km, $200/kg, mínimo $2.000, Express ×1,5, Urgente ×2), 1 punto por cada $100 pagados y tres recompensas (10 %, $1.000 y 25 % de descuento). **No son datos de mercado: ajustalos** desde el panel antes de operar. No se crea ningún cliente, envío ni repartidor de ejemplo.

## Pruebas
```bash
npm test      # 42 pruebas de punta a punta: registro, permisos, cotización, envíos, GPS, puntos, cupones, administración
```

## Estructura
```
backend/   server.js · lib.js (router, seguridad) · db.js (esquema SQLite) · services.js (negocio) · pricing.js · geo.js
           auth.js · shipments.js · points.js · driver.js · admin.js · scripts/create-admin.js · test/smoke.js
frontend/  index.html · css/styles.css · js/core.js public.js user.js admin.js · img/logo.png
```

## Antes de salir a producción
Configurá `NODE_ENV=production`, `JWT_SECRET`, HTTPS, un servicio de rutas/geocodificación propio o comercial, el email (Resend), y hacé copias de seguridad de `data/goexpress.db`. El sistema no incluye cobros online: el precio se calcula y registra, pero el pago no se procesa.
