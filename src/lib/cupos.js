/** Reglas de negocio de los cupos (asientos disponibles) de un colectivo. */

export class ErrorCupos extends Error {}

/** Verifica que la cantidad de cupos sea un entero entre 0 y la capacidad del vehículo. */
export function validarCupos(cupos, capacidadMaxima) {
  if (!Number.isInteger(cupos)) throw new ErrorCupos('Los cupos deben ser un número entero');
  if (cupos < 0) throw new ErrorCupos('Los cupos no pueden ser negativos');
  if (cupos > capacidadMaxima) throw new ErrorCupos(`El vehículo solo tiene ${capacidadMaxima} asientos`);
  return cupos;
}

/** Cupos que quedan cuando suben pasajeros. Ej.: capacidad 4, suben 2 => quedan 2. */
export function cuposTrasSubida(cuposActuales, suben) {
  if (!Number.isInteger(suben) || suben < 0) throw new ErrorCupos('Cantidad de pasajeros inválida');
  if (suben > cuposActuales) throw new ErrorCupos('No hay asientos suficientes');
  return cuposActuales - suben;
}

/** Cupos que quedan cuando bajan pasajeros, sin superar la capacidad. */
export function cuposTrasBajada(cuposActuales, bajan, capacidadMaxima) {
  if (!Number.isInteger(bajan) || bajan < 0) throw new ErrorCupos('Cantidad de pasajeros inválida');
  return Math.min(capacidadMaxima, cuposActuales + bajan);
}

/** Estado que ve el pasajero. Un vehículo lleno se muestra en gris y no recibe avisos. */
export function estadoCupos(cupos) {
  if (cupos <= 0) return 'lleno';
  if (cupos === 1) return 'ultimo';
  return 'disponible';
}

export const recibeAvisos = (cupos) => cupos > 0;

/** Porcentaje de ocupación de un conjunto de vehículos en recorrido. */
export function ocupacion(vehiculos) {
  const capacidad = vehiculos.reduce((s, v) => s + v.capacidad, 0);
  if (capacidad === 0) return 0;
  const ocupados = vehiculos.reduce((s, v) => s + (v.capacidad - v.cupos), 0);
  return Math.round((ocupados / capacidad) * 100);
}
