// Cálculo del precio: distancia + peso facturable (real o volumétrico) y tipo de servicio.
function computePrice({ distanceKm, weightKg, lengthCm, widthCm, heightCm, service }, cfg) {
  const volumetricKg = (lengthCm * widthCm * heightCm) / cfg.volumetric_divisor;
  const billableKg = Math.max(weightKg, volumetricKg);
  const mult = cfg['mult_' + service];
  const parts = {
    base: cfg.base_price,
    distance: cfg.price_per_km * distanceKm,
    weight: cfg.price_per_kg * billableKg,
  };
  const subtotal = (parts.base + parts.distance + parts.weight) * mult;
  const total = Math.max(cfg.min_price, Math.round(subtotal));
  return {
    billableKg: Math.round(billableKg * 100) / 100,
    volumetricKg: Math.round(volumetricKg * 100) / 100,
    multiplier: mult,
    breakdown: { base: Math.round(parts.base), distance: Math.round(parts.distance), weight: Math.round(parts.weight) },
    total,
    minApplied: total === cfg.min_price && Math.round(subtotal) < cfg.min_price,
  };
}
function applyCoupon(total, coupon) {
  if (!coupon) return 0;
  const d = coupon.discount_type === 'percent' ? total * Math.min(coupon.discount_value, 100) / 100 : coupon.discount_value;
  return Math.min(total, Math.round(d));
}
module.exports = { computePrice, applyCoupon };
