/** Pruebas de integración: turno del conductor, cupos, flota en vivo, geocerca y avisos de parada. */
import { prepararApp, entrar, cliente, CUENTAS_DEMO, vehiculoDe, idDe } from '../ayuda/app.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../../src/db/sql.js';
import { telemetria, auditoria } from '../../src/db/nosql.js';
import { obtenerTrazado } from '../../src/services/trazados.js';

let app;
let conductor;
let pasajero;
let vehiculo;
let trazado;

before(async () => {
  app = await prepararApp();
  conductor = cliente(app, await entrar(app, CUENTAS_DEMO.conductor));
  pasajero = cliente(app, await entrar(app, CUENTAS_DEMO.pasajero));
  vehiculo = vehiculoDe(CUENTAS_DEMO.conductor);
  trazado = obtenerTrazado(vehiculo.trazado_id);
});

const flotaVisible = async (extra = '') => (await pasajero.get(`/trazados/${trazado.id}/flota${extra}`)).body.vehiculos;

describe('Trazados visibles para el pasajero', () => {
  test('lista los trazados activos con su tarifa', async () => {
    const res = await pasajero.get('/trazados');
    assert.equal(res.status, 200);
    assert.equal(res.body.trazados.length, 3);
    assert.ok(res.body.trazados.every((t) => t.activo && t.tarifa > 0));
  });

  test('entrega la polilínea y los paraderos ordenados por avance', async () => {
    const res = await pasajero.get(`/trazados/${trazado.id}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.trazado.puntos.length > 50);
    const avances = res.body.trazado.paraderos.map((p) => p.progreso_m);
    assert.deepEqual(avances, [...avances].sort((a, b) => a - b));
    assert.equal(avances[0], 0);
  });

  test('un trazado inexistente responde 404 y un id no numérico 400', async () => {
    assert.equal((await pasajero.get('/trazados/9999')).status, 404);
    assert.equal((await pasajero.get('/trazados/1;DROP TABLE usuarios')).status, 400);
    assert.ok(sql('SELECT COUNT(*) AS n FROM usuarios').get().n > 0);
  });
});

describe('Turno y cupos del conductor (HU-02)', () => {
  test('fuera de turno el vehículo no aparece en el mapa ni puede informar cupos', async () => {
    assert.equal((await flotaVisible()).length, 0);
    const res = await conductor.put('/turno/cupos', { cupos: 2 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.codigo, 'sin_turno');
  });

  test('al iniciar turno aparece en el mapa con todos sus asientos libres', async () => {
    const res = await conductor.post('/turno/iniciar');
    assert.equal(res.status, 201);
    assert.equal(res.body.en_recorrido, true);
    const [v] = await flotaVisible();
    assert.equal(v.patente, vehiculo.patente);
    assert.equal(v.cupos, 4);
    assert.equal(v.capacidad, 4);
  });

  test('lo que ve el pasajero no incluye datos personales del conductor', async () => {
    const [v] = await flotaVisible();
    assert.equal(v.conductor, 'Luis M.');
    const texto = JSON.stringify(v);
    for (const prohibido of ['email', 'rut', 'telefono', 'conductor_id', 'turno_id']) assert.ok(!texto.includes(prohibido), `no debe exponer ${prohibido}`);
  });

  test('no se puede abrir un segundo turno (409)', async () => {
    const res = await conductor.post('/turno/iniciar');
    assert.equal(res.status, 409);
    assert.equal(res.body.error.codigo, 'turno_abierto');
    assert.equal(sql('SELECT COUNT(*) AS n FROM turnos WHERE conductor_id = ? AND fin IS NULL').get(idDe(CUENTAS_DEMO.conductor)).n, 1);
  });

  test('la base impide dos turnos abiertos para el mismo vehículo aunque el código fallara', () => {
    assert.throws(
      () => sql('INSERT INTO turnos (vehiculo_id, conductor_id, trazado_id, cupos_disponibles) VALUES (?, ?, ?, 4)').run(vehiculo.id, idDe(CUENTAS_DEMO.conductor), trazado.id),
      /constraint/i,
    );
  });

  test('con un toque informa los cupos y el pasajero lo ve de inmediato', async () => {
    for (const cupos of [3, 1, 0, 2]) {
      const res = await conductor.put('/turno/cupos', { cupos });
      assert.equal(res.status, 200);
      assert.equal((await flotaVisible())[0].cupos, cupos);
    }
    assert.equal(sql('SELECT cupos_disponibles FROM turnos WHERE vehiculo_id = ? AND fin IS NULL').get(vehiculo.id).cupos_disponibles, 2);
  });

  test('rechaza cupos fuera de rango, decimales, texto y campos desconocidos (400)', async () => {
    for (const cuerpo of [{ cupos: 5 }, { cupos: -1 }, { cupos: 2.5 }, { cupos: '3' }, {}, { cupos: 2, vehiculo_id: 999 }]) {
      const res = await conductor.put('/turno/cupos', cuerpo);
      assert.equal(res.status, 400, `debió rechazar ${JSON.stringify(cuerpo)}`);
    }
    assert.equal((await flotaVisible())[0].cupos, 2, 'el valor válido anterior se mantiene');
  });

  test('cada cambio queda como documento de telemetría en la base NoSQL (GeoJSON)', async () => {
    const docs = await telemetria.findAsync({ patente: vehiculo.patente });
    assert.ok(docs.length >= 5);
    const ultimo = docs.sort((a, b) => b.ts - a.ts)[0];
    assert.equal(ultimo.ubicacion.type, 'Point');
    assert.equal(ultimo.ubicacion.coordinates.length, 2);
    assert.equal(ultimo.cupos, 2);
    assert.ok(ultimo.ts instanceof Date);
  });
});

describe('Llegada estimada al paradero (HU-01)', () => {
  test('con un paradero, cada colectivo trae distancia y minutos, ordenados por cercanía', async () => {
    const ultimo = trazado.paraderos.at(-1);
    const vehiculos = await flotaVisible(`?paradero_id=${ultimo.id}`);
    assert.equal(vehiculos.length, 1);
    assert.equal(vehiculos[0].distancia_m, trazado.largo_m); // parte en el inicio del trazado
    assert.equal(vehiculos[0].eta_min, Math.round(trazado.largo_m / (25000 / 60)));
  });

  test('un paradero de otro trazado se rechaza (404)', async () => {
    assert.equal((await pasajero.get(`/trazados/${trazado.id}/flota?paradero_id=99999`)).status, 404);
  });
});

describe('Geocerca del pasajero (HU-01, criterio 4)', () => {
  test('sobre el trazado: confirma y sugiere el paradero más cercano', async () => {
    const p = trazado.paraderos[2];
    const res = await pasajero.post(`/trazados/${trazado.id}/ubicar`, { lat: p.lat, lng: p.lng });
    assert.equal(res.status, 200);
    assert.equal(res.body.en_trazado, true);
    assert.equal(res.body.paradero_sugerido.id, p.id);
  });

  test('lejos del trazado: avisa la distancia y hacia dónde caminar', async () => {
    const res = await pasajero.post(`/trazados/${trazado.id}/ubicar`, { lat: -33.45, lng: -70.66 }); // centro de Santiago
    assert.equal(res.body.en_trazado, false);
    assert.ok(res.body.distancia_m > 10000);
    assert.ok(res.body.punto_mas_cercano.lat && res.body.minutos_caminando > 60);
  });

  test('coordenadas imposibles se rechazan (400)', async () => {
    assert.equal((await pasajero.post(`/trazados/${trazado.id}/ubicar`, { lat: 123, lng: -70 })).status, 400);
    assert.equal((await pasajero.post(`/trazados/${trazado.id}/ubicar`, { lat: 'x', lng: -70 })).status, 400);
  });
});

describe('Avisos de parada', () => {
  test('el pasajero avisa y el conductor con asientos lo ve', async () => {
    const paradero = trazado.paraderos[1];
    const aviso = await pasajero.post(`/trazados/${trazado.id}/avisos`, { paradero_id: paradero.id });
    assert.equal(aviso.status, 201);
    const res = await conductor.get(`/trazados/${trazado.id}/avisos`);
    assert.deepEqual(res.body.avisos, [{ paradero_id: paradero.id, paradero: paradero.nombre, pasajeros: 1 }]);
  });

  test('avisar dos veces no duplica: queda un solo aviso vigente por pasajero', async () => {
    const paradero = trazado.paraderos[3];
    await pasajero.post(`/trazados/${trazado.id}/avisos`, { paradero_id: paradero.id });
    const res = await conductor.get(`/trazados/${trazado.id}/avisos`);
    assert.equal(res.body.avisos.length, 1);
    assert.equal(res.body.avisos[0].paradero_id, paradero.id);
  });

  test('un colectivo LLENO no recibe avisos (HU-02, criterio 2)', async () => {
    await conductor.put('/turno/cupos', { cupos: 0 });
    const res = await conductor.get(`/trazados/${trazado.id}/avisos`);
    assert.deepEqual(res.body.avisos, []);
    assert.equal(res.body.motivo, 'lleno');
    await conductor.put('/turno/cupos', { cupos: 3 });
  });

  test('un conductor no ve avisos de un trazado donde no está en turno (403)', async () => {
    const otro = trazado.id === 1 ? 2 : 1;
    assert.equal((await conductor.get(`/trazados/${otro}/avisos`)).status, 403);
  });
});

describe('GPS real del teléfono: anti-fraude y geocerca del vehículo', () => {
  test('una posición sobre el trazado se acepta', async () => {
    const p = trazado.puntos[5];
    const res = await conductor.post('/turno/ubicacion', { lat: p.lat, lng: p.lng });
    assert.equal(res.status, 200);
    assert.equal(res.body.fuera_de_ruta, false);
    const [v] = await flotaVisible();
    assert.equal(v.lat, p.lat);
  });

  test('un salto imposible (GPS falso) se rechaza y queda en la auditoría', async () => {
    const res = await conductor.post('/turno/ubicacion', { lat: -33.45, lng: -70.66 }); // 18 km en un instante
    assert.equal(res.status, 409);
    assert.equal(res.body.error.codigo, 'posicion_sospechosa');
    assert.equal((await auditoria.findAsync({ accion: 'gps_sospechoso' })).length, 1);
    const [v] = await flotaVisible();
    assert.notEqual(v.lat, -33.45, 'la posición falsa no se publica');
  });
});

describe('Fin de turno: desconexión ética del rastreo', () => {
  test('al terminar desaparece del mapa de inmediato', async () => {
    const res = await conductor.post('/turno/finalizar');
    assert.equal(res.status, 200);
    assert.equal(res.body.en_recorrido, false);
    assert.equal((await flotaVisible()).length, 0);
  });

  test('fuera de turno el servidor se niega a recibir ubicaciones (409)', async () => {
    const antes = await telemetria.countAsync({ patente: vehiculo.patente });
    const p = trazado.puntos[10];
    const res = await conductor.post('/turno/ubicacion', { lat: p.lat, lng: p.lng });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.codigo, 'sin_turno');
    assert.equal(await telemetria.countAsync({ patente: vehiculo.patente }), antes, 'no se guardó ninguna posición nueva');
  });

  test('el turno queda cerrado con hora de término', () => {
    const turno = sql('SELECT inicio, fin FROM turnos WHERE vehiculo_id = ? ORDER BY id DESC LIMIT 1').get(vehiculo.id);
    assert.ok(turno.fin >= turno.inicio);
  });
});

describe('Solo operan conductores y vehículos validados (REQ-F01)', () => {
  test('un conductor por validar no puede iniciar turno', async () => {
    const pendiente = cliente(app, await entrar(app, 'pedro.araya@demo.cl'));
    const res = await pendiente.post('/turno/iniciar');
    assert.ok([403, 409].includes(res.status));
    assert.equal((await pasajero.get('/trazados/2/flota')).body.vehiculos.length, 0);
  });
});
