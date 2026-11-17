/**
 * Autenticación (¿quién eres?) y autorización por rol (¿qué puedes hacer?).
 * Principio de mínimo privilegio: cada ruta declara los roles permitidos y todo
 * lo demás responde 403. Mitiga OWASP A01 (Broken Access Control).
 */
import { sql } from '../db/sql.js';
import { verificarToken } from '../services/sesiones.js';
import { noAutenticado, prohibido } from './errores.js';
import { auditar } from '../services/auditoria.js';

export const ROLES = Object.freeze({ ADMIN: 'admin', CONDUCTOR: 'conductor', PASAJERO: 'pasajero' });

/** Exige un token de acceso válido en la cabecera Authorization: Bearer <token>. */
export function autenticar(req, res, next) {
  const cabecera = req.get('authorization') ?? '';
  const [esquema, token] = cabecera.split(' ');
  if (esquema !== 'Bearer' || !token) return next(noAutenticado());
  const datos = verificarToken(token, 'acceso');
  // Se consulta el estado actual: una cuenta suspendida pierde el acceso de inmediato,
  // aunque su token todavía no haya expirado.
  const usuario = sql('SELECT id, nombre, email, rol, estado FROM usuarios WHERE id = ?').get(datos.id);
  if (!usuario) return next(noAutenticado());
  if (usuario.estado === 'suspendido') return next(prohibido('Tu cuenta está suspendida. Contacta a tu sindicato.'));
  req.usuario = usuario;
  next();
}

/** Restringe la ruta a los roles indicados. */
export function autorizar(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return next(noAutenticado());
    if (!roles.includes(req.usuario.rol)) {
      auditar(req, 'acceso_denegado', req.originalUrl.split('?')[0], { metodo: req.method, rol: req.usuario.rol });
      return next(prohibido());
    }
    next();
  };
}
