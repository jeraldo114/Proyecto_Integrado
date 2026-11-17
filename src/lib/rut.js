/** Validación del RUT chileno (algoritmo módulo 11). */

/** Quita puntos, guion y espacios; deja el dígito verificador en mayúscula. */
export function limpiarRut(rut) {
  return String(rut ?? '')
    .replace(/[.\-\s]/g, '')
    .toUpperCase();
}

/** Calcula el dígito verificador para el cuerpo numérico de un RUT. */
export function digitoVerificador(cuerpo) {
  let suma = 0;
  let factor = 2;
  for (const d of String(cuerpo).split('').reverse()) {
    suma += Number(d) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

export function validarRut(rut) {
  const limpio = limpiarRut(rut);
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;
  const cuerpo = limpio.slice(0, -1);
  if (/^0+$/.test(cuerpo)) return false;
  return digitoVerificador(cuerpo) === limpio.slice(-1);
}

/** 12345678K -> 12.345.678-K */
export function formatearRut(rut) {
  const limpio = limpiarRut(rut);
  if (limpio.length < 2) return limpio;
  const cuerpo = limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${limpio.slice(-1)}`;
}

/** Muestra solo el final del RUT: ••.•••.678-K (minimización de datos en pantallas). */
export function enmascararRut(rut) {
  const limpio = limpiarRut(rut);
  if (limpio.length < 5) return '••••';
  return `••.•••.${limpio.slice(-4, -1)}-${limpio.slice(-1)}`;
}
