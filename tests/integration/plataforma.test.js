/** Pruebas de integración: cabeceras de seguridad, manejo de errores y canal en tiempo real. */
import { prepararApp, entrar, cliente, CUENTAS_DEMO, vehiculoDe } from '../ayuda/app.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import request from 'supertest';
import WebSocket from 'ws';
import { iniciarTiempoReal } from '../../src/services/tiempoReal.js';

let app;
before(async () => {
  app = await prepararApp();
});

describe('Cabeceras de seguridad y archivos de la interfaz', () => {
  test('la página principal se sirve con una política de contenido estricta (CSP)', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 200);
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.ok(!csp.includes("'unsafe-inline'"), 'no se permiten scripts ni estilos en línea');
    assert.ok(!csp.includes("'unsafe-eval'"));
  });

  test('envía las cabeceras defensivas y oculta la tecnología del servidor', async () => {
    const res = await request(app).get('/');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.ok(res.headers['strict-transport-security']);
    assert.match(res.headers['permissions-policy'], /camera=\(\)/);
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('la interfaz no usa estilos ni scripts en línea (compatible con la CSP)', async () => {
    const html = (await request(app).get('/')).text;
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'hay un <script> sin src');
    assert.ok(!/\sstyle=/.test(html));
    assert.ok(!/\son[a-z]+=/i.test(html));
  });

  test('sirve la guía de estilo (tokens), la fuente y el mapa desde el propio servidor', async () => {
    const tokens = await request(app).get('/css/tokens.css');
    assert.equal(tokens.status, 200);
    assert.match(tokens.text, /--amarillo-500/);
    assert.equal((await request(app).get('/vendor/leaflet/leaflet.js')).status, 200);
    assert.equal((await request(app).get('/vendor/inter/inter-latin-wght-normal.woff2')).status, 200);
  });

  test('no expone archivos internos del servidor', async () => {
    for (const ruta of ['/.env', '/src/config.js', '/data/conatacoch.sqlite', '/package.json', '/../package.json']) {
      assert.equal((await request(app).get(ruta)).status, 404, `expone ${ruta}`);
    }
  });
});

describe('Manejo de errores de la API', () => {
  test('las respuestas con datos no se guardan en caché', async () => {
    const res = await request(app).get('/api/salud');
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.estado, 'ok');
  });

  test('JSON mal formado => 400 con mensaje claro, sin detalles internos', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.codigo, 'json_invalido');
    assert.ok(!JSON.stringify(res.body).includes('at '), 'no debe incluir trazas');
  });

  test('cuerpo demasiado grande => 413', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.cl', contrasena: 'x'.repeat(300000) });
    assert.equal(res.status, 413);
  });

  test('ruta inexistente => 404 en JSON', async () => {
    const token = await entrar(app, CUENTAS_DEMO.pasajero);
    const res = await cliente(app, token).get('/no-existe');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.codigo, 'no_encontrado');
  });
});

