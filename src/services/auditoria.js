/**
 * Registro de auditoría en la base documental: quién hizo qué y cuándo.
 * El campo `detalle` es libre (cambia según la acción), por eso vive en NoSQL.
 * Nunca se registran contraseñas, tokens ni RUT completos.
 */
import { auditoria } from '../db/nosql.js';
import { config } from '../config.js';

export function auditar(req, accion, recurso, detalle = {}) {
  const documento = {
    accion,
    recurso,
    actor: req?.usuario ? { id: req.usuario.id, rol: req.usuario.rol, nombre: req.usuario.nombre } : null,
    detalle,
    ip: req?.ip ?? null,
    ts: new Date(),
  };
  // No bloquea la respuesta al usuario; si falla, se informa en el servidor.
  return auditoria.insertAsync(documento).catch((e) => {
    if (!config.esPrueba) console.error('[auditoria]', e.message);
  });
}

export async function ultimosEventos(limite = 50) {
  const docs = await auditoria.findAsync({}).sort({ ts: -1 }).limit(limite);
  return docs.map(({ _id, ...resto }) => ({ id: _id, ...resto }));
}
