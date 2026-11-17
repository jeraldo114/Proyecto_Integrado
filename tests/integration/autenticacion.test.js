/** Pruebas de integración: autenticación, sesiones y control de acceso por rol. */
import { prepararApp, entrar, cliente, CLAVE_DEMO, CUENTAS_DEMO, idDe } from '../ayuda/app.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { sql } from '../../src/db/sql.js';
import { auditoria } from '../../src/db/nosql.js';
import { descifrar } from '../../src/lib/cifrado.js';
import { totp } from '../../src/lib/totp.js';
import { config } from '../../src/config.js';

let app;
before(async () => {
  app = await prepararApp();
});

const cookieDe = (res, nombre) => (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${nombre}=`));
const valorCookie = (cookie) => cookie.split(';')[0];

describe('Registro de pasajeros', () => {
  test('crea la cuenta, entrega token y deja el refresh en cookie httpOnly + SameSite=Strict', async () => {
    const res = await request(app).post('/api/auth/registro').send({ nombre: 'Ana Pérez', email: 'ana@ejemplo.cl', contrasena: 'ClaveSegura2026' });
    assert.equal(res.status, 201);
    assert.ok(res.body.access_token);
    assert.equal(res.body.usuario.rol, 'pasajero');
    assert.equal(res.body.usuario.hash_contrasena, undefined, 'la respuesta no debe exponer el hash');
    const cookie = cookieDe(res, 'rt_pasajero');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\/api\/auth/i);
  });

  test('la contraseña se guarda con bcrypt, nunca en texto plano', () => {
    const { hash_contrasena } = sql('SELECT hash_contrasena FROM usuarios WHERE email = ?').get('ana@ejemplo.cl');
    assert.match(hash_contrasena, /^\$2[aby]\$\d{2}\$/);
    assert.ok(!hash_contrasena.includes('ClaveSegura2026'));
  });

  test('al registrarse el pasajero recibe su billetera en $0', () => {
    assert.equal(sql('SELECT saldo FROM billeteras WHERE usuario_id = ?').get(idDe('ana@ejemplo.cl')).saldo, 0);
  });

  test('rechaza un correo ya registrado (409)', async () => {
    const res = await request(app).post('/api/auth/registro').send({ nombre: 'Otra Ana', email: 'ANA@ejemplo.cl', contrasena: 'ClaveSegura2026' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.codigo, 'email_duplicado');
  });

  test('rechaza contraseñas débiles y explica por qué (400)', async () => {
    const res = await request(app).post('/api/auth/registro').send({ nombre: 'Leo', email: 'leo@ejemplo.cl', contrasena: 'corta' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.detalles.some((d) => d.campo === 'contrasena'));
  });

  test('nadie puede registrarse a sí mismo como administrador (campo desconocido => 400)', async () => {
    const res = await request(app).post('/api/auth/registro').send({ nombre: 'Intruso', email: 'intruso@ejemplo.cl', contrasena: 'ClaveSegura2026', rol: 'admin' });
    assert.equal(res.status, 400);
    assert.equal(sql('SELECT COUNT(*) AS n FROM usuarios WHERE email = ?').get('intruso@ejemplo.cl').n, 0);
  });
});

describe('Inicio de sesión', () => {
  test('credenciales correctas entregan un token que permite consultar el perfil', async () => {
    const token = await entrar(app, CUENTAS_DEMO.pasajero);
    const res = await cliente(app, token).get('/auth/yo');
    assert.equal(res.status, 200);
    assert.equal(res.body.usuario.email, CUENTAS_DEMO.pasajero);
  });

  test('contraseña incorrecta y correo inexistente responden igual (no revela qué cuentas existen)', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: CUENTAS_DEMO.pasajero, contrasena: 'incorrecta-123' });
    const b = await request(app).post('/api/auth/login').send({ email: 'nadie@ejemplo.cl', contrasena: 'incorrecta-123' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.error.mensaje, b.body.error.mensaje);
  });

  test('intento de inyección SQL en el correo se rechaza por formato (400) y no rompe nada', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: "' OR '1'='1' --", contrasena: 'x' });
    assert.equal(res.status, 400);
    assert.ok(sql('SELECT COUNT(*) AS n FROM usuarios').get().n > 0);
  });

  test('el intento fallido queda en la auditoría, sin la contraseña', async () => {
    const eventos = await auditoria.findAsync({ accion: 'login_fallido' });
    assert.ok(eventos.length >= 2);
    assert.ok(!JSON.stringify(eventos).includes('incorrecta-123'));
  });
});

describe('Protección de rutas', () => {
  test('sin token => 401', async () => {
    assert.equal((await cliente(app).get('/trazados')).status, 401);
    assert.equal((await cliente(app).get('/billetera')).status, 401);
    assert.equal((await cliente(app).get('/sindicato/resumen')).status, 401);
  });

  test('token manipulado, vencido o firmado con otra clave => 401', async () => {
    const valido = await entrar(app, CUENTAS_DEMO.pasajero);
    const manipulado = `${valido.slice(0, -4)}AAAA`;
    const ajeno = jwt.sign({ rol: 'admin', tipo: 'acceso' }, 'clave-del-atacante', { subject: '1', issuer: config.jwt.emisor });
    const vencido = jwt.sign({ rol: 'pasajero', tipo: 'acceso' }, config.jwt.secreto, { subject: String(idDe(CUENTAS_DEMO.pasajero)), issuer: config.jwt.emisor, expiresIn: -1 });
    for (const token of [manipulado, ajeno, vencido, 'no-es-un-token']) {
      assert.equal((await cliente(app, token).get('/trazados')).status, 401);
    }
  });

  test('un pasajero NO puede modificar los cupos de un colectivo => 403 (OWASP A01)', async () => {
    const token = await entrar(app, CUENTAS_DEMO.pasajero);
    const res = await cliente(app, token).put('/turno/cupos', { cupos: 0 });
    assert.equal(res.status, 403);
  });

  test('pasajero y conductor no entran al panel del sindicato => 403', async () => {
    for (const email of [CUENTAS_DEMO.pasajero, CUENTAS_DEMO.conductor]) {
      const c = cliente(app, await entrar(app, email));
      assert.equal((await c.get('/sindicato/conductores')).status, 403);
      assert.equal((await c.get('/sindicato/auditoria')).status, 403);
      assert.equal((await c.post('/sindicato/vehiculos', {})).status, 403);
      assert.equal((await c.delete('/trazados/1')).status, 403);
    }
  });

  test('un conductor no puede pagar ni recargar; el sindicato no tiene billetera => 403', async () => {
    const conductor = cliente(app, await entrar(app, CUENTAS_DEMO.conductor));
    assert.equal((await conductor.post('/pagos', { vehiculo_id: 1 })).status, 403);
    assert.equal((await conductor.post('/billetera/recargas', { monto: 1000 })).status, 403);
    const admin = cliente(app, await entrar(app, CUENTAS_DEMO.admin));
    assert.equal((await admin.get('/billetera')).status, 403);
    assert.equal((await admin.post('/turno/iniciar')).status, 403);
  });

  test('cada acceso denegado queda registrado en la auditoría', async () => {
    const eventos = await auditoria.findAsync({ accion: 'acceso_denegado' });
    assert.ok(eventos.length >= 5);
    assert.ok(eventos.every((e) => e.actor?.rol));
  });
});

describe('Segundo factor del administrador (MFA)', () => {
  test('con solo la contraseña NO se obtiene acceso', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: CUENTAS_DEMO.admin, contrasena: CLAVE_DEMO });
    assert.equal(res.status, 200);
    assert.equal(res.body.mfa_requerido, true);
    assert.equal(res.body.access_token, undefined);
    assert.equal(cookieDe(res, 'rt_admin'), undefined);
    // El token intermedio no sirve para usar la API.
    assert.equal((await cliente(app, res.body.mfa_token).get('/sindicato/resumen')).status, 401);
  });

  test('un código incorrecto se rechaza y el correcto abre la sesión', async () => {
    const paso1 = await request(app).post('/api/auth/login').send({ email: CUENTAS_DEMO.admin, contrasena: CLAVE_DEMO });
    const malo = await request(app).post('/api/auth/mfa').send({ mfa_token: paso1.body.mfa_token, codigo: '000000' });
    assert.equal(malo.status, 401);

    const { mfa_secreto } = sql('SELECT mfa_secreto FROM usuarios WHERE email = ?').get(CUENTAS_DEMO.admin);
    const bueno = await request(app).post('/api/auth/mfa').send({ mfa_token: paso1.body.mfa_token, codigo: totp(descifrar(mfa_secreto)) });
    assert.equal(bueno.status, 200);
    assert.equal(bueno.body.usuario.rol, 'admin');
    assert.equal((await cliente(app, bueno.body.access_token).get('/sindicato/resumen')).status, 200);
  });

  test('el secreto del segundo factor está cifrado en la base', () => {
    const { mfa_secreto } = sql('SELECT mfa_secreto FROM usuarios WHERE email = ?').get(CUENTAS_DEMO.admin);
    assert.match(mfa_secreto, /^v1\./);
  });
});

describe('Renovación y cierre de sesión (refresh token)', () => {
  test('el refresh token rota: entrega un token nuevo y el anterior deja de servir', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: CUENTAS_DEMO.conductor, contrasena: CLAVE_DEMO });
    const cookie1 = valorCookie(cookieDe(login, 'rt_conductor'));

    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', cookie1).send({ rol: 'conductor' });
    assert.equal(r1.status, 200);
    assert.ok(r1.body.access_token);
    const cookie2 = valorCookie(cookieDe(r1, 'rt_conductor'));
    assert.notEqual(cookie1, cookie2);

    // Se simula que pasó el margen de gracia y alguien reutiliza el token antiguo (robo).
    sql("UPDATE refresh_tokens SET rotado_en = '2020-01-01T00:00:00.000Z' WHERE rotado_en IS NOT NULL AND usuario_id = ?").run(idDe(CUENTAS_DEMO.conductor));
    const robo = await request(app).post('/api/auth/refresh').set('Cookie', cookie1).send({ rol: 'conductor' });
    assert.equal(robo.status, 401);

    // Ante la sospecha de robo se cierran TODAS las sesiones: el token nuevo tampoco sirve ya.
    const despues = await request(app).post('/api/auth/refresh').set('Cookie', cookie2).send({ rol: 'conductor' });
    assert.equal(despues.status, 401);
  });

  test('el refresh token se guarda como hash, no en claro', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: CUENTAS_DEMO.pasajero, contrasena: CLAVE_DEMO });
    const token = decodeURIComponent(valorCookie(cookieDe(login, 'rt_pasajero')).split('=')[1]);
    assert.equal(sql('SELECT COUNT(*) AS n FROM refresh_tokens WHERE token_hash = ?').get(token).n, 0);
  });

  test('margen de gracia: dos pestañas que renuevan a la vez no se cierran la sesión entre sí', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: CUENTAS_DEMO.pasajero, contrasena: CLAVE_DEMO });
    const cookie = valorCookie(cookieDe(login, 'rt_pasajero'));
    const [a, b] = await Promise.all([
      request(app).post('/api/auth/refresh').set('Cookie', cookie).send({ rol: 'pasajero' }),
      request(app).post('/api/auth/refresh').set('Cookie', cookie).send({ rol: 'pasajero' }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
  });

  test('sin cookie no hay renovación', async () => {
    assert.equal((await request(app).post('/api/auth/refresh').send({})).status, 401);
    assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', 'rt_pasajero=inventado').send({ rol: 'pasajero' })).status, 401);
  });

  test('cerrar sesión revoca el refresh token en el servidor', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: CUENTAS_DEMO.pasajero, contrasena: CLAVE_DEMO });
    const cookie = valorCookie(cookieDe(login, 'rt_pasajero'));
    assert.equal((await request(app).post('/api/auth/logout').set('Cookie', cookie).send({ rol: 'pasajero' })).status, 204);
    assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', cookie).send({ rol: 'pasajero' })).status, 401);
  });
});

describe('Límite de intentos (fuerza bruta)', () => {
  test('al sexto intento fallido en un minuto la cuenta queda bloqueada temporalmente (429)', async () => {
    const intento = () => request(app).post('/api/auth/login').send({ email: 'victima@ejemplo.cl', contrasena: 'adivinando-123' });
    for (let i = 0; i < 5; i++) assert.equal((await intento()).status, 401);
    const bloqueado = await intento();
    assert.equal(bloqueado.status, 429);
    assert.equal(bloqueado.body.error.codigo, 'demasiados_intentos');
  });

  test('el bloqueo es por cuenta: otro usuario puede seguir entrando', async () => {
    assert.ok(await entrar(app, CUENTAS_DEMO.pasajero));
  });
});

describe('Cuenta suspendida', () => {
  test('pierde el acceso de inmediato aunque su token no haya expirado', async () => {
    const token = await entrar(app, 'ana@ejemplo.cl', 'ClaveSegura2026');
    assert.equal((await cliente(app, token).get('/trazados')).status, 200);
    sql("UPDATE usuarios SET estado = 'suspendido' WHERE email = ?").run('ana@ejemplo.cl');
    assert.equal((await cliente(app, token).get('/trazados')).status, 403);
    const login = await request(app).post('/api/auth/login').send({ email: 'ana@ejemplo.cl', contrasena: 'ClaveSegura2026' });
    assert.equal(login.status, 403);
  });
});
