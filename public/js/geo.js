/** Cálculos de llegada en el navegador (mismas reglas que src/lib/geo.js del servidor). */

export function distanciaHastaParadero(progreso, sentido, paradero, largo) {
  if (sentido === 1) return paradero >= progreso ? paradero - progreso : largo - progreso + (largo - paradero);
  return paradero <= progreso ? progreso - paradero : progreso + paradero;
}

export function etaMinutos(distanciaM, velocidadKmh = 25) {
  return Math.max(1, Math.round(distanciaM / ((velocidadKmh * 1000) / 60)));
}
