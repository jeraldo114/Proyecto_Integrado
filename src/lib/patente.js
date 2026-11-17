/** Validación de placas patentes chilenas (formato antiguo AA1234 y actual BBBB12). */

export function limpiarPatente(patente) {
  return String(patente ?? '')
    .replace(/[\s.\-·]/g, '')
    .toUpperCase();
}

const ANTIGUA = /^[A-Z]{2}\d{4}$/;
// El formato actual no usa vocales ni las letras M, N, Ñ y Q.
const ACTUAL = /^[BCDFGHJKLPRSTVWXYZ]{4}\d{2}$/;

export function validarPatente(patente) {
  const p = limpiarPatente(patente);
  return ANTIGUA.test(p) || ACTUAL.test(p);
}

/** BBBB12 -> BB·BB·12 (como se lee en la placa). */
export function formatearPatente(patente) {
  const p = limpiarPatente(patente);
  return p.length === 6 ? `${p.slice(0, 2)}·${p.slice(2, 4)}·${p.slice(4)}` : p;
}
