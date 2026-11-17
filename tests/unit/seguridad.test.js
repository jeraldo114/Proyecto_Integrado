/** Pruebas unitarias: cifrado de datos personales, segundo factor (TOTP) y tokens de sesión. */
import '../ayuda/entorno.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { cifrar, descifrar, indiceCiego, sha256, igualSeguro, tokenAleatorio } from '../../src/lib/cifrado.js';
import { base32Codificar, base32Decodificar, hotp, totp, verificarTotp, generarSecreto, uriOtpauth } from '../../src/lib/totp.js';
import { firmarAcceso, firmarMfaPendiente, verificarToken } from '../../src/services/sesiones.js';
import { config } from '../../src/config.js';

describe('Cifrado AES-256-GCM de datos personales', () => {
  test('lo que se cifra se puede descifrar', () => {
    assert.equal(descifrar(cifrar('12345678-5')), '12345678-5');
    assert.equal(descifrar(cifrar('Ñandú ✓')), 'Ñandú ✓');
  });

  test('el texto cifrado no contiene el dato original y cambia en cada cifrado (IV aleatorio)', () => {
    const a = cifrar('123456785');
    const b = cifrar('123456785');
    assert.ok(!a.includes('123456785'));
    assert.notEqual(a, b);
  });

  test('detecta manipulación del dato cifrado (integridad GCM)', () => {
    const partes = cifrar('123456785').split('.');
    const datos = Buffer.from(partes[3], 'base64url');
    datos[0] ^= 0xff;
    partes[3] = datos.toString('base64url');
    assert.throws(() => descifrar(partes.join('.')));
  });

  test('rechaza formatos desconocidos', () => {
    assert.throws(() => descifrar('texto-plano'));
    assert.throws(() => descifrar('v2.a.b.c'));
  });

  test('índice ciego: determinístico, no reversible a simple vista y distinto por dato', () => {
    assert.equal(indiceCiego('123456785'), indiceCiego('123456785'));
    assert.notEqual(indiceCiego('123456785'), indiceCiego('123456786'));
    assert.match(indiceCiego('123456785'), /^[0-9a-f]{64}$/);
    assert.notEqual(indiceCiego('123456785'), sha256('123456785')); // usa clave secreta, no un hash simple
  });

  test('comparación en tiempo constante y tokens aleatorios', () => {
    assert.equal(igualSeguro('abc', 'abc'), true);
    assert.equal(igualSeguro('abc', 'abd'), false);
    assert.equal(igualSeguro('abc', 'abcd'), false);
    assert.notEqual(tokenAleatorio(), tokenAleatorio());
    assert.ok(tokenAleatorio(48).length >= 64);
  });
});

describe('Segundo factor TOTP (RFC 6238 / RFC 4226)', () => {
  // Vectores oficiales del RFC 6238 (SHA-1, secreto ASCII "12345678901234567890").
  const SECRETO = base32Codificar(Buffer.from('12345678901234567890'));

  test('Base32 codifica y decodifica', () => {
    assert.equal(SECRETO, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.equal(base32Decodificar(SECRETO).toString(), '12345678901234567890');
  });

  test('coincide con los vectores de prueba del estándar', () => {
    assert.equal(totp(SECRETO, 59 * 1000, 30, 8), '94287082');
    assert.equal(totp(SECRETO, 1111111109 * 1000, 30, 8), '07081804');
    assert.equal(totp(SECRETO, 1234567890 * 1000, 30, 8), '89005924');
    assert.equal(totp(SECRETO, 2000000000 * 1000, 30, 8), '69279037');
  });

  test('HOTP coincide con el RFC 4226 (contador 0 y 1)', () => {
    assert.equal(hotp(SECRETO, 0), '755224');
    assert.equal(hotp(SECRETO, 1), '287082');
  });

  test('acepta el código vigente y el del intervalo vecino; rechaza los demás', () => {
    const ahora = 1700000000000;
    assert.equal(verificarTotp(SECRETO, totp(SECRETO, ahora), ahora), true);
    assert.equal(verificarTotp(SECRETO, totp(SECRETO, ahora - 30000), ahora), true);
    assert.equal(verificarTotp(SECRETO, totp(SECRETO, ahora - 120000), ahora), false);
  });

  test('rechaza códigos mal formados', () => {
    for (const malo of ['', null, '12345', '1234567', 'abcdef', '12 34']) assert.equal(verificarTotp(SECRETO, malo), false);
  });

  test('genera secretos distintos y una URI estándar para la app autenticadora', () => {
    assert.notEqual(generarSecreto(), generarSecreto());
    assert.match(generarSecreto(), /^[A-Z2-7]{32}$/);
    assert.match(uriOtpauth(SECRETO, 'admin@demo.cl'), /^otpauth:\/\/totp\/Conatacoch:admin%40demo\.cl\?secret=/);
  });
});

describe('Tokens de sesión (JWT)', () => {
  const usuario = { id: 7, rol: 'pasajero', nombre: 'Camila' };

  test('un token de acceso válido entrega id y rol', () => {
    const datos = verificarToken(firmarAcceso(usuario), 'acceso');
    assert.equal(datos.id, 7);
    assert.equal(datos.rol, 'pasajero');
  });

  test('expira a los 15 minutos (política de la Evaluación 2)', () => {
    const { iat, exp } = jwt.decode(firmarAcceso(usuario));
    assert.equal(exp - iat, 15 * 60);
  });

  test('no lleva datos sensibles en su contenido', () => {
    const contenido = jwt.decode(firmarAcceso({ ...usuario, email: 'x@y.cl', hash_contrasena: 'secreto', rut_cifrado: 'v1...' }));
    assert.deepEqual(Object.keys(contenido).sort(), ['exp', 'iat', 'iss', 'nombre', 'rol', 'sub', 'tipo']);
  });

  test('rechaza un token firmado con otra clave', () => {
    const falso = jwt.sign({ rol: 'admin', tipo: 'acceso' }, 'otra-clave', { subject: '1', issuer: config.jwt.emisor });
    assert.throws(() => verificarToken(falso, 'acceso'), /sesión/);
  });

  test('rechaza un token sin firma (ataque "alg: none")', () => {
    const cabecera = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const cuerpo = Buffer.from(JSON.stringify({ sub: '1', rol: 'admin', tipo: 'acceso', iss: config.jwt.emisor })).toString('base64url');
    assert.throws(() => verificarToken(`${cabecera}.${cuerpo}.`, 'acceso'));
  });

  test('rechaza un token al que se le cambió el rol', () => {
    const [c, , f] = firmarAcceso(usuario).split('.');
    const alterado = Buffer.from(JSON.stringify({ sub: '7', rol: 'admin', tipo: 'acceso', iss: config.jwt.emisor, exp: 9999999999 })).toString('base64url');
    assert.throws(() => verificarToken(`${c}.${alterado}.${f}`, 'acceso'));
  });

  test('rechaza un token vencido', () => {
    const vencido = jwt.sign({ rol: 'pasajero', tipo: 'acceso' }, config.jwt.secreto, { subject: '7', issuer: config.jwt.emisor, expiresIn: -10 });
    assert.throws(() => verificarToken(vencido, 'acceso'));
  });

  test('un token de verificación (MFA) no sirve como token de acceso', () => {
    assert.throws(() => verificarToken(firmarMfaPendiente(usuario), 'acceso'));
    assert.equal(verificarToken(firmarMfaPendiente(usuario), 'mfa').id, 7);
  });
});
