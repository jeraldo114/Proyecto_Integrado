/**
 * Sesiones: token de acceso JWT de vida corta + refresh token rotativo y revocable.
 * - El JWT lleva solo lo mínimo (id, rol, nombre) y expira en 15 minutos.
 * - El refresh token es aleatorio; en la base se guarda solo su hash SHA-256.
 * - Cada uso lo rota. Si alguien presenta un token ya usado, se asume robo y
 *   se cierran todas las sesiones de ese usuario.
 */
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { sql, transaccion, ahoraIso } from '../db/sql.js';
import { sha256, tokenAleatorio } from '../lib/cifrado.js';
import { noAutenticado } from '../middleware/errores.js';

const ALGORITMO = 'HS256';
const GRACIA_ROTACION_MS = 15000;

export function firmarAcceso(usuario) {
  return jwt.sign({ rol: usuario.rol, nombre: usuario.nombre, tipo: 'acceso' }, config.jwt.secreto, {
    algorithm: ALGORITMO,
    subject: String(usuario.id),
    issuer: config.jwt.emisor,
    expiresIn: `${config.jwt.minutosAcceso}m`,
  });
}

export function firmarMfaPendiente(usuario) {
  return jwt.sign({ tipo: 'mfa' }, config.jwt.secreto, {
    algorithm: ALGORITMO,
    subject: String(usuario.id),
    issuer: config.jwt.emisor,
    expiresIn: `${config.jwt.minutosMfa}m`,
  });
}

/** Verifica firma, emisor, vigencia y tipo. El algoritmo se fija para impedir "alg: none". */
export function verificarToken(token, tipo) {
  try {
    const datos = jwt.verify(token, config.jwt.secreto, { algorithms: [ALGORITMO], issuer: config.jwt.emisor });
    if (datos.tipo !== tipo) throw new Error('tipo de token incorrecto');
    return { ...datos, id: Number(datos.sub) };
  } catch {
    throw noAutenticado(tipo === 'mfa' ? 'La verificación expiró. Inicia sesión nuevamente.' : 'Tu sesión expiró o no es válida');
  }
}

export function crearRefresh(usuarioId) {
  const token = tokenAleatorio(48);
  const expira = new Date(Date.now() + config.jwt.diasRefresh * 86400000).toISOString();
  sql('INSERT INTO refresh_tokens (usuario_id, token_hash, expira_en) VALUES (?, ?, ?)').run(usuarioId, sha256(token), expira);
  return { token, expira };
}

/** Canjea un refresh token por uno nuevo (rotación). Devuelve el id del usuario. */
export function rotarRefresh(token) {
  return transaccion(() => {
    const fila = sql('SELECT id, usuario_id, expira_en, rotado_en, revocado_en FROM refresh_tokens WHERE token_hash = ?').get(sha256(token));
    if (!fila) throw noAutenticado('Tu sesión expiró o no es válida');
    // Un token anulado (cierre de sesión, suspensión o robo) no sirve nunca más, sin excepciones.
    if (fila.revocado_en) throw noAutenticado('Tu sesión fue cerrada. Inicia sesión nuevamente.');
    if (fila.rotado_en) {
      // Margen de gracia: dos pestañas o una recarga rápida pueden canjear el mismo token
      // casi al mismo tiempo; eso no es un ataque.
      if (Date.now() - Date.parse(fila.rotado_en) <= GRACIA_ROTACION_MS) {
        return { usuarioId: fila.usuario_id, nuevo: crearRefresh(fila.usuario_id) };
      }
      // Reutilización tardía de un token ya canjeado: posible robo => se cierran todas las sesiones.
      revocarTodos(fila.usuario_id);
      return { reutilizado: true, usuarioId: fila.usuario_id };
    }
    if (fila.expira_en <= ahoraIso()) throw noAutenticado('Tu sesión expiró. Inicia sesión nuevamente.');
    sql('UPDATE refresh_tokens SET rotado_en = ? WHERE id = ?').run(ahoraIso(), fila.id);
    return { usuarioId: fila.usuario_id, nuevo: crearRefresh(fila.usuario_id) };
  });
}

/**
 * Cierre de sesión: anula el token presentado y también los que ese usuario canjeó hace
 * instantes, para que el margen de gracia no deje una puerta abierta tras salir.
 */
export function revocarRefresh(token) {
  const fila = sql('SELECT usuario_id FROM refresh_tokens WHERE token_hash = ?').get(sha256(token));
  if (!fila) return;
  const desde = new Date(Date.now() - GRACIA_ROTACION_MS).toISOString();
  sql(
    `UPDATE refresh_tokens SET revocado_en = ?
      WHERE usuario_id = ? AND revocado_en IS NULL AND (token_hash = ? OR rotado_en >= ?)`,
  ).run(ahoraIso(), fila.usuario_id, sha256(token), desde);
}

export function revocarTodos(usuarioId) {
  sql('UPDATE refresh_tokens SET revocado_en = ? WHERE usuario_id = ? AND revocado_en IS NULL').run(ahoraIso(), usuarioId);
}

/** Limpieza periódica de sesiones vencidas. */
export function purgarVencidos() {
  return sql('DELETE FROM refresh_tokens WHERE expira_en < ?').run(new Date(Date.now() - 86400000).toISOString()).changes;
}
