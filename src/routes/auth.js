/** Autenticación: registro, inicio de sesión, segundo factor, renovación y cierre de sesión. */
import { Router } from 'express';
import { config } from '../config.js';
import { sql } from '../db/sql.js';
import { descifrar } from '../lib/cifrado.js';
import { verificarTotp } from '../lib/totp.js';
import { autenticar } from '../middleware/auth.js';
import { noAutenticado, prohibido } from '../middleware/errores.js';
import { limiteLogin, limiteAutenticacion } from '../middleware/limites.js';
import { validar, z, texto, email, contrasena } from '../middleware/validar.js';
import { auditar } from '../services/auditoria.js';
import * as sesiones from '../services/sesiones.js';
import { buscarPorEmail, compararContrasena, compararSenuelo, crearUsuario, perfil } from '../services/usuarios.js';

export const rutasAuth = Router();
rutasAuth.use(limiteAutenticacion);

const ROLES = ['admin', 'conductor', 'pasajero'];
const nombreCookie = (rol) => `rt_${rol}`;

/**
 * El refresh token viaja en una cookie httpOnly: el JavaScript de la página no puede leerla
 * (protección ante XSS) y SameSite=Strict impide que otro sitio la use (protección CSRF).
 * Hay una cookie por rol para poder mostrar pasajero, conductor y sindicato a la vez en la demo.
 */
function opcionesCookie(expira) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.esProduccion,
    path: '/api/auth',
    ...(expira ? { expires: new Date(expira) } : {}),
  };
}

function leerCookies(req) {
  const salida = {};
  for (const parte of String(req.headers.cookie ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) salida[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return salida;
}

function abrirSesion(res, usuario) {
  const refresh = sesiones.crearRefresh(usuario.id);
  res.cookie(nombreCookie(usuario.rol), refresh.token, opcionesCookie(refresh.expira));
  return {
    access_token: sesiones.firmarAcceso(usuario),
    expira_en_segundos: config.jwt.minutosAcceso * 60,
    usuario: perfil(usuario),
  };
}

// ---- Registro de pasajeros (conductores y administradores los crea el sindicato) ----
rutasAuth.post(
  '/registro',
  validar({ body: z.strictObject({ nombre: texto(2, 80, 'El nombre'), email, contrasena }) }),
  async (req, res) => {
    const usuario = await crearUsuario({ ...req.datos.body, rol: 'pasajero' });
    req.usuario = usuario;
    auditar(req, 'registro', 'usuarios', { rol: 'pasajero' });
    res.status(201).json(abrirSesion(res, usuario));
  },
);

// ---- Inicio de sesión ----
rutasAuth.post(
  '/login',
  validar({ body: z.strictObject({ email, contrasena: z.string().min(1, 'La contraseña es obligatoria').max(72) }) }),
  limiteLogin,
  async (req, res) => {
    const { email: correo, contrasena: clave } = req.datos.body;
    const usuario = buscarPorEmail(correo);
    const coincide = usuario ? await compararContrasena(clave, usuario.hash_contrasena) : await compararSenuelo(clave);
    if (!usuario || !coincide) {
      auditar(req, 'login_fallido', 'sesiones', { email: correo });
      // Mensaje único: no revela si el correo existe.
      throw noAutenticado('Correo o contraseña incorrectos');
    }
    if (usuario.estado === 'suspendido') throw prohibido('Tu cuenta está suspendida. Contacta a tu sindicato.');

    if (usuario.mfa_secreto) {
      return res.json({ mfa_requerido: true, mfa_token: sesiones.firmarMfaPendiente(usuario) });
    }
    req.usuario = usuario;
    auditar(req, 'login', 'sesiones', {});
    res.json(abrirSesion(res, usuario));
  },
);

// ---- Segundo factor (obligatorio para administradores) ----
rutasAuth.post(
  '/mfa',
  validar({ body: z.strictObject({ mfa_token: z.string().min(10).max(600), email: email.optional(), codigo: z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos') }) }),
  limiteLogin,
  async (req, res) => {
    const datos = sesiones.verificarToken(req.datos.body.mfa_token, 'mfa');
    const usuario = sql('SELECT * FROM usuarios WHERE id = ?').get(datos.id);
    if (!usuario?.mfa_secreto || usuario.estado === 'suspendido') throw noAutenticado('Verificación no válida');
    if (!verificarTotp(descifrar(usuario.mfa_secreto), req.datos.body.codigo)) {
      auditar(req, 'mfa_fallido', 'sesiones', { usuario_id: usuario.id });
      throw noAutenticado('Código incorrecto o vencido');
    }
    req.usuario = usuario;
    auditar(req, 'login', 'sesiones', { mfa: true });
    res.json(abrirSesion(res, usuario));
  },
);

// ---- Renovación silenciosa del token de acceso ----
rutasAuth.post('/refresh', validar({ body: z.strictObject({ rol: z.enum(ROLES).optional() }) }), (req, res) => {
  const cookies = leerCookies(req);
  const disponibles = ROLES.filter((r) => cookies[nombreCookie(r)]);
  const rol = req.datos.body.rol ?? (disponibles.length === 1 ? disponibles[0] : null);
  const token = rol ? cookies[nombreCookie(rol)] : null;
  if (!token) throw noAutenticado('No hay una sesión activa');

  const resultado = sesiones.rotarRefresh(token);
  if (resultado.reutilizado) {
    res.clearCookie(nombreCookie(rol), opcionesCookie());
    auditar(req, 'refresh_reutilizado', 'sesiones', { usuario_id: resultado.usuarioId });
    throw noAutenticado('Detectamos un uso inusual de tu sesión. Inicia sesión nuevamente.');
  }
  const usuario = sql('SELECT * FROM usuarios WHERE id = ?').get(resultado.usuarioId);
  if (!usuario || usuario.estado === 'suspendido' || usuario.rol !== rol) {
    sesiones.revocarRefresh(resultado.nuevo.token);
    res.clearCookie(nombreCookie(rol), opcionesCookie());
    throw noAutenticado('Tu sesión ya no es válida');
  }
  res.cookie(nombreCookie(rol), resultado.nuevo.token, opcionesCookie(resultado.nuevo.expira));
  res.json({ access_token: sesiones.firmarAcceso(usuario), expira_en_segundos: config.jwt.minutosAcceso * 60, usuario: perfil(usuario) });
});

// ---- Cierre de sesión: revoca el refresh token en el servidor ----
rutasAuth.post('/logout', validar({ body: z.strictObject({ rol: z.enum(ROLES).optional() }) }), (req, res) => {
  const cookies = leerCookies(req);
  const roles = req.datos.body.rol ? [req.datos.body.rol] : ROLES;
  for (const rol of roles) {
    const token = cookies[nombreCookie(rol)];
    if (token) sesiones.revocarRefresh(token);
    res.clearCookie(nombreCookie(rol), opcionesCookie());
  }
  res.status(204).end();
});

rutasAuth.get('/yo', autenticar, (req, res) => {
  const usuario = sql('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
  res.json({ usuario: perfil(usuario) });
});
