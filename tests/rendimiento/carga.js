/**
 * Pruebas de rendimiento.
 *
 *   npm run test:rendimiento
 *
 * Levanta el servidor completo en un proceso aparte y lo somete a carga en cuatro escenarios.
 * Herramientas: autocannon (carga sostenida) y una ráfaga propia para la hora punta.
 *
 * Criterio de aceptación (REQ-NF01 / plan de pruebas): atender 10.000 solicitudes
 * simultáneas con el percentil 99 de latencia bajo 3 segundos y sin errores.
 *
 * Alcance: mide un solo proceso del servidor en este computador. No reemplaza la prueba de
 * carga del despliegue en la nube con auto-escalado, que corresponde a la etapa de piloto.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..');
const LIMITE_P99_MS = 3000;

// ---- Servidor bajo prueba, en su propio proceso ----
const servidor = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(aqui, 'servidor-carga.js')], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
const lineas = createInterface({ input: servidor.stdout });
const datos = await new Promise((resolver, rechazar) => {
  lineas.once('line', (linea) => resolver(JSON.parse(linea)));
  servidor.once('exit', (codigo) => rechazar(new Error(`El servidor de prueba terminó con código ${codigo}`)));
});
const { url, tokenPasajero, tokenConductor, paraderoId, punto } = datos;
const json = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

/** Carga sostenida con autocannon. */
async function sostenida(opciones) {
  const r = await autocannon(opciones);
  return {
    solicitudes: r.requests.total,
    por_segundo: Math.round(r.requests.average),
    latencia_media_ms: Number(r.latency.average.toFixed(1)),
    latencia_p99_ms: r.latency.p99,
    latencia_max_ms: r.latency.max,
    respuestas_2xx: r['2xx'],
    respuestas_no_2xx: r.non2xx,
    errores_de_red: r.errors + r.timeouts,
  };
}

/**
 * Hora punta: `total` solicitudes disparadas en el MISMO instante.
 * La latencia de cada una se mide desde ese instante hasta que termina de llegar su respuesta,
 * es decir, incluye el tiempo que esperó en cola: es lo que viviría cada pasajero.
 */
async function rafaga({ total, conexiones, ruta, headers }) {
  const agente = new http.Agent({ keepAlive: true, maxSockets: conexiones });
  const latencias = [];
  let ok = 0;
  let no2xx = 0;
  let errores = 0;
  const inicio = performance.now();
  await Promise.all(
    Array.from(
      { length: total },
      () =>
        new Promise((resolver) => {
          const pedido = http.get(`${url}${ruta}`, { agent: agente, headers }, (respuesta) => {
            respuesta.resume();
            respuesta.on('end', () => {
              if (respuesta.statusCode === 200) ok++;
              else no2xx++;
              latencias.push(performance.now() - inicio);
              resolver();
            });
          });
          pedido.on('error', () => {
            errores++;
            resolver();
          });
        }),
    ),
  );
  const duracion = performance.now() - inicio;
  agente.destroy();
  latencias.sort((a, b) => a - b);
  const percentil = (p) => Math.round(latencias[Math.min(latencias.length - 1, Math.floor((latencias.length * p) / 100))] ?? 0);
  return {
    solicitudes: total,
    por_segundo: Math.round(total / (duracion / 1000)),
    latencia_media_ms: Number((latencias.reduce((s, x) => s + x, 0) / Math.max(1, latencias.length)).toFixed(1)),
    latencia_p99_ms: percentil(99),
    latencia_max_ms: Math.round(latencias.at(-1) ?? 0),
    respuestas_2xx: ok,
    respuestas_no_2xx: no2xx,
    errores_de_red: errores,
  };
}

const ESCENARIOS = [
  {
    nombre: 'Pasajeros consultando la flota con llegada estimada (lectura)',
    conexiones: 100,
    correr: () => sostenida({ url: `${url}/api/trazados/1/flota?paradero_id=${paraderoId}`, headers: json(tokenPasajero), connections: 100, duration: 10 }),
  },
  {
    // 200 conexiones: Windows de escritorio limita a 200 la cola de conexiones entrantes de un
    // proceso. Las 10.000 solicitudes se disparan a la vez y se reparten en esas conexiones.
    nombre: 'Hora punta: 10.000 solicitudes disparadas en el mismo instante',
    conexiones: 200,
    correr: () => rafaga({ total: 10000, conexiones: 200, ruta: '/api/trazados/1/flota', headers: json(tokenPasajero) }),
  },
  {
    nombre: 'Conductores actualizando cupos (SQL + NoSQL + difusión en vivo)',
    conexiones: 50,
    correr: () => sostenida({ url: `${url}/api/turno/cupos`, method: 'PUT', headers: json(tokenConductor), body: JSON.stringify({ cupos: 2 }), connections: 50, duration: 10 }),
  },
  {
    nombre: 'Envío de posiciones GPS (escritura de telemetría con geocerca)',
    conexiones: 50,
    correr: () => sostenida({ url: `${url}/api/turno/ubicacion`, method: 'POST', headers: json(tokenConductor), body: JSON.stringify({ lat: punto.lat, lng: punto.lng }), connections: 50, duration: 10 }),
  },
];

const resultados = [];
try {
  for (const escenario of ESCENARIOS) {
    process.stdout.write(`\n▶ ${escenario.nombre}\n`);
    const medicion = await escenario.correr();
    const fila = { escenario: escenario.nombre, conexiones: escenario.conexiones, ...medicion };
    fila.cumple = fila.latencia_p99_ms < LIMITE_P99_MS && fila.respuestas_no_2xx === 0 && fila.errores_de_red === 0 && fila.respuestas_2xx > 0;
    resultados.push(fila);
    console.log(
      `  ${fila.solicitudes} solicitudes · ${fila.por_segundo}/s · media ${fila.latencia_media_ms} ms · p99 ${fila.latencia_p99_ms} ms · máx ${fila.latencia_max_ms} ms · correctas ${fila.respuestas_2xx} · no-2xx ${fila.respuestas_no_2xx} · errores de red ${fila.errores_de_red} · ${fila.cumple ? 'CUMPLE' : 'NO CUMPLE'}`,
    );
  }
} finally {
  servidor.kill();
}

const informe = {
  fecha: new Date().toISOString(),
  criterio: `p99 < ${LIMITE_P99_MS} ms y 0 errores`,
  equipo: { cpu: cpus()[0].model.trim(), nucleos: cpus().length, memoria_gb: Math.round(totalmem() / 2 ** 30), node: process.version, sistema: process.platform },
  vehiculos_en_recorrido: datos.vehiculos,
  resultados,
};
const carpeta = join(raiz, 'docs', 'pruebas');
mkdirSync(carpeta, { recursive: true });
writeFileSync(join(carpeta, 'resultados-rendimiento.json'), JSON.stringify(informe, null, 2));
console.log('\nInforme guardado en docs/pruebas/resultados-rendimiento.json');
process.exit(resultados.every((r) => r.cumple) ? 0 : 1);
