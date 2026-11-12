// Estados del envío (en orden) y etiquetas en español
const STATUSES = ['received', 'pickup_pending', 'picked_up', 'in_transit', 'in_distribution', 'delivered'];
const STATUS_LABELS = {
  received: 'Solicitud recibida',
  pickup_pending: 'Retiro pendiente',
  picked_up: 'Paquete retirado',
  in_transit: 'En camino',
  in_distribution: 'En distribución',
  delivered: 'Entregado',
};
const SERVICES = ['standard', 'express', 'urgent'];
const SERVICE_LABELS = { standard: 'Estándar', express: 'Express', urgent: 'Urgente' };
// Estados en los que el repartidor lleva el paquete (se muestra su GPS en el mapa)
const MOVING = ['picked_up', 'in_transit', 'in_distribution'];
module.exports = { STATUSES, STATUS_LABELS, SERVICES, SERVICE_LABELS, MOVING };
