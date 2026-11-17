/**
 * Trazados (recorridos fijos autorizados): lectura con caché en memoria y escritura
 * transaccional. La polilínea se consulta en cada cálculo de geocerca y ETA, por eso se
 * mantiene cargada; cualquier cambio del sindicato invalida la caché.
 */
import { sql, transaccion } from '../db/sql.js';
import { largoPolilinea, proyectarEnPolilinea } from '../lib/geo.js';
import { noEncontrado, conflicto } from '../middleware/errores.js';

const cache = new Map();

function cargar(id) {
  const trazado = sql('SELECT id, codigo, nombre, comuna, color, tarifa, largo_m, activo FROM trazados WHERE id = ?').get(id);
  if (!trazado) return null;
  const puntos = sql('SELECT lat, lng FROM puntos_trazado WHERE trazado_id = ? ORDER BY orden').all(id);
  const paraderos = sql('SELECT id, nombre, lat, lng, progreso_m, orden FROM paraderos WHERE trazado_id = ? ORDER BY orden').all(id);
  return { ...trazado, activo: Boolean(trazado.activo), puntos, paraderos };
}

/** Trazado completo (con polilínea y paraderos) o error 404. */
export function obtenerTrazado(id) {
  if (!cache.has(id)) {
    const t = cargar(id);
    if (!t) throw noEncontrado('El trazado');
    cache.set(id, t);
  }
  return cache.get(id);
}

export function listarTrazados({ soloActivos = false } = {}) {
  const filas = sql(
    `SELECT t.id, t.codigo, t.nombre, t.comuna, t.color, t.tarifa, t.largo_m, t.activo,
            (SELECT COUNT(*) FROM vehiculos v WHERE v.trazado_id = t.id) AS vehiculos,
            (SELECT COUNT(*) FROM paraderos p WHERE p.trazado_id = t.id) AS paraderos
       FROM trazados t
      WHERE (? = 0 OR t.activo = 1)
      ORDER BY t.codigo`,
  ).all(soloActivos ? 1 : 0);
  return filas.map((f) => ({ ...f, activo: Boolean(f.activo) }));
}

function guardarGeometria(trazadoId, puntos, paraderos) {
  sql('DELETE FROM puntos_trazado WHERE trazado_id = ?').run(trazadoId);
  sql('DELETE FROM paraderos WHERE trazado_id = ?').run(trazadoId);
  const insertarPunto = sql('INSERT INTO puntos_trazado (trazado_id, orden, lat, lng) VALUES (?, ?, ?, ?)');
  puntos.forEach((p, i) => insertarPunto.run(trazadoId, i, p.lat, p.lng));
  const insertarParadero = sql('INSERT INTO paraderos (trazado_id, orden, nombre, lat, lng, progreso_m) VALUES (?, ?, ?, ?, ?, ?)');
  // Cada paradero se ubica sobre el trazado y se ordena según su avance en la ruta.
  paraderos
    .map((p) => {
      const proyeccion = proyectarEnPolilinea(puntos, p);
      return { nombre: p.nombre, lat: proyeccion.punto.lat, lng: proyeccion.punto.lng, progreso: Math.round(proyeccion.progreso) };
    })
    .sort((a, b) => a.progreso - b.progreso)
    .forEach((p, i) => insertarParadero.run(trazadoId, i, p.nombre, p.lat, p.lng, p.progreso));
  sql('UPDATE trazados SET largo_m = ? WHERE id = ?').run(Math.round(largoPolilinea(puntos)), trazadoId);
}

export function crearTrazado({ codigo, nombre, comuna, color, tarifa, activo = true, puntos, paraderos }) {
  return transaccion(() => {
    if (sql('SELECT 1 FROM trazados WHERE codigo = ?').get(codigo)) throw conflicto('Ya existe un trazado con ese código', 'codigo_duplicado');
    const { lastInsertRowid } = sql('INSERT INTO trazados (codigo, nombre, comuna, color, tarifa, activo) VALUES (?, ?, ?, ?, ?, ?)').run(
      codigo, nombre, comuna, color, tarifa, activo ? 1 : 0,
    );
    const id = Number(lastInsertRowid);
    guardarGeometria(id, puntos, paraderos);
    return obtenerTrazado(id);
  });
}

export function actualizarTrazado(id, cambios) {
  return transaccion(() => {
    const actual = sql('SELECT id FROM trazados WHERE id = ?').get(id);
    if (!actual) throw noEncontrado('El trazado');
    if (cambios.codigo && sql('SELECT 1 FROM trazados WHERE codigo = ? AND id <> ?').get(cambios.codigo, id)) {
      throw conflicto('Ya existe un trazado con ese código', 'codigo_duplicado');
    }
    const previo = cargar(id);
    const nuevo = { ...previo, ...cambios };
    sql('UPDATE trazados SET codigo = ?, nombre = ?, comuna = ?, color = ?, tarifa = ?, activo = ? WHERE id = ?').run(
      nuevo.codigo, nuevo.nombre, nuevo.comuna, nuevo.color, nuevo.tarifa, nuevo.activo ? 1 : 0, id,
    );
    if (cambios.puntos) {
      if (sql('SELECT 1 FROM turnos WHERE trazado_id = ? AND fin IS NULL').get(id)) {
        throw conflicto('No se puede cambiar el recorrido mientras hay colectivos en turno', 'trazado_en_uso');
      }
      guardarGeometria(id, cambios.puntos, cambios.paraderos ?? previo.paraderos);
    }
    cache.delete(id);
    return obtenerTrazado(id);
  });
}

export function eliminarTrazado(id) {
  return transaccion(() => {
    if (!sql('SELECT 1 FROM trazados WHERE id = ?').get(id)) throw noEncontrado('El trazado');
    if (sql('SELECT 1 FROM vehiculos WHERE trazado_id = ?').get(id)) {
      throw conflicto('El trazado tiene vehículos asignados. Reasígnalos o desactívalo.', 'trazado_en_uso');
    }
    if (sql('SELECT 1 FROM turnos WHERE trazado_id = ?').get(id)) {
      throw conflicto('El trazado tiene historial de turnos. Desactívalo en lugar de eliminarlo.', 'trazado_con_historial');
    }
    sql('DELETE FROM trazados WHERE id = ?').run(id);
    cache.delete(id);
  });
}

export const limpiarCacheTrazados = () => cache.clear();
