/** Pruebas de integración: billetera y pagos. La base debe quedar consistente (ACID) siempre. */
import { prepararApp, entrar, cliente, CUENTAS_DEMO, vehiculoDe, saldoDe, idDe } from '../ayuda/app.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from '../../src/db/sql.js';

let app;
let conductor;
let pasajero;
let vehiculo;
const TARIFA = 800; // trazado T-01

const totalDinero = () => sql('SELECT COALESCE(SUM(saldo), 0) AS t FROM billeteras').get().t;
const cantidadPagos = () => sql('SELECT COUNT(*) AS n FROM pagos').get().n;

before(async () => {
  app = await prepararApp();
  conductor = cliente(app, await entrar(app, CUENTAS_DEMO.conductor));
  pasajero = cliente(app, await entrar(app, CUENTAS_DEMO.pasajero));
  vehiculo = vehiculoDe(CUENTAS_DEMO.conductor);
});

describe('Billetera', () => {
  test('muestra saldo y movimientos del propio usuario', async () => {
    const res = await pasajero.get('/billetera');
    assert.equal(res.status, 200);
    assert.equal(res.body.saldo, saldoDe(CUENTAS_DEMO.pasajero));
    assert.ok(res.body.movimientos.length >= 3);
  });

  test('la recarga suma al saldo y deja un movimiento', async () => {
    const antes = saldoDe(CUENTAS_DEMO.pasajero);
    const res = await pasajero.post('/billetera/recargas', { monto: 2000 });
    assert.equal(res.status, 201);
    assert.equal(res.body.saldo, antes + 2000);
    const ultimo = sql("SELECT tipo, monto, saldo_resultante FROM movimientos WHERE usuario_id = ? ORDER BY id DESC LIMIT 1").get(idDe(CUENTAS_DEMO.pasajero));
    assert.deepEqual({ ...ultimo }, { tipo: 'recarga', monto: 2000, saldo_resultante: antes + 2000 });
  });

  test('rechaza montos inválidos: negativos, cero, decimales, enormes o texto', async () => {
    const antes = saldoDe(CUENTAS_DEMO.pasajero);
    for (const monto of [-500, 0, 99.5, 100, 9999999, '1000', null]) {
      const res = await pasajero.post('/billetera/recargas', { monto });
      assert.equal(res.status, 400, `debió rechazar ${monto}`);
    }
    assert.equal(saldoDe(CUENTAS_DEMO.pasajero), antes);
  });
});

