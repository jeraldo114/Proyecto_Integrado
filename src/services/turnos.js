/**
 * Turnos del conductor. El turno delimita la transmisión de ubicación:
 * solo se rastrea al vehículo entre "Iniciar turno" y "Fin de turno" (privacidad laboral).
 */
import { sql, transaccion, ahoraIso } from '../db/sql.js';
import { validarCupos, ErrorCupos } from '../lib/cupos.js';
import { conflicto, invalido, noEncontrado, prohibido } from '../middleware/errores.js';
import * as flota from './flota.js';

const vehiculoDe = (conductorId) =>
  sql(
    `SELECT v.id, v.patente, v.marca, v.modelo, v.anio, v.capacidad_maxima, v.trazado_id, v.estado,
            t.codigo AS trazado_codigo, t.nombre AS trazado_nombre, t.tarifa, t.color, t.activo AS trazado_activo
       FROM vehiculos v JOIN trazados t ON t.id = v.trazado_id
      WHERE v.conductor_id = ?`,
  ).get(conductorId);

const turnoAbierto = (conductorId) =>
  sql('SELECT id, vehiculo_id, conductor_id, trazado_id, cupos_disponibles, inicio FROM turnos WHERE conductor_id = ? AND fin IS NULL').get(conductorId);

/** Estado que necesita la pantalla del conductor. */
export function estadoConductor(conductor) {
  const vehiculo = vehiculoDe(conductor.id) ?? null;
  const turno = turnoAbierto(conductor.id) ?? null;
  const vivo = vehiculo ? flota.obtener(vehiculo.id) : null;
  return {
    vehiculo,
    turno,
    en_recorrido: Boolean(turno),
    posicion: vivo ? { lat: vivo.lat, lng: vivo.lng, origen: vivo.origen, fuera_de_ruta: vivo.fuera_de_ruta } : null,
  };
}

/** Inicia el turno. Solo vehículos validados por el sindicato pueden operar (REQ-F01). */
export function iniciarTurno(conductor, { origen = 'simulado' } = {}) {
  const vehiculo = vehiculoDe(conductor.id);
  if (!vehiculo) throw conflicto('Aún no tienes un vehículo asignado. Contacta a tu sindicato.', 'sin_vehiculo');
  if (conductor.estado !== 'activo') throw prohibido('Tu cuenta aún no ha sido validada por el sindicato.');
  if (vehiculo.estado !== 'validado') throw conflicto('Tu vehículo aún no ha sido validado por el sindicato.', 'vehiculo_no_validado');
  if (!vehiculo.trazado_activo) throw conflicto('El trazado de tu vehículo no está activo.', 'trazado_inactivo');

  const turno = transaccion(() => {
    if (turnoAbierto(conductor.id)) throw conflicto('Ya tienes un turno en curso.', 'turno_abierto');
    const { lastInsertRowid } = sql(
      'INSERT INTO turnos (vehiculo_id, conductor_id, trazado_id, cupos_disponibles) VALUES (?, ?, ?, ?)',
    ).run(vehiculo.id, conductor.id, vehiculo.trazado_id, vehiculo.capacidad_maxima);
    return sql('SELECT id, vehiculo_id, conductor_id, trazado_id, cupos_disponibles, inicio FROM turnos WHERE id = ?').get(lastInsertRowid);
  });
  flota.entrar({ turno, vehiculo, conductor, origen });
  return turno;
}

/** Finaliza el turno: el rastreo se corta de inmediato. */
export function finalizarTurno(conductor) {
  const turno = turnoAbierto(conductor.id);
  if (!turno) throw conflicto('No tienes un turno en curso.', 'sin_turno');
  sql('UPDATE turnos SET fin = ? WHERE id = ?').run(ahoraIso(), turno.id);
  flota.salir(turno.vehiculo_id);
  const resumen = sql('SELECT COUNT(*) AS pagos, COALESCE(SUM(monto), 0) AS total FROM pagos WHERE turno_id = ?').get(turno.id);
  return { turno_id: turno.id, ...resumen };
}

/** El conductor informa cuántos asientos libres lleva (0 = lleno). */
export function actualizarCupos(conductor, cupos) {
  const turno = turnoAbierto(conductor.id);
  if (!turno) throw conflicto('Debes iniciar tu turno para informar cupos.', 'sin_turno');
  const vehiculo = sql('SELECT capacidad_maxima FROM vehiculos WHERE id = ?').get(turno.vehiculo_id);
  try {
    validarCupos(cupos, vehiculo.capacidad_maxima);
  } catch (e) {
    if (e instanceof ErrorCupos) throw invalido(e.message);
    throw e;
  }
  sql('UPDATE turnos SET cupos_disponibles = ? WHERE id = ?').run(cupos, turno.id);
  flota.cambiarCupos(turno.vehiculo_id, cupos);
  return { cupos, capacidad: vehiculo.capacidad_maxima };
}

/** Al reiniciar el servidor, los turnos abiertos vuelven al mapa (continuidad operacional). */
export function restaurarTurnosAbiertos() {
  const abiertos = sql(
    `SELECT tu.id, tu.vehiculo_id, tu.conductor_id, tu.trazado_id, tu.cupos_disponibles, tu.inicio,
            v.patente, v.marca, v.modelo, v.capacidad_maxima, u.nombre
       FROM turnos tu JOIN vehiculos v ON v.id = tu.vehiculo_id JOIN usuarios u ON u.id = tu.conductor_id
      WHERE tu.fin IS NULL`,
  ).all();
  for (const t of abiertos) {
    flota.entrar({
      turno: t,
      vehiculo: { id: t.vehiculo_id, patente: t.patente, marca: t.marca, modelo: t.modelo, capacidad_maxima: t.capacidad_maxima, trazado_id: t.trazado_id },
      conductor: { id: t.conductor_id, nombre: t.nombre },
    });
  }
  return abiertos.length;
}

/** Recaudación del conductor: pagos del día y últimos cobros. */
export function recaudacion(conductorId) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const desde = hoy.toISOString();
  const totalHoy = sql('SELECT COUNT(*) AS pagos, COALESCE(SUM(monto), 0) AS total FROM pagos WHERE conductor_id = ? AND creado_en >= ?').get(conductorId, desde);
  const saldo = sql('SELECT saldo FROM billeteras WHERE usuario_id = ?').get(conductorId)?.saldo ?? 0;
  const ultimos = sql(
    `SELECT p.id, p.monto, p.creado_en, t.codigo AS trazado
       FROM pagos p JOIN trazados t ON t.id = p.trazado_id
      WHERE p.conductor_id = ? ORDER BY p.id DESC LIMIT 30`,
  ).all(conductorId);
  return { hoy: totalHoy, saldo, ultimos };
}

export function exigirVehiculo(id) {
  const v = sql('SELECT * FROM vehiculos WHERE id = ?').get(id);
  if (!v) throw noEncontrado('El vehículo');
  return v;
}
