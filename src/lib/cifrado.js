/**
 * Cifrado de datos personales en reposo (REQ-NF02).
 * - AES-256-GCM: confidencialidad + integridad (detecta manipulación).
 * - Índice ciego (HMAC-SHA256): permite buscar por RUT y exigir unicidad sin guardar el RUT en claro.
 */
import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const clave = Buffer.from(config.cifrado.clave, 'hex');
if (clave.length !== 32) throw new Error('CLAVE_CIFRADO debe tener 32 bytes (64 caracteres hexadecimales)');
const claveIndice = Buffer.from(config.cifrado.claveIndice, 'hex');

export function cifrar(texto) {
  const iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', clave, iv);
  const datos = Buffer.concat([cifrador.update(String(texto), 'utf8'), cifrador.final()]);
  return ['v1', iv.toString('base64url'), cifrador.getAuthTag().toString('base64url'), datos.toString('base64url')].join('.');
}

export function descifrar(paquete) {
  const [version, iv, etiqueta, datos] = String(paquete).split('.');
  if (version !== 'v1' || !iv || !etiqueta || !datos) throw new Error('Formato de dato cifrado no reconocido');
  const descifrador = createDecipheriv('aes-256-gcm', clave, Buffer.from(iv, 'base64url'));
  descifrador.setAuthTag(Buffer.from(etiqueta, 'base64url'));
  return Buffer.concat([descifrador.update(Buffer.from(datos, 'base64url')), descifrador.final()]).toString('utf8');
}

/** Huella determinística con clave secreta: mismo dato => misma huella, pero no reversible. */
export function indiceCiego(texto) {
  return createHmac('sha256', claveIndice).update(String(texto)).digest('hex');
}

/** Hash simple (sin clave) para tokens aleatorios de alta entropía. */
export function sha256(texto) {
  return createHash('sha256').update(String(texto)).digest('hex');
}

export function tokenAleatorio(bytes = 48) {
  return randomBytes(bytes).toString('base64url');
}

/** Comparación en tiempo constante para evitar ataques de temporización. */
export function igualSeguro(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