describe('Pago del pasaje', () => {
  test('no se puede pagar a un colectivo que no está en recorrido (409) y nada cambia', async () => {
    const [dinero, pagos] = [totalDinero(), cantidadPagos()];
    const res = await pasajero.post('/pagos', { vehiculo_id: vehiculo.id, codigo: randomUUID() });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.codigo, 'vehiculo_fuera_de_turno');
    assert.equal(totalDinero(), dinero);
    assert.equal(cantidadPagos(), pagos);
  });

  test('pago correcto: descuenta al pasajero, abona al conductor y registra todo (caso del plan de pruebas)', async () => {
    await conductor.post('/turno/iniciar');
    const [sp, sc, dinero] = [saldoDe(CUENTAS_DEMO.pasajero), saldoDe(CUENTAS_DEMO.conductor), totalDinero()];

    const res = await pasajero.post('/pagos', { vehiculo_id: vehiculo.id, codigo: randomUUID() });
    assert.equal(res.status, 201);
    assert.equal(res.body.pago.monto, TARIFA);
    assert.equal(res.body.saldo, sp - TARIFA);

    assert.equal(saldoDe(CUENTAS_DEMO.pasajero), sp - TARIFA);
    assert.equal(saldoDe(CUENTAS_DEMO.conductor), sc + TARIFA);
    assert.equal(totalDinero(), dinero, 'el dinero solo cambia de mano: no se crea ni se pierde');

    const movimientos = sql('SELECT tipo, monto FROM movimientos WHERE pago_id = ? ORDER BY id').all(res.body.pago.id);
    assert.deepEqual(movimientos.map((m) => ({ ...m })), [{ tipo: 'pago', monto: -TARIFA }, { tipo: 'cobro', monto: TARIFA }]);
  });

  test('la respuesta al pasajero no revela el identificador interno del conductor', async () => {
    const res = await pasajero.post('/pagos', { vehiculo_id: vehiculo.id, codigo: randomUUID() });
    assert.equal(res.body.pago.conductor_id, undefined);
  });

  test('idempotencia: reintentar el mismo pago NO cobra dos veces', async () => {
    const codigo = randomUUID();
    const primero = await pasajero.post('/pagos', { vehiculo_id: vehiculo.id, codigo });
    const [saldo, pagos] = [saldoDe(CUENTAS_DEMO.pasajero), cantidadPagos()];
    const reintento = await pasajero.post('/pagos', { vehiculo_id: vehiculo.id, codigo });
    assert.equal(primero.status, 201);
    assert.equal(reintento.status, 200);
    assert.equal(reintento.body.repetido, true);
    assert.equal(reintento.body.pago.id, primero.body.pago.id);
    assert.equal(saldoDe(CUENTAS_DEMO.pasajero), saldo);
    assert.equal(cantidadPagos(), pagos);
  });

  test('saldo insuficiente (402): la transacción se revierte completa (atomicidad)', async () => {
    sql('UPDATE billeteras SET saldo = 300 WHERE usuario_id = ?').run(idDe(CUENTAS_DEMO.pasajero));
    const [sc, pagos, movimientos] = [saldoDe(CUENTAS_DEMO.conductor), cantidadPagos(), sql('SELECT COUNT(*) AS n FROM movimientos').get().n];

    const res = await pasajero.post('/pagos', { vehiculo_id: vehiculo.id, codigo: randomUUID() });
    assert.equal(res.status, 402);
    assert.equal(res.body.error.codigo, 'saldo_insuficiente');

    assert.equal(saldoDe(CUENTAS_DEMO.pasajero), 300, 'al pasajero no se le descontó nada');
    assert.equal(saldoDe(CUENTAS_DEMO.conductor), sc, 'al conductor no se le abonó nada');
    assert.equal(cantidadPagos(), pagos, 'no quedó un pago a medias');
    assert.equal(sql('SELECT COUNT(*) AS n FROM movimientos').get().n, movimientos);
  });

  test('pagos simultáneos con saldo para uno solo: se cobra exactamente uno', async () => {
    sql('UPDATE billeteras SET saldo = ? WHERE usuario_id = ?').run(TARIFA, idDe(CUENTAS_DEMO.pasajero));
    const respuestas = await Promise.all([1, 2, 3, 4].map(() => pasajero.post('/pagos', { vehiculo_id: vehiculo.id, codigo: randomUUID() })));
    const estados = respuestas.map((r) => r.status).sort();
    assert.deepEqual(estados, [201, 402, 402, 402]);
    assert.equal(saldoDe(CUENTAS_DEMO.pasajero), 0);
  });

  test('vehículo inexistente (404) y datos mal formados (400)', async () => {
    assert.equal((await pasajero.post('/pagos', { vehiculo_id: 99999, codigo: randomUUID() })).status, 404);
    assert.equal((await pasajero.post('/pagos', { vehiculo_id: 'abc' })).status, 400);
    assert.equal((await pasajero.post('/pagos', { vehiculo_id: vehiculo.id, codigo: 'no-es-uuid' })).status, 400);
    assert.equal((await pasajero.post('/pagos', { vehiculo_id: vehiculo.id, monto: 1 })).status, 400, 'el cliente no puede fijar el monto');
  });

  test('el conductor ve su recaudación del día', async () => {
    const res = await conductor.get('/turno/recaudacion');
    assert.equal(res.status, 200);
    assert.ok(res.body.hoy.pagos >= 3);
    assert.equal(res.body.hoy.total, res.body.hoy.pagos * TARIFA);
    assert.equal(res.body.saldo, saldoDe(CUENTAS_DEMO.conductor));
  });

  test('cada quien ve solo sus pagos; el sindicato los ve todos', async () => {
    const delPasajero = (await pasajero.get('/pagos')).body.pagos;
    const delConductor = (await conductor.get('/pagos')).body.pagos;
    const admin = cliente(app, await entrar(app, CUENTAS_DEMO.admin));
    const todos = (await admin.get('/pagos')).body.pagos;
    assert.equal(delPasajero.length, cantidadPagos());
    assert.equal(delConductor.length, cantidadPagos());
    assert.equal(todos.length, cantidadPagos());
    assert.equal(delPasajero[0].conductor, 'Luis', 'fuera del sindicato solo se muestra el primer nombre');
    assert.equal(todos[0].conductor, 'Luis Morales Pinto');

    const otra = await cliente(app).post('/auth/registro', { nombre: 'Nueva Pasajera', email: 'nueva@ejemplo.cl', contrasena: 'ClaveSegura2026' });
    assert.equal((await cliente(app, otra.body.access_token).get('/pagos')).body.pagos.length, 0);
  });
});

describe('Integridad garantizada por la base de datos (aunque el código fallara)', () => {
  test('un saldo nunca puede quedar negativo (CHECK)', () => {
    assert.throws(() => sql('UPDATE billeteras SET saldo = -1 WHERE usuario_id = ?').run(idDe(CUENTAS_DEMO.pasajero)), /constraint/i);
  });

  test('no existe un pago sin pasajero, vehículo o turno reales (claves foráneas)', () => {
    assert.throws(
      () => sql("INSERT INTO pagos (codigo, pasajero_id, conductor_id, vehiculo_id, trazado_id, turno_id, monto) VALUES ('x', 99999, 1, 1, 1, 1, 800)").run(),
      /constraint/i,
    );
  });

  test('un pago no puede tener monto cero o negativo ni repetir su código', () => {
    const p = sql('SELECT * FROM pagos LIMIT 1').get();
    assert.throws(() => sql('UPDATE pagos SET monto = 0 WHERE id = ?').run(p.id), /constraint/i);
    assert.throws(
      () => sql('INSERT INTO pagos (codigo, pasajero_id, conductor_id, vehiculo_id, trazado_id, turno_id, monto) VALUES (?, ?, ?, ?, ?, ?, 800)').run(p.codigo, p.pasajero_id, p.conductor_id, p.vehiculo_id, p.trazado_id, p.turno_id),
      /constraint/i,
    );
  });

  test('no se puede borrar un usuario que tiene pagos (RESTRICT)', () => {
    assert.throws(() => sql('DELETE FROM usuarios WHERE id = ?').run(idDe(CUENTAS_DEMO.pasajero)), /constraint/i);
  });
});
