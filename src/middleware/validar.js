/**
 * Validación de entradas con esquemas (Zod). Ninguna ruta procesa datos sin validar:
 * tipos estrictos, largos acotados y campos desconocidos rechazados.
 */
import { z } from 'zod';
import { invalido } from './errores.js';
import { validarRut, limpiarRut } from '../lib/rut.js';
import { validarPatente, limpiarPatente } from '../lib/patente.js';

/** Middleware: valida body, params y query; deja los datos ya normalizados en req.datos. */
export function validar({ body, params, query } = {}) {
  return (req, res, next) => {
    const datos = {};
    const problemas = [];
    for (const [origen, esquema] of [['body', body], ['params', params], ['query', query]]) {
      if (!esquema) continue;
      const resultado = esquema.safeParse(req[origen] ?? {});
      if (resultado.success) datos[origen] = resultado.data;
      else for (const p of resultado.error.issues) problemas.push({ campo: p.path.join('.') || origen, mensaje: p.message });
    }
    if (problemas.length) return next(invalido('Revisa los datos enviados', problemas));
    req.datos = datos;
    next();
  };
}

// ---- Piezas reutilizables -------------------------------------------------

export const id = z.coerce.number({ error: 'Identificador inválido' }).int().positive();
export const paramsId = z.strictObject({ id });

export const texto = (min, max, nombre = 'El texto') =>
  z
    .string({ error: `${nombre} es obligatorio` })
    .trim()
    .min(min, `${nombre} debe tener al menos ${min} caracteres`)
    .max(max, `${nombre} no puede superar ${max} caracteres`);

export const email = z
  .string({ error: 'El correo es obligatorio' })
  .trim()
  .toLowerCase()
  .max(120, 'El correo es demasiado largo')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'El correo no tiene un formato válido');

/** Política de contraseñas: 10 a 72 caracteres con letras y números (72 = límite de bcrypt). */
export const contrasena = z
  .string({ error: 'La contraseña es obligatoria' })
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(72, 'La contraseña no puede superar 72 caracteres')
  .regex(/[A-Za-zÁÉÍÓÚáéíóúÑñ]/, 'La contraseña debe incluir al menos una letra')
  .regex(/\d/, 'La contraseña debe incluir al menos un número');

export const rut = z
  .string({ error: 'El RUT es obligatorio' })
  .max(14, 'El RUT no es válido')
  .refine(validarRut, 'El RUT no es válido (revisa el dígito verificador)')
  .transform(limpiarRut);

export const patente = z
  .string({ error: 'La patente es obligatoria' })
  .max(10, 'La patente no es válida')
  .refine(validarPatente, 'La patente no es válida (ejemplos: BBCL12 o AB1234)')
  .transform(limpiarPatente);

export const telefono = z
  .string()
  .trim()
  .regex(/^\+?\d{8,12}$/, 'El teléfono debe tener entre 8 y 12 dígitos')
  .optional()
  .or(z.literal('').transform(() => undefined));

export const latitud = z.number({ error: 'Latitud inválida' }).min(-90).max(90);
export const longitud = z.number({ error: 'Longitud inválida' }).min(-180).max(180);
export const colorHex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'El color debe tener formato #RRGGBB');

export { z };
