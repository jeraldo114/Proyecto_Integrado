/**
 * Simulador de GPS para la demostración.
 * En la calle, la posición la envía el teléfono del conductor (POST /api/turno/ubicacion).
 * En la sala de clases no hay autos moviéndose, así que este módulo hace avanzar por su
 * trazado a cada vehículo en turno, igual que lo haría el GPS real.
 *
 * "Flota de demostración": conductores ficticios que inician turno solos y cuyos cupos
 * cambian de vez en cuando, para que el mapa del pasajero tenga movimiento.
 */
import { sql } from '../db/sql.js';
import { config } from '../config.js';
import * as flota from './flota.js';
import { obtenerTrazado } from './trazados.js';
import { iniciarTurno, actualizarCupos } from './turnos.js';

export const DOMINIO_DEMO = '@flota-demo.cl';

/** Calcula el siguiente punto de un vehículo que va y vuelve por su trazado. */
export function avanzar({ progreso, sentido }, metros, largo) {
  let p = progreso + metros * sentido;
  let s = sentido;
  if (p >= largo) {
    p = largo - (p - largo);
    s = -1;
  } else if (p <= 0) {
    p = -p;
    s = 1;
  }
  return { progreso: Math.max(0, Math.min(largo, p)), sentido: s };
}

const velocidades = new Map(); // vehiculo_id -> km/h actual (varía suavemente)

function paso(segundos) {
  for (const v of flota.todos()) {
    if (v.origen !== 'simulado') continue;
    const trazado = obtenerTrazado(v.trazado_id);
    if (trazado.largo_m <= 0) continue;
    const previa = velocidades.get(v.vehiculo_id) ?? 30;
    const velocidad = Math.max(14, Math.min(48, previa + (Math.random() - 0.5) * 8));
    velocidades.set(v.vehiculo_id, velocidad);
    const siguiente = avanzar({ progreso: v.progreso_m, sentido: v.sentido }, (velocidad / 3.6) * segundos, trazado.largo_m);
    flota.moverSimulado(v.vehiculo_id, { ...siguiente, velocidad });
  }
}

function conductoresDemo() {
  return sql(
    `SELECT u.id, u.nombre, u.email, u.rol, u.estado
       FROM usuarios u JOIN vehiculos v ON v.conductor_id = u.id
      WHERE u.rol = 'conductor' AND u.estado = 'activo' AND v.estado = 'validado' AND u.email LIKE ?`,
  ).all(`%${DOMINIO_DEMO}`);
}

/** Pone en recorrido a la flota de demostración, repartida a lo largo de sus trazados. */
export function activarFlotaDemo() {
  let activados = 0;
  for (const conductor of conductoresDemo()) {
    const abierto = sql('SELECT vehiculo_id FROM turnos WHERE conductor_id = ? AND fin IS NULL').get(conductor.id);
    let vehiculoId = abierto?.vehiculo_id;
    if (!abierto) {
      try {
        vehiculoId = iniciarTurno(conductor).vehiculo_id;
        activados++;
      } catch {
        continue;
      }
    }
    const vivo = flota.obtener(vehiculoId);
    if (!vivo) continue;
    const largo = obtenerTrazado(vivo.trazado_id).largo_m;
    flota.moverSimulado(vehiculoId, { progreso: Math.random() * largo, sentido: Math.random() < 0.5 ? 1 : -1, velocidad: 30 });
    const cupos = Math.floor(Math.random() * (vivo.capacidad + 1));
    actualizarCupos(conductor, cupos);
  }
  return activados;
}

/** Simula que suben o bajan pasajeros en la flota de demostración. */
function variarCuposDemo() {
  const candidatos = conductoresDemo();
  if (!candidatos.length) return;
  const conductor = candidatos[Math.floor(Math.random() * candidatos.length)];
  const turno = sql('SELECT vehiculo_id, cupos_disponibles FROM turnos WHERE conductor_id = ? AND fin IS NULL').get(conductor.id);
  if (!turno) return;
  const vivo = flota.obtener(turno.vehiculo_id);
  if (!vivo) return;
  const cambio = Math.random() < 0.5 ? -1 : 1;
  const cupos = Math.max(0, Math.min(vivo.capacidad, turno.cupos_disponibles + cambio));
  if (cupos !== turno.cupos_disponibles) actualizarCupos(conductor, cupos);
}

export function iniciarSimulador() {
  const intervalo = config.tiempoReal.intervaloMs;
  const temporizadores = [setInterval(() => paso(intervalo / 1000), intervalo)];
  if (config.tiempoReal.flotaDemo) {
    activarFlotaDemo();
    temporizadores.push(setInterval(variarCuposDemo, 7000));
  }
  for (const t of temporizadores) t.unref();
  return { detener: () => temporizadores.forEach(clearInterval) };
}
