/**
 * Segundo factor de autenticación (MFA) con códigos de un solo uso basados en tiempo.
 * Implementa TOTP (RFC 6238) sobre HOTP (RFC 4226): compatible con Google Authenticator,
 * Microsoft Authenticator y similares. Sin dependencias externas.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { igualSeguro } from './cifrado.js';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Codificar(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let salida = '';
  for (let i = 0; i < bits.length; i += 5) salida += ALFABETO[Number.parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return salida;
}

export function base32Decodificar(texto) {
  const limpio = String(texto).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of limpio) bits += ALFABETO.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const generarSecreto = () => base32Codificar(randomBytes(20));

/** Código HOTP de `digitos` cifras para un contador dado. */
export function hotp(secretoBase32, contador, digitos = 6) {
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(contador));
  const hmac = createHmac('sha1', base32Decodificar(secretoBase32)).update(mensaje).digest();
  const desplazamiento = hmac[hmac.length - 1] & 0x0f;
  const binario = hmac.readUInt32BE(desplazamiento) & 0x7fffffff;
  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

/** Código vigente para un instante (por defecto, ahora). Cambia cada 30 segundos. */
export function totp(secretoBase32, ahoraMs = Date.now(), pasoSegundos = 30, digitos = 6) {
  return hotp(secretoBase32, Math.floor(ahoraMs / 1000 / pasoSegundos), digitos);
}

/** Acepta el código actual y los vecinos (±30 s) para tolerar relojes levemente desfasados. */
export function verificarTotp(secretoBase32, codigo, ahoraMs = Date.now(), ventana = 1) {
  const limpio = String(codigo ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpio)) return false;
  for (let i = -ventana; i <= ventana; i++) {
    if (igualSeguro(totp(secretoBase32, ahoraMs + i * 30000), limpio)) return true;
  }
  return false;
}

/** URI estándar para agregar la cuenta en una app autenticadora. */
export function uriOtpauth(secretoBase32, cuenta, emisor = 'Conatacoch') {
  return `otpauth://totp/${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}?secret=${secretoBase32}&issuer=${encodeURIComponent(emisor)}&digits=6&period=30`;
}