describe('Canal en tiempo real (WebSocket)', () => {
  let servidor;
  let tiempoReal;
  let url;
  let conductor;
  let pasajeroToken;
  let vehiculo;
  const abiertos = [];

  const conectar = () => {
    const ws = new WebSocket(url);
    abiertos.push(ws);
    const cola = [];
    const esperas = [];
    ws.on('message', (datos) => {
      const mensaje = JSON.parse(datos.toString());
      const i = esperas.findIndex((e) => e.filtro(mensaje));
      if (i >= 0) esperas.splice(i, 1)[0].resolver(mensaje);
      else cola.push(mensaje);
    });
    const esperar = (filtro, ms = 3000) =>
      new Promise((resolver, rechazar) => {
        const i = cola.findIndex(filtro);
        if (i >= 0) return resolver(cola.splice(i, 1)[0]);
        const temporizador = setTimeout(() => rechazar(new Error('no llegó el mensaje esperado a tiempo')), ms);
        esperas.push({ filtro, resolver: (m) => { clearTimeout(temporizador); resolver(m); } });
      });
    const abierto = new Promise((r) => ws.once('open', r));
    return { ws, esperar, abierto, enviar: (m) => ws.send(JSON.stringify(m)) };
  };

  before(async () => {
    servidor = createServer(app);
    tiempoReal = iniciarTiempoReal(servidor);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    url = `ws://127.0.0.1:${servidor.address().port}/ws`;
    conductor = cliente(app, await entrar(app, CUENTAS_DEMO.conductor));
    pasajeroToken = await entrar(app, CUENTAS_DEMO.pasajero);
    vehiculo = vehiculoDe(CUENTAS_DEMO.conductor);
    await conductor.post('/turno/iniciar');
  });

  after(async () => {
    for (const ws of abiertos) ws.terminate();
    tiempoReal.cerrar();
    await new Promise((r) => servidor.close(r));
  });

  test('sin autenticarse no se entrega información de la flota', async () => {
    const c = conectar();
    await c.abierto;
    c.enviar({ tipo: 'suscribir', trazado_id: vehiculo.trazado_id });
    const m = await c.esperar((x) => x.tipo === 'error');
    assert.equal(m.codigo, 'no_autenticado');
  });

  test('un token inválido cierra la conexión con código 4401', async () => {
    const c = conectar();
    await c.abierto;
    const cierre = new Promise((r) => c.ws.once('close', (codigo) => r(codigo)));
    c.enviar({ tipo: 'autenticar', token: 'token-falso' });
    assert.equal(await cierre, 4401);
  });

  test('al suscribirse recibe la flota actual del trazado', async () => {
    const c = conectar();
    await c.abierto;
    c.enviar({ tipo: 'autenticar', token: pasajeroToken });
    await c.esperar((x) => x.tipo === 'autenticado');
    c.enviar({ tipo: 'suscribir', trazado_id: vehiculo.trazado_id });
    const m = await c.esperar((x) => x.tipo === 'flota');
    assert.equal(m.vehiculos.length, 1);
    assert.equal(m.vehiculos[0].patente, vehiculo.patente);
  });

  test('un cambio de cupos llega al pasajero en menos de 3 segundos (REQ-NF01)', async () => {
    const c = conectar();
    await c.abierto;
    c.enviar({ tipo: 'autenticar', token: pasajeroToken });
    await c.esperar((x) => x.tipo === 'autenticado');
    c.enviar({ tipo: 'suscribir', trazado_id: vehiculo.trazado_id });
    await c.esperar((x) => x.tipo === 'flota');

    const inicio = performance.now();
    const llegada = c.esperar((x) => x.tipo === 'vehiculo' && x.vehiculo.cupos === 0);
    await conductor.put('/turno/cupos', { cupos: 0 }); // el conductor marca "LLENO"
    const m = await llegada;
    const latencia = performance.now() - inicio;
    assert.equal(m.vehiculo.patente, vehiculo.patente);
    assert.ok(latencia < 3000, `tardó ${latencia.toFixed(0)} ms`);
    console.log(`      latencia conductor → pasajero: ${latencia.toFixed(1)} ms`);
  });

  test('quien mira otro trazado no recibe los cambios de este', async () => {
    const c = conectar();
    await c.abierto;
    c.enviar({ tipo: 'autenticar', token: pasajeroToken });
    await c.esperar((x) => x.tipo === 'autenticado');
    const otro = vehiculo.trazado_id === 1 ? 2 : 1;
    c.enviar({ tipo: 'suscribir', trazado_id: otro });
    await c.esperar((x) => x.tipo === 'flota');
    await conductor.put('/turno/cupos', { cupos: 3 });
    await assert.rejects(c.esperar((x) => x.tipo === 'vehiculo', 400));
  });

  test('el conductor recibe en vivo el aviso de un pasajero que espera y el pago recibido', async () => {
    const c = conectar();
    await c.abierto;
    c.enviar({ tipo: 'autenticar', token: await entrar(app, CUENTAS_DEMO.conductor) });
    await c.esperar((x) => x.tipo === 'autenticado');
    const pasajero = cliente(app, pasajeroToken);
    const trazado = (await pasajero.get(`/trazados/${vehiculo.trazado_id}`)).body.trazado;

    const aviso = c.esperar((x) => x.tipo === 'aviso_parada');
    const res = await pasajero.post(`/trazados/${trazado.id}/avisos`, { paradero_id: trazado.paraderos[2].id });
    assert.equal(res.body.colectivos_avisados, 1);
    assert.equal((await aviso).paradero, trazado.paraderos[2].nombre);

    const pago = c.esperar((x) => x.tipo === 'pago_recibido');
    await pasajero.post('/pagos', { vehiculo_id: vehiculo.id });
    const recibido = await pago;
    assert.equal(recibido.monto, 800);
    assert.equal(recibido.pasajero, 'Camila');
  });

  test('al terminar el turno el vehículo sale del mapa de todos los pasajeros', async () => {
    const c = conectar();
    await c.abierto;
    c.enviar({ tipo: 'autenticar', token: pasajeroToken });
    await c.esperar((x) => x.tipo === 'autenticado');
    c.enviar({ tipo: 'suscribir', trazado_id: vehiculo.trazado_id });
    await c.esperar((x) => x.tipo === 'flota');
    const fuera = c.esperar((x) => x.tipo === 'vehiculo_fuera');
    await conductor.post('/turno/finalizar');
    assert.equal((await fuera).vehiculo_id, vehiculo.id);
  });

  test('rechaza mensajes que no son JSON o demasiado grandes sin caerse', async () => {
    const c = conectar();
    await c.abierto;
    c.ws.send('esto no es json');
    assert.equal((await c.esperar((x) => x.tipo === 'error')).mensaje, 'Mensaje inválido');
    const cierre = new Promise((r) => c.ws.once('close', r));
    c.ws.send('x'.repeat(10000));
    await cierre;
    assert.equal((await request(app).get('/api/salud')).status, 200, 'el servidor sigue funcionando');
  });
});
