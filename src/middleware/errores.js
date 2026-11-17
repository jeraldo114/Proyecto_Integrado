/** Errores de la API con un formato único: { error: { codigo, mensaje, detalles? } } */
import { config } from '../config.js';

export class ErrorHttp extends Error {
  constructor(estado, codigo, mensaje, detalles) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

export const noEncontrado = (que = 'Recurso') => new ErrorHttp(404, 'no_encontrado', `${que} no existe`);
export const conflicto = (mensaje, codigo = 'conflicto') => new ErrorHttp(409, codigo, mensaje);
export const prohibido = (mensaje = 'No tienes permiso para esta acción') => new ErrorHttp(403, 'prohibido', mensaje);
export const noAutenticado = (mensaje = 'Debes iniciar sesión') => new ErrorHttp(401, 'no_autenticado', mensaje);
export const invalido = (mensaje, detalles) => new ErrorHttp(400, 'datos_invalidos', mensaje, detalles);

export function rutaNoEncontrada(req, res) {
  res.status(404).json({ error: { codigo: 'no_encontrado', mensaje: 'Ruta no encontrada' } });
}

// eslint-disable-next-line no-unused-vars
export function manejadorErrores(error, req, res, next) {
  if (error instanceof ErrorHttp) {
    return res.status(error.estado).json({ error: { codigo: error.codigo, mensaje: error.message, detalles: error.detalles } });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { codigo: 'json_invalido', mensaje: 'El cuerpo de la solicitud no es JSON válido' } });
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: { codigo: 'muy_grande', mensaje: 'La solicitud es demasiado grande' } });
  }
  // Nunca se filtran detalles internos (trazas, SQL) al cliente: se registran en el servidor.
  if (!config.esPrueba) console.error('[error]', error);
  res.status(500).json({ error: { codigo: 'error_interno', mensaje: 'Ocurrió un error inesperado. Inténtalo nuevamente.' } });
}
