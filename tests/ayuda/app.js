/** Utilidades compartidas por las pruebas de integración. */
import './entorno.js';
import request from 'supertest';
import { crearApp } from '../../src/app.js';
import { sql } from '../../src/db/sql.js';
import { sembrar, CLAVE_DEMO, CUENTAS_DEMO } from '../../src/db/seed.js';
import { descifrar } from '../../src/lib/cifrado.js';
import { totp } from '../../src/lib/totp.js';

export { CLAVE_DEMO, CUENTAS_DEMO };

/** Aplicación con los datos de demostración cargados en memoria. */
export async function prepararApp() {
  await sembrar({ reiniciar: true });
  return crearApp();
}

/** Inicia sesión y devuelve el token de acceso (resuelve el segundo factor del administrador). */
export async function entrar(app, email, contrasena = CLAVE_DEMO) {
  const res = await request(app).post('/api/auth/login').send({ email, contrasena });
  if (res.body.mfa_requerido) {
    const { mfa_secreto } = sql('SELECT mfa_secreto FROM usuarios WHERE email = ?').get(email);
    const verificado = await request(app)
      .post('/api/auth/mfa')
      .send({ mfa_token: res.body.mfa_token, codigo: totp(descifrar(mfa_secreto)) });
    return verificado.body.access_token;
  }
  if (!res.body.access_token) throw new Error(`No se pudo iniciar sesión con ${email}: ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

/** Cliente autenticado: api(token).get('/ruta'), .post('/ruta', cuerpo), etc. */
export function cliente(app, token) {
  const con = (pedido) => (token ? pedido.set('Authorization', `Bearer ${token}`) : pedido);
  return {
    get: (ruta) => con(request(app).get(`/api${ruta}`)),
    post: (ruta, cuerpo = {}) => con(request(app).post(`/api${ruta}`)).send(cuerpo),
    put: (ruta, cuerpo = {}) => con(request(app).put(`/api${ruta}`)).send(cuerpo),
    patch: (ruta, cuerpo = {}) => con(request(app).patch(`/api${ruta}`)).send(cuerpo),
    delete: (ruta) => con(request(app).delete(`/api${ruta}`)),
  };
}

export const idDe = (email) => sql('SELECT id FROM usuarios WHERE email = ?').get(email).id;
export const saldoDe = (email) => sql('SELECT saldo FROM billeteras WHERE usuario_id = ?').get(idDe(email)).saldo;
export const vehiculoDe = (email) => sql('SELECT * FROM vehiculos WHERE conductor_id = ?').get(idDe(email));
