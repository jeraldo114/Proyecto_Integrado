/** Pruebas de integración: simulador GPS, flota de demostración y continuidad tras un reinicio. */
import '../ayuda/entorno-simulador.js';
import { prepararApp, entrar, cliente, CUENTAS_DEMO } from '../ayuda/app.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
import { sql } from '../../src/db/sql.js';
import { telemetria, purgarVencidosNosql } from '../../src/db/nosql.js';
import * as flota from '../../src/services/flota.js';
import { activarFlotaDemo, iniciarSimulador } from '../../src/services/simulador.js';
import { restaurarTurnosAbiertos } from '../../src/services/turnos.js';
import { obtenerTrazado } from '../../src/services/trazados.js';
import { proyectarEnPolilinea } from '../../src/lib/geo.js';

let app;
before(async () => {
  app = await prepararApp();
});

describe('Flota de demostración y simulador GPS', () => {
  test('pone en recorrido a los 7 colectivos de demostración, repartidos en sus trazados', () => {
    assert.equal(activarFlotaDemo(), 7);
    assert.equal(flota.todos().length, 7);
    assert.deepEqual([1, 2, 3].map((id) => flota.deTrazado(id).length), [3, 2, 2]);
    assert.equal(activarFlotaDemo(), 0, 'no abre turnos duplicados si se llama de nuevo');
  });

  test('cada paso mueve a los vehículos y nunca los saca de su trazado (polilínea estricta)', async () => {
    const antes = new Map(flota.todos().map((v) => [v.vehiculo_id, v.progreso_m]));
    const simulador = iniciarSimulador();
    await esperar(260);
    simulador.detener();

    for (const v of flota.todos()) {
      assert.notEqual(v.progreso_m, antes.get(v.vehiculo_id), `el vehículo ${v.patente} no avanzó`);
      const trazado = obtenerTrazado(v.trazado_id);
      assert.ok(v.progreso_m >= 0 && v.progreso_m <= trazado.largo_m);
      assert.ok(proyectarEnPolilinea(trazado.puntos, v).distancia < 2, `${v.patente} quedó fuera de su trazado`);
      assert.ok(v.velocidad_kmh >= 14 && v.velocidad_kmh <= 48);
    }
  });

  test('cada posición queda guardada como telemetría con su turno y sus cupos', async () => {
    const docs = await telemetria.findAsync({ origen: 'simulado' });
    assert.ok(docs.length >= 7 * 3);
    assert.ok(docs.every((d) => d.turno_id && d.ubicacion.type === 'Point' && Number.isInteger(d.cupos)));
  });

  test('las posiciones antiguas se borran solas al cumplir su plazo de retención (privacidad)', async () => {
    const antigua = new Date(Date.now() - 3 * 3600 * 1000); // hace 3 horas; el plazo es de 2
    await telemetria.insertAsync({ patente: 'VIEJA1', ubicacion: { type: 'Point', coordinates: [-70.57, -33.61] }, cupos: 1, ts: antigua });
    const recientes = await telemetria.countAsync({ ts: { $gte: new Date(Date.now() - 60000) } });
    const { posiciones } = await purgarVencidosNosql();
    assert.equal(posiciones, 1);
    assert.equal(await telemetria.countAsync({ patente: 'VIEJA1' }), 0);
    assert.equal(await telemetria.countAsync({ ts: { $gte: new Date(Date.now() - 60000) } }), recientes, 'las posiciones vigentes no se tocan');
  });

  test('el pasajero ve la flota simulada con asientos entre 0 y la capacidad', async () => {
    const pasajero = cliente(app, await entrar(app, CUENTAS_DEMO.pasajero));
    const { vehiculos } = (await pasajero.get('/trazados/1/flota')).body;
    assert.equal(vehiculos.length, 3);
    assert.ok(vehiculos.every((v) => v.cupos >= 0 && v.cupos <= v.capacidad));
  });

  test('tras un reinicio del servidor, los turnos abiertos vuelven al mapa (continuidad)', () => {
    const abiertos = sql('SELECT COUNT(*) AS n FROM turnos WHERE fin IS NULL').get().n;
    flota.vaciar(); // simula que el proceso se reinició y perdió su memoria
    assert.equal(flota.todos().length, 0);
    assert.equal(restaurarTurnosAbiertos(), abiertos);
    assert.equal(flota.todos().length, 7);
    const cupos = sql('SELECT vehiculo_id, cupos_disponibles FROM turnos WHERE fin IS NULL').all();
    for (const t of cupos) assert.equal(flota.obtener(t.vehiculo_id).cupos, t.cupos_disponibles, 'los cupos se recuperan de la base relacional');
  });
});
