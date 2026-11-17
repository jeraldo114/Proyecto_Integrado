/**
 * Muestra el código de verificación (segundo factor) vigente del administrador de demostración.
 * En la operación real este código lo entrega la app autenticadora del teléfono del administrador.
 *
 *   npm run mfa
 */
import { sql } from '../src/db/sql.js';
import { descifrar } from '../src/lib/cifrado.js';
import { totp, uriOtpauth } from '../src/lib/totp.js';

const correo = process.argv[2] ?? 'admin@demo.cl';
const usuario = sql('SELECT email, mfa_secreto FROM usuarios WHERE email = ?').get(correo);

if (!usuario?.mfa_secreto) {
  console.error(`No hay una cuenta con segundo factor para ${correo}. ¿Ya iniciaste el servidor una vez (npm start)?`);
  process.exit(1);
}

const secreto = descifrar(usuario.mfa_secreto);
const restantes = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log('');
console.log(`  Código de verificación para ${usuario.email}:  ${totp(secreto)}`);
console.log(`  (cambia en ${restantes} s)`);
console.log('');
console.log('  Para usar una app autenticadora (Google/Microsoft Authenticator), agrega esta cuenta:');
console.log(`  ${uriOtpauth(secreto, usuario.email)}`);
console.log('');
process.exit(0);
