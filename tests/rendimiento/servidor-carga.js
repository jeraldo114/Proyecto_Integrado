/**
 * Servidor bajo prueba para las mediciones de rendimiento.
 * Corre en su propio proceso (como en operación real) con bases en memoria y la flota de
 * demostración en recorrido. Entrega por la salida estándar lo que necesita el generador de carga.
 */
import '../ayuda/entorno-carga.js';
import { createServer } from 'node:http';
import { prepararApp, entrar, CUENTAS_DEMO } from '../ayuda/app.js';
import { activarFlotaDemo } from '../../src/services/simulador.js';
import { iniciarTiempoReal } from '../../src/services/tiempoReal.js';
import { obtenerTrazado } from '../../src/services/trazados.js';
import * as flota from '../../src/services/flota.js';

const app = await prepararApp();
const servidor = createServer(app);
iniciarTiempoReal(servidor);
// Misma cola de conexiones entrantes que src/server.js.
await new Promise((r) => servidor.listen({ port: 0, host: '127.0.0.1', backlog: 2048 }, r));
const url = `http://127.0.0.1:${servidor.address().port}`;

activarFlotaDemo();
const tokenPasajero = await entrar(app, CUENTAS_DEMO.pasajero);
const tokenConductor = await entrar(app, CUENTAS_DEMO.conductor);
await fetch(`${url}/api/turno/iniciar`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tokenConductor}`, 'Content-Type': 'application/json' },
  body: '{}',
});

const trazado = obtenerTrazado(1);
console.log(
  JSON.stringify({
    url,
    tokenPasajero,
    tokenConductor,
    paraderoId: trazado.paraderos[3].id,
    punto: trazado.puntos[0],
    vehiculos: flota.todos().length,
  }),
);
