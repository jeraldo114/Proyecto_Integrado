/**
 * Cliente de la API.
 * - El token de acceso vive solo en memoria (no en localStorage): si alguien inyectara
 *   código en la página no encontraría un token guardado que robar.
 * - Cuando el token expira se renueva solo, usando la cookie httpOnly de refresh.
 */

export class ErrorApi extends Error {
  constructor(estado, cuerpo) {
    super(cuerpo?.error?.mensaje ?? 'No pudimos completar la acción');
    this.estado = estado;
    this.codigo = cuerpo?.error?.codigo ?? 'error';
    this.detalles = cuerpo?.error?.detalles ?? [];
  }
}

/** Sin conexión con el servidor (se usa para el modo sin señal del conductor). */
export class ErrorRed extends Error {
  constructor() {
    super('Sin conexión. Revisa tu señal e inténtalo de nuevo.');
    this.codigo = 'sin_conexion';
  }
}

const estado = { token: null, usuario: null, renovando: null };
const oyentes = new Set();

export const sesion = {
  get usuario() {
    return estado.usuario;
  },
  get token() {
    return estado.token;
  },
  alCambiar(fn) {
    oyentes.add(fn);
    return () => oyentes.delete(fn);
  },
};

function fijarSesion(datos) {
  estado.token = datos?.access_token ?? null;
  estado.usuario = datos?.usuario ?? null;
  // Solo se recuerda el ROL de esta pestaña (no es un secreto) para saber qué sesión renovar.
  if (estado.usuario) sessionStorage.setItem('rol', estado.usuario.rol);
  else sessionStorage.removeItem('rol');
  for (const fn of oyentes) fn(estado.usuario);
}

async function enviar(metodo, ruta, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      method: metodo,
      headers: {
        ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(estado.token ? { Authorization: `Bearer ${estado.token}` } : {}),
      },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ErrorRed();
  }
  if (respuesta.status === 204) return null;
  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    /* respuesta sin cuerpo JSON */
  }
  if (!respuesta.ok) throw new ErrorApi(respuesta.status, datos);
  return datos;
}

/** Renueva el token de acceso. Varias llamadas simultáneas comparten una sola renovación. */
export function renovar() {
  estado.renovando ??= (async () => {
    try {
      const rol = sessionStorage.getItem('rol') ?? undefined;
      fijarSesion(await enviar('POST', '/auth/refresh', rol ? { rol } : {}));
      return true;
    } catch (error) {
      if (error instanceof ErrorRed) throw error;
      fijarSesion(null);
      return false;
    } finally {
      estado.renovando = null;
    }
  })();
  return estado.renovando;
}

async function pedir(metodo, ruta, cuerpo) {
  try {
    return await enviar(metodo, ruta, cuerpo);
  } catch (error) {
    const expirado = error instanceof ErrorApi && error.estado === 401 && !ruta.startsWith('/auth/');
    if (!expirado) throw error;
    if (await renovar()) return enviar(metodo, ruta, cuerpo);
    throw error;
  }
}

export const api = {
  get: (ruta) => pedir('GET', ruta),
  post: (ruta, cuerpo = {}) => pedir('POST', ruta, cuerpo),
  put: (ruta, cuerpo) => pedir('PUT', ruta, cuerpo),
  patch: (ruta, cuerpo) => pedir('PATCH', ruta, cuerpo),
  delete: (ruta) => pedir('DELETE', ruta),

  async iniciarSesion(email, contrasena) {
    const datos = await enviar('POST', '/auth/login', { email, contrasena });
    if (!datos.mfa_requerido) fijarSesion(datos);
    return datos;
  },
  async verificarCodigo(mfaToken, codigo) {
    fijarSesion(await enviar('POST', '/auth/mfa', { mfa_token: mfaToken, codigo }));
  },
  async registrar(datos) {
    fijarSesion(await enviar('POST', '/auth/registro', datos));
  },
  async cerrarSesion() {
    const rol = estado.usuario?.rol;
    try {
      await enviar('POST', '/auth/logout', rol ? { rol } : {});
    } catch {
      /* aunque falle la red, se cierra la sesión local */
    }
    fijarSesion(null);
  },
  salud: () => enviar('GET', '/salud'),
};
