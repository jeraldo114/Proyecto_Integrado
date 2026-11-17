/**
 * Base de datos NO ESTRUCTURADA (documental).
 * Motor del prototipo: NeDB, base documental embebida con la misma forma de consulta
 * que MongoDB (find / insert / update / índices / TTL). Producción: MongoDB.
 *
 * Guarda documentos JSON de forma flexible y con escritura muy rápida:
 *  - telemetria_gps    posiciones y cupos de cada colectivo (alto volumen, vida corta)
 *  - auditoria         quién hizo qué (el detalle cambia según la acción)
 *  - retroalimentacion opiniones de usuarios con contexto libre del dispositivo
 *  - alertas_parada    pasajeros esperando en un paradero (expiran solas)
 */
import Datastore from '@seald-io/nedb';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

const carpeta = join(config.dirDatos, 'nosql');
if (!config.esPrueba) mkdirSync(carpeta, { recursive: true });

function coleccion(nombre) {
  const opciones = config.esPrueba
    ? { inMemoryOnly: true }
    : { filename: join(carpeta, `${nombre}.db`), autoload: true, timestampData: false };
  const almacen = new Datastore(opciones);
  if (!config.esPrueba) almacen.setAutocompactionInterval(5 * 60 * 1000);
  return almacen;
}

export const telemetria = coleccion('telemetria_gps');
export const auditoria = coleccion('auditoria');
export const retroalimentacion = coleccion('retroalimentacion');
export const alertasParada = coleccion('alertas_parada');

/** Índices. Los TTL borran solos los documentos antiguos: no se guarda historial de más. */
export const nosqlLista = Promise.all([
  telemetria.ensureIndexAsync({ fieldName: 'ts', expireAfterSeconds: config.tiempoReal.retencionTelemetriaHoras * 3600 }),
  telemetria.ensureIndexAsync({ fieldName: 'patente' }),
  telemetria.ensureIndexAsync({ fieldName: 'turno_id' }),
  auditoria.ensureIndexAsync({ fieldName: 'ts' }),
  retroalimentacion.ensureIndexAsync({ fieldName: 'ts' }),
  alertasParada.ensureIndexAsync({ fieldName: 'ts', expireAfterSeconds: config.tiempoReal.minutosAlertaParada * 60 }),
  alertasParada.ensureIndexAsync({ fieldName: 'trazado_id' }),
]);

/**
 * Borra los documentos que superaron su plazo de retención (minimización de datos).
 * La ubicación de un conductor no se conserva más allá de lo necesario para operar.
 */
export async function purgarVencidosNosql(ahora = Date.now()) {
  const limiteTelemetria = new Date(ahora - config.tiempoReal.retencionTelemetriaHoras * 3600 * 1000);
  const limiteAlertas = new Date(ahora - config.tiempoReal.minutosAlertaParada * 60 * 1000);
  const [posiciones, alertas] = await Promise.all([
    telemetria.removeAsync({ ts: { $lt: limiteTelemetria } }, { multi: true }),
    alertasParada.removeAsync({ ts: { $lt: limiteAlertas } }, { multi: true }),
  ]);
  return { posiciones, alertas };
}

/** Detiene tareas en segundo plano (compactación) para un apagado limpio. */
export function cerrarNosql() {
  for (const c of [telemetria, auditoria, retroalimentacion, alertasParada]) c.stopAutocompaction();
}
