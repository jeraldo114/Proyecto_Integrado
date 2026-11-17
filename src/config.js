/**
 * Configuración central. Los secretos NUNCA van en el código: se leen del entorno (.env).
 * En el primer arranque local se generan secretos aleatorios y se guardan en .env,
 * para que el proyecto funcione sin pasos manuales y sin claves compartidas.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const rutaEnv = join(RAIZ, '.env');

function asegurarEnv() {
  if (process.env.NODE_ENV === 'test') return; // las pruebas definen su propio entorno
  if (!existsSync(rutaEnv)) {
    const contenido = [
      '# Generado automáticamente en el primer arranque. No subir a un repositorio.',
      `JWT_SECRETO=${randomBytes(48).toString('base64url')}`,
      `CLAVE_CIFRADO=${randomBytes(32).toString('hex')}`,
      `CLAVE_INDICE=${randomBytes(32).toString('hex')}`,
      'PUERTO=3000',
      '',
    ].join('\n');
    writeFileSync(rutaEnv, contenido, { mode: 0o600 });
  }
  for (const linea of readFileSync(rutaEnv, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
asegurarEnv();

const entero = (nombre, porDefecto) => {
  const v = Number.parseInt(process.env[nombre] ?? '', 10);
  return Number.isFinite(v) ? v : porDefecto;
};
const booleano = (nombre, porDefecto) => {
  const v = process.env[nombre];
  return v === undefined ? porDefecto : ['1', 'true', 'si', 'sí'].includes(v.toLowerCase());
};

const esPrueba = process.env.NODE_ENV === 'test';
const esProduccion = process.env.NODE_ENV === 'production';

function secreto(nombre, bytesMinimos) {
  const valor = process.env[nombre];
  if (valor && valor.length >= bytesMinimos) return valor;
  if (esPrueba) return randomBytes(48).toString('hex').slice(0, Math.max(64, bytesMinimos));
  throw new Error(`Falta la variable de entorno ${nombre}. Borra .env para regenerarla o defínela.`);
}

export const config = {
  entorno: process.env.NODE_ENV ?? 'development',
  esPrueba,
  esProduccion,
  puerto: entero('PUERTO', 3000),
  dirDatos: process.env.DIR_DATOS ?? join(RAIZ, 'data'),

  jwt: {
    secreto: secreto('JWT_SECRETO', 32),
    // Política de la Evaluación 2: token de acceso corto + refresh token revocable.
    minutosAcceso: entero('JWT_MINUTOS_ACCESO', 15),
    diasRefresh: entero('JWT_DIAS_REFRESH', 7),
    minutosMfa: 5,
    emisor: 'conatacoch',
  },

  cifrado: {
    clave: secreto('CLAVE_CIFRADO', 64), // 32 bytes en hexadecimal: AES-256
    claveIndice: secreto('CLAVE_INDICE', 64),
  },

  bcryptCosto: entero('BCRYPT_COSTO', esPrueba ? 4 : 12),

  limites: {
    loginPorMinuto: entero('LIMITE_LOGIN_POR_MINUTO', 5),
    autenticacionPorMinuto: entero('LIMITE_AUTENTICACION_POR_MINUTO', 40),
    apiPorMinuto: entero('LIMITE_API_POR_MINUTO', 600),
    activos: booleano('LIMITES_ACTIVOS', true),
  },

  tiempoReal: {
    intervaloMs: entero('SIMULADOR_INTERVALO_MS', 2000),
    simulador: booleano('SIMULADOR_GPS', !esPrueba),
    flotaDemo: booleano('FLOTA_DEMO', !esPrueba),
    // Prototipo: 2 horas (la base documental embebida vive en memoria). Producción: 24 horas.
    retencionTelemetriaHoras: entero('RETENCION_TELEMETRIA_HORAS', 2),
    minutosAlertaParada: 10,
  },

  negocio: {
    geocercaMetros: entero('GEOCERCA_METROS', 200),
    velocidadMaximaKmh: 130, // por sobre esto la posición se considera sospechosa (anti-spoofing)
    velocidadPromedioKmh: 25,
    recargaMinima: 500,
    recargaMaxima: 50000,
  },
};
