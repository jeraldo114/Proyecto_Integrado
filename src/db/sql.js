/**
 * Conexión a la base de datos ESTRUCTURADA (relacional).
 * Todas las consultas usan sentencias preparadas con parámetros: nunca se concatena
 * texto del usuario dentro del SQL (mitigación de inyección, OWASP A03).
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const aqui = dirname(fileURLToPath(import.meta.url));

function abrir() {
  if (config.esPrueba) return new DatabaseSync(':memory:');
  mkdirSync(config.dirDatos, { recursive: true });
  return new DatabaseSync(join(config.dirDatos, 'conatacoch.sqlite'));
}

export const db = abrir();
db.exec('PRAGMA foreign_keys = ON;');
if (!config.esPrueba) db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec(readFileSync(join(aqui, 'schema.sql'), 'utf8'));

const preparadas = new Map();

/** Devuelve una sentencia preparada (se reutiliza entre llamadas). */
export function sql(texto) {
  let sentencia = preparadas.get(texto);
  if (!sentencia) {
    sentencia = db.prepare(texto);
    preparadas.set(texto, sentencia);
  }
  return sentencia;
}

let enTransaccion = false;

/**
 * Ejecuta `fn` dentro de una transacción ACID: o se aplican todos los cambios o ninguno.
 * BEGIN IMMEDIATE toma el bloqueo de escritura al inicio y evita carreras entre pagos.
 */
export function transaccion(fn) {
  if (enTransaccion) return fn();
  db.exec('BEGIN IMMEDIATE');
  enTransaccion = true;
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    enTransaccion = false;
  }
}

export const ahoraIso = () => new Date().toISOString();

/** Traduce errores de restricciones de la base a algo que la API pueda explicar. */
export function esErrorDeRestriccion(error, tipo) {
  const mensaje = String(error?.message ?? '');
  if (!mensaje.includes('constraint failed')) return false;
  return tipo ? mensaje.toUpperCase().includes(tipo.toUpperCase()) : true;
}
