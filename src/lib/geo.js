/**
 * Geometría sobre el trazado fijo (polilínea).
 * Todas las distancias están en metros y las coordenadas en grados decimales.
 */

const RADIO_TIERRA_M = 6371000;
const rad = (g) => (g * Math.PI) / 180;

/** Distancia entre dos puntos {lat, lng} usando la fórmula de Haversine. */
export function distanciaMetros(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Largo total de una polilínea. */
export function largoPolilinea(puntos) {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) total += distanciaMetros(puntos[i - 1], puntos[i]);
  return total;
}

/** Punto ubicado a `distancia` metros del inicio de la polilínea (se limita a sus extremos). */
export function puntoEnDistancia(puntos, distancia) {
  if (puntos.length === 0) throw new Error('La polilínea no tiene puntos');
  if (distancia <= 0) return { ...puntos[0], rumbo: rumboEntre(puntos[0], puntos[1] ?? puntos[0]) };
  let restante = distancia;
  for (let i = 1; i < puntos.length; i++) {
    const tramo = distanciaMetros(puntos[i - 1], puntos[i]);
    if (restante <= tramo && tramo > 0) {
      const t = restante / tramo;
      return {
        lat: puntos[i - 1].lat + (puntos[i].lat - puntos[i - 1].lat) * t,
        lng: puntos[i - 1].lng + (puntos[i].lng - puntos[i - 1].lng) * t,
        rumbo: rumboEntre(puntos[i - 1], puntos[i]),
      };
    }
    restante -= tramo;
  }
  const ultimo = puntos[puntos.length - 1];
  return { ...ultimo, rumbo: rumboEntre(puntos[puntos.length - 2] ?? ultimo, ultimo) };
}

/** Rumbo en grados (0 = norte, 90 = este) entre dos puntos. */
export function rumboEntre(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/**
 * Proyecta un punto sobre la polilínea.
 * Devuelve el punto más cercano del trazado, a cuántos metros está y cuánto se ha
 * recorrido desde el inicio (progreso). Es la base del geofencing.
 */
export function proyectarEnPolilinea(puntos, p) {
  let mejor = { distancia: Infinity, progreso: 0, punto: puntos[0] };
  let acumulado = 0;
  // Aproximación plana local: suficiente para tramos de decenas de metros.
  const kx = Math.cos(rad(p.lat)) * 111320;
  const ky = 110540;
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1];
    const b = puntos[i];
    const ax = (a.lng - p.lng) * kx;
    const ay = (a.lat - p.lat) * ky;
    const bx = (b.lng - p.lng) * kx;
    const by = (b.lat - p.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const largo2 = dx * dx + dy * dy;
    const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / largo2));
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const d = Math.hypot(cx, cy);
    // El avance se mide con la misma fórmula que el largo del trazado (Haversine), para que
    // "progreso" y "largo" sean comparables al calcular llegadas.
    const tramo = distanciaMetros(a, b);
    if (d < mejor.distancia) {
      mejor = {
        distancia: d,
        progreso: acumulado + tramo * t,
        punto: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
      };
    }
    acumulado += tramo;
  }
  return mejor;
}

/**
 * Metros que le faltan a un vehículo para llegar a un paradero, siguiendo el trazado.
 * El colectivo hace ida y vuelta: si ya pasó el paradero en su sentido actual,
 * debe llegar al final del trazado y volver.
 *
 * @param {number} progreso  metros recorridos desde el inicio del trazado
 * @param {1|-1}  sentido   1 = ida (aumenta el progreso), -1 = vuelta
 * @param {number} paradero  posición del paradero en metros desde el inicio
 * @param {number} largo     largo total del trazado
 */
export function distanciaHastaParadero(progreso, sentido, paradero, largo) {
  if (sentido === 1) {
    return paradero >= progreso ? paradero - progreso : largo - progreso + (largo - paradero);
  }
  return paradero <= progreso ? progreso - paradero : progreso + paradero;
}

/** Minutos estimados de llegada dada una distancia y una velocidad promedio urbana. */
export function etaMinutos(distanciaM, velocidadKmh = 25) {
  if (velocidadKmh <= 0) return null;
  return Math.max(1, Math.round(distanciaM / ((velocidadKmh * 1000) / 60)));
}
