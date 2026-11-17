/** Límites de solicitudes: frenan fuerza bruta de contraseñas y abuso de la API (OWASP A07). */
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config.js';

const respuesta = (mensaje) => (req, res) =>
  res.status(429).json({ error: { codigo: 'demasiados_intentos', mensaje } });

const omitir = () => !config.limites.activos;

/** Máximo de intentos FALLIDOS de inicio de sesión por minuto para una misma cuenta e IP. */
export const limiteLogin = rateLimit({
  windowMs: 60 * 1000,
  limit: config.limites.loginPorMinuto,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: omitir,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? '').trim().toLowerCase()}`,
  handler: respuesta('Demasiados intentos fallidos. Espera un minuto antes de volver a intentar.'),
});

/** Tope por IP para el conjunto de rutas de autenticación (frena probar muchas cuentas). */
export const limiteAutenticacion = rateLimit({
  windowMs: 60 * 1000,
  limit: config.limites.autenticacionPorMinuto,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: omitir,
  handler: respuesta('Demasiadas solicitudes de autenticación. Espera un minuto.'),
});

/** Tope general de la API por IP. */
export const limiteApi = rateLimit({
  windowMs: 60 * 1000,
  limit: config.limites.apiPorMinuto,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: omitir,
  handler: respuesta('Demasiadas solicitudes. Espera un momento.'),
});
