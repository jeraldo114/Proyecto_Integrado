/** Pruebas de integración: panel del sindicato (CRUD, validaciones, estados y bases de datos). */
import { prepararApp, entrar, cliente, CUENTAS_DEMO, idDe } from '../ayuda/app.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../../src/db/sql.js';
import { retroalimentacion, auditoria } from '../../src/db/nosql.js';
import { digitoVerificador } from '../../src/lib/rut.js';

let app;
let admin;
let pasajero;
const rut = (cuerpo) => `${cuerpo}-${digitoVerificador(cuerpo)}`;

before(async () => {
  app = await prepararApp();
  admin = cliente(app, await entrar(app, CUENTAS_DEMO.admin));
  pasajero = cliente(app, await entrar(app, CUENTAS_DEMO.pasajero));
});

describe('Conductores', () => {
  let nuevo;

  test('lista conductores con su vehículo y estado', async () => {
    const res = await admin.get('/sindicato/conductores');
    assert.equal(res.status, 200);
    assert.equal(res.body.conductores.length, 9);
    assert.ok(res.body.conductores.some((c) => c.estado === 'pendiente'));
    assert.ok(!JSON.stringify(res.body).includes('hash_contrasena'));
  });

  test('rechaza un RUT con dígito verificador incorrecto (400)', async () => {
    const res = await admin.post('/sindicato/conductores', { nombre: 'Mario Soto', email: 'mario@ejemplo.cl', rut: '15.555.555-1' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.detalles.some((d) => d.campo === 'rut'));
  });

  test('registra un conductor: queda "por validar" y con clave temporal de un solo uso', async () => {
    const res = await admin.post('/sindicato/conductores', { nombre: 'Mario Soto', email: 'mario@ejemplo.cl', rut: rut('15555555'), telefono: '+56922223333' });
    assert.equal(res.status, 201);
    assert.equal(res.body.conductor.estado, 'pendiente');
    assert.ok(res.body.contrasena_temporal.length >= 10);
    nuevo = res.body.conductor;
    // La clave temporal funciona para iniciar sesión.
    assert.ok(await entrar(app, 'mario@ejemplo.cl', res.body.contrasena_temporal));
  });

  test('el RUT se guarda cifrado (AES-256) y con índice ciego: no aparece en claro en la base', () => {
    const fila = sql('SELECT rut_cifrado, rut_indice FROM usuarios WHERE id = ?').get(nuevo.id);
    assert.match(fila.rut_cifrado, /^v1\./);
    assert.match(fila.rut_indice, /^[0-9a-f]{64}$/);
    const todo = JSON.stringify(sql('SELECT * FROM usuarios').all());
    assert.ok(!todo.includes('15555555'), 'ningún campo contiene el RUT legible');
  });

  test('no permite dos personas con el mismo RUT ni el mismo correo (409)', async () => {
    const mismoRut = await admin.post('/sindicato/conductores', { nombre: 'Otro', email: 'otro@ejemplo.cl', rut: `15.555.555-${digitoVerificador('15555555')}` });
    assert.equal(mismoRut.status, 409);
    assert.equal(mismoRut.body.error.codigo, 'rut_duplicado');
    const mismoCorreo = await admin.post('/sindicato/conductores', { nombre: 'Otro', email: 'mario@ejemplo.cl', rut: rut('16666666') });
    assert.equal(mismoCorreo.status, 409);
    assert.equal(mismoCorreo.body.error.codigo, 'email_duplicado');
  });

  test('edita datos del conductor', async () => {
    const res = await admin.put(`/sindicato/conductores/${nuevo.id}`, { nombre: 'Mario Soto Vega', telefono: '' });
    assert.equal(res.status, 200);
    assert.equal(res.body.conductor.nombre, 'Mario Soto Vega');
    assert.equal(res.body.conductor.rut, `15.555.555-${digitoVerificador('15555555')}`);
  });

  test('valida al conductor (pendiente → activo) y queda en la auditoría', async () => {
    const res = await admin.patch(`/sindicato/conductores/${nuevo.id}/estado`, { estado: 'activo' });
    assert.equal(res.body.conductor.estado, 'activo');
    const [evento] = await auditoria.findAsync({ accion: 'cambiar_estado', recurso: 'conductores', 'detalle.id': nuevo.id });
    assert.equal(evento.detalle.de, 'pendiente');
    assert.equal(evento.detalle.a, 'activo');
    assert.equal(evento.actor.rol, 'admin');
  });

  test('rechaza estados inventados (400) y conductores inexistentes (404)', async () => {
    assert.equal((await admin.patch(`/sindicato/conductores/${nuevo.id}/estado`, { estado: 'jefe' })).status, 400);
    assert.equal((await admin.patch('/sindicato/conductores/99999/estado', { estado: 'activo' })).status, 404);
  });

  test('un conductor sin historial se puede eliminar; uno con turnos solo se suspende (409)', async () => {
    assert.equal((await admin.delete(`/sindicato/conductores/${nuevo.id}`)).status, 204);
    assert.equal(sql('SELECT COUNT(*) AS n FROM usuarios WHERE id = ?').get(nuevo.id).n, 0);
    assert.equal(sql('SELECT COUNT(*) AS n FROM billeteras WHERE usuario_id = ?').get(nuevo.id).n, 0, 'su billetera se elimina en cascada');
    const conHistorial = await admin.delete(`/sindicato/conductores/${idDe(CUENTAS_DEMO.conductor)}`);
    assert.equal(conHistorial.status, 409);
  });
});

describe('Vehículos', () => {
  let vehiculo;
  let conductorNuevo;

  before(async () => {
    const res = await admin.post('/sindicato/conductores', { nombre: 'Laura Díaz', email: 'laura@ejemplo.cl', rut: rut('17777777'), contrasena: 'ClaveSegura2026' });
    conductorNuevo = res.body.conductor;
    await admin.patch(`/sindicato/conductores/${conductorNuevo.id}/estado`, { estado: 'activo' });
  });

  test('rechaza patentes mal formadas y datos fuera de rango (400)', async () => {
    const base = { patente: 'BBCL12', marca: 'Kia', modelo: 'Rio', anio: 2022, capacidad_maxima: 4, trazado_id: 1 };
    for (const cambio of [{ patente: 'AEIOU1' }, { patente: '' }, { anio: 1950 }, { capacidad_maxima: 9 }, { capacidad_maxima: 0 }, { trazado_id: 'x' }]) {
      const res = await admin.post('/sindicato/vehiculos', { ...base, ...cambio });
      assert.equal(res.status, 400, `debió rechazar ${JSON.stringify(cambio)}`);
    }
  });

  test('registra el vehículo normalizando la patente; queda "por validar"', async () => {
    const res = await admin.post('/sindicato/vehiculos', { patente: 'bb-cl-12', marca: 'Kia', modelo: 'Rio', anio: 2022, capacidad_maxima: 4, trazado_id: 1, conductor_id: conductorNuevo.id });
    assert.equal(res.status, 201);
    assert.equal(res.body.vehiculo.patente, 'BBCL12');
    assert.equal(res.body.vehiculo.estado, 'pendiente');
    vehiculo = res.body.vehiculo;
  });

  test('no permite patente repetida, ni un conductor con dos vehículos, ni referencias inexistentes', async () => {
    const base = { marca: 'Kia', modelo: 'Rio', anio: 2022, capacidad_maxima: 4, trazado_id: 1 };
    const repetida = await admin.post('/sindicato/vehiculos', { ...base, patente: 'BBCL12' });
    assert.equal(repetida.status, 409);
    assert.equal(repetida.body.error.codigo, 'patente_duplicada');
    const ocupado = await admin.post('/sindicato/vehiculos', { ...base, patente: 'CCDL34', conductor_id: conductorNuevo.id });
    assert.equal(ocupado.status, 409);
    assert.equal(ocupado.body.error.codigo, 'conductor_ocupado');
    assert.equal((await admin.post('/sindicato/vehiculos', { ...base, patente: 'CCDL34', trazado_id: 999 })).status, 404);
    assert.equal((await admin.post('/sindicato/vehiculos', { ...base, patente: 'CCDL34', conductor_id: idDe(CUENTAS_DEMO.pasajero) })).status, 404, 'un pasajero no puede ser conductor');
  });

  test('mientras el vehículo no esté validado, su conductor no puede iniciar turno', async () => {
    const conductor = cliente(app, await entrar(app, 'laura@ejemplo.cl', 'ClaveSegura2026'));
    const res = await conductor.post('/turno/iniciar');
    assert.equal(res.status, 409);
    assert.equal(res.body.error.codigo, 'vehiculo_no_validado');
  });

  test('al validarlo puede operar; al suspenderlo sale del mapa y su turno se cierra', async () => {
    assert.equal((await admin.patch(`/sindicato/vehiculos/${vehiculo.id}/estado`, { estado: 'validado' })).body.vehiculo.estado, 'validado');
    const conductor = cliente(app, await entrar(app, 'laura@ejemplo.cl', 'ClaveSegura2026'));
    assert.equal((await conductor.post('/turno/iniciar')).status, 201);
    assert.equal((await pasajero.get('/trazados/1/flota')).body.vehiculos.filter((v) => v.patente === 'BBCL12').length, 1);

    const reasignar = await admin.put(`/sindicato/vehiculos/${vehiculo.id}`, { trazado_id: 2 });
    assert.equal(reasignar.status, 409, 'no se reasigna un vehículo en recorrido');

    await admin.patch(`/sindicato/vehiculos/${vehiculo.id}/estado`, { estado: 'suspendido' });
    assert.equal((await pasajero.get('/trazados/1/flota')).body.vehiculos.filter((v) => v.patente === 'BBCL12').length, 0);
    assert.equal(sql('SELECT COUNT(*) AS n FROM turnos WHERE vehiculo_id = ? AND fin IS NULL').get(vehiculo.id).n, 0);
  });

  test('suspender a un conductor cierra sus sesiones y le quita el acceso al instante', async () => {
    const token = await entrar(app, 'laura@ejemplo.cl', 'ClaveSegura2026');
    assert.equal((await cliente(app, token).get('/turno')).status, 200);
    await admin.patch(`/sindicato/conductores/${conductorNuevo.id}/estado`, { estado: 'suspendido' });
    assert.equal((await cliente(app, token).get('/turno')).status, 403);
    assert.equal(sql('SELECT COUNT(*) AS n FROM refresh_tokens WHERE usuario_id = ? AND revocado_en IS NULL').get(conductorNuevo.id).n, 0);
  });

  test('edita un vehículo y lista la flota', async () => {
    const res = await admin.put(`/sindicato/vehiculos/${vehiculo.id}`, { modelo: 'Rio 5', anio: 2023 });
    assert.equal(res.body.vehiculo.modelo, 'Rio 5');
    assert.equal((await admin.get('/sindicato/vehiculos')).body.vehiculos.length, 10);
  });
});

describe('Trazados', () => {
  const nuevo = {
    codigo: 'T-09',
    nombre: 'Plaza de Puente Alto – Demo',
    comuna: 'Puente Alto',
    color: '#336699',
    tarifa: 700,
    puntos: [{ lat: -33.61, lng: -70.575 }, { lat: -33.605, lng: -70.575 }, { lat: -33.6, lng: -70.576 }],
    paraderos: [{ nombre: 'Final', lat: -33.6, lng: -70.576 }, { nombre: 'Inicio', lat: -33.61, lng: -70.575 }],
  };
  let creado;

  test('crea un trazado: calcula el largo y ordena los paraderos por avance', async () => {
    const res = await admin.post('/trazados', nuevo);
    assert.equal(res.status, 201);
    creado = res.body.trazado;
    assert.ok(creado.largo_m > 1000 && creado.largo_m < 1300);
    assert.deepEqual(creado.paraderos.map((p) => p.nombre), ['Inicio', 'Final']);
  });

  test('valida código, tarifa, color y geometría (400)', async () => {
    for (const cambio of [{ codigo: 'trazado 1' }, { tarifa: 50 }, { tarifa: 800.5 }, { color: 'rojo' }, { puntos: [{ lat: -33.6, lng: -70.5 }] }, { paraderos: [] }, { puntos: [{ lat: 200, lng: 0 }, { lat: 0, lng: 0 }] }]) {
      const res = await admin.post('/trazados', { ...nuevo, codigo: 'T-10', ...cambio });
      assert.equal(res.status, 400, `debió rechazar ${JSON.stringify(cambio).slice(0, 60)}`);
    }
  });

  test('no permite códigos repetidos (409)', async () => {
    assert.equal((await admin.post('/trazados', nuevo)).status, 409);
  });

  test('cambiar la tarifa no altera el recorrido; un trazado inactivo se oculta al pasajero', async () => {
    const res = await admin.put(`/trazados/${creado.id}`, { tarifa: 750, activo: false });
    assert.equal(res.body.trazado.tarifa, 750);
    assert.equal(res.body.trazado.puntos.length, 3);
    assert.equal((await pasajero.get(`/trazados/${creado.id}`)).status, 404);
    assert.equal((await pasajero.get('/trazados')).body.trazados.length, 3);
    assert.equal((await admin.get('/trazados')).body.trazados.length, 4);
  });

  test('un trazado sin vehículos se elimina (con sus puntos y paraderos en cascada)', async () => {
    assert.equal((await admin.delete(`/trazados/${creado.id}`)).status, 204);
    assert.equal(sql('SELECT COUNT(*) AS n FROM puntos_trazado WHERE trazado_id = ?').get(creado.id).n, 0);
    assert.equal(sql('SELECT COUNT(*) AS n FROM paraderos WHERE trazado_id = ?').get(creado.id).n, 0);
  });

  test('un trazado con vehículos NO se puede eliminar (integridad referencial, 409)', async () => {
    const res = await admin.delete('/trazados/1');
    assert.equal(res.status, 409);
    assert.throws(() => sql('DELETE FROM trazados WHERE id = 1').run(), /constraint/i, 'la base también lo impide');
    assert.throws(() => sql("INSERT INTO vehiculos (patente, marca, modelo, anio, trazado_id) VALUES ('ZZZZ99', 'X', 'Y', 2020, 9999)").run(), /constraint/i);
  });
});

describe('Resumen, opiniones y auditoría', () => {
  test('el resumen entrega los indicadores del sindicato', async () => {
    const res = await admin.get('/sindicato/resumen');
    assert.equal(res.status, 200);
    for (const clave of ['en_recorrido', 'asientos_libres', 'ocupacion_pct', 'conductores', 'vehiculos', 'pasajeros', 'pagos_hoy', 'trazados']) assert.ok(clave in res.body, `falta ${clave}`);
    assert.equal(res.body.trazados.length, 3);
    assert.equal(res.body.pagos_hoy.cantidad, 2);
  });

  test('cualquier usuario puede opinar; se guarda como documento flexible en NoSQL', async () => {
    const res = await pasajero.post('/opiniones', { tipo: 'sugerencia', puntaje: 5, comentario: 'Me sirvió ver los asientos antes de salir.', contexto: { pantalla: 'mapa', ancho: 390, alto: 844, tactil: true } });
    assert.equal(res.status, 201);
    const doc = await retroalimentacion.findOneAsync({ _id: res.body.id });
    assert.equal(doc.usuario.rol, 'pasajero');
    assert.equal(doc.contexto.ancho, 390);
    assert.equal(doc.estado, 'nueva');
  });

  test('valida la opinión: tipo conocido, puntaje 1 a 5 y largo del comentario', async () => {
    for (const cuerpo of [{ tipo: 'queja', comentario: 'Texto suficiente' }, { tipo: 'problema', comentario: 'ok' }, { tipo: 'problema', comentario: 'Texto suficiente', puntaje: 9 }, { tipo: 'problema', comentario: 'x'.repeat(700) }]) {
      assert.equal((await pasajero.post('/opiniones', cuerpo)).status, 400);
    }
  });

  test('un texto con HTML se guarda como texto y la API lo devuelve como JSON (sin ejecutarse)', async () => {
    const malicioso = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    await pasajero.post('/opiniones', { tipo: 'problema', comentario: malicioso });
    const res = await admin.get('/sindicato/opiniones');
    assert.match(res.headers['content-type'], /application\/json/);
    assert.ok(res.body.opiniones.some((o) => o.comentario === malicioso));
  });

  test('el sindicato gestiona la opinión y registra la mejora aplicada', async () => {
    const { opiniones } = (await admin.get('/sindicato/opiniones')).body;
    const res = await admin.patch(`/sindicato/opiniones/${opiniones[0].id}`, { estado: 'resuelta', respuesta: 'Se agregó al tablero de mejoras.' });
    assert.equal(res.status, 200);
    const doc = await retroalimentacion.findOneAsync({ _id: opiniones[0].id });
    assert.equal(doc.estado, 'resuelta');
    assert.equal(doc.respuesta, 'Se agregó al tablero de mejoras.');
  });

  test('intento de inyección NoSQL en el identificador se rechaza (400)', async () => {
    assert.equal((await admin.patch('/sindicato/opiniones/{"$ne":null}', { estado: 'resuelta' })).status, 400);
    assert.equal((await admin.patch('/sindicato/opiniones/noexiste12345678', { estado: 'resuelta' })).status, 404);
  });

  test('la auditoría muestra las acciones recientes y nunca contraseñas ni RUT completos', async () => {
    const res = await admin.get('/sindicato/auditoria?limite=200');
    assert.equal(res.status, 200);
    assert.ok(res.body.eventos.length > 10);
    const texto = JSON.stringify(res.body);
    for (const secreto of ['ClaveSegura2026', 'Colectivo2026', '15555555', '17777777', 'hash_contrasena']) assert.ok(!texto.includes(secreto), `la auditoría expone ${secreto}`);
    assert.equal((await admin.get('/sindicato/auditoria?limite=9999')).status, 400);
  });
});
