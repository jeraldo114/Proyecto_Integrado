/** Usuarios: alta, credenciales y datos personales protegidos. */
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { sql, transaccion, esErrorDeRestriccion } from '../db/sql.js';
import { cifrar, descifrar, indiceCiego } from '../lib/cifrado.js';
import { enmascararRut, formatearRut } from '../lib/rut.js';
import { conflicto, noEncontrado } from '../middleware/errores.js';
import { crearBilletera } from './pagos.js';

/** Contraseñas con bcrypt (hash de una vía con sal). Costo 12 en operación normal. */
export const hashContrasena = (clara) => bcrypt.hash(clara, config.bcryptCosto);
export const compararContrasena = (clara, hash) => bcrypt.compare(clara, hash);

// Hash de relleno: cuando el correo no existe igual se ejecuta bcrypt, para que el tiempo
// de respuesta no revele qué cuentas están registradas.
const hashSenuelo = bcrypt.hashSync('contraseña-inexistente', config.bcryptCosto);
export const compararSenuelo = (clara) => bcrypt.compare(clara, hashSenuelo);

export function buscarPorEmail(email) {
  return sql('SELECT * FROM usuarios WHERE email = ?').get(email);
}

/** Datos del usuario que es seguro devolver a su dueño. */
export function perfil(usuario) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    telefono: usuario.telefono ?? null,
    rol: usuario.rol,
    estado: usuario.estado,
    mfa_activo: Boolean(usuario.mfa_secreto),
  };
}

export async function crearUsuario({ nombre, email, contrasena, rol, rut, telefono, estado = 'activo', mfaSecreto = null, saldoInicial = 0 }) {
  const hash = await hashContrasena(contrasena);
  try {
    return transaccion(() => {
      const { lastInsertRowid } = sql(
        `INSERT INTO usuarios (nombre, email, telefono, rut_cifrado, rut_indice, rol, estado, hash_contrasena, mfa_secreto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        nombre, email, telefono ?? null,
        rut ? cifrar(rut) : null, rut ? indiceCiego(rut) : null,
        rol, estado, hash, mfaSecreto ? cifrar(mfaSecreto) : null,
      );
      const id = Number(lastInsertRowid);
      if (rol !== 'admin') crearBilletera(id, saldoInicial);
      return sql('SELECT * FROM usuarios WHERE id = ?').get(id);
    });
  } catch (error) {
    if (esErrorDeRestriccion(error, 'usuarios.email')) throw conflicto('Ya existe una cuenta con ese correo', 'email_duplicado');
    if (esErrorDeRestriccion(error, 'usuarios.rut_indice')) throw conflicto('Ya existe una persona registrada con ese RUT', 'rut_duplicado');
    throw error;
  }
}

/** Fila de conductor para el panel del sindicato. El RUT completo solo lo ve el administrador. */
export function vistaConductor(fila, { rutCompleto = false } = {}) {
  let rut = null;
  if (fila.rut_cifrado) {
    const claro = descifrar(fila.rut_cifrado);
    rut = rutCompleto ? formatearRut(claro) : enmascararRut(claro);
  }
  return {
    id: fila.id,
    nombre: fila.nombre,
    email: fila.email,
    telefono: fila.telefono ?? null,
    rut,
    estado: fila.estado,
    creado_en: fila.creado_en,
    vehiculo: fila.patente ? { id: fila.vehiculo_id, patente: fila.patente, estado: fila.vehiculo_estado } : null,
  };
}

export function listarConductores() {
  return sql(
    `SELECT u.*, v.id AS vehiculo_id, v.patente, v.estado AS vehiculo_estado
       FROM usuarios u LEFT JOIN vehiculos v ON v.conductor_id = u.id
      WHERE u.rol = 'conductor' ORDER BY u.nombre`,
  ).all();
}

export function exigirConductor(id) {
  const fila = sql(
    `SELECT u.*, v.id AS vehiculo_id, v.patente, v.estado AS vehiculo_estado
       FROM usuarios u LEFT JOIN vehiculos v ON v.conductor_id = u.id
      WHERE u.id = ? AND u.rol = 'conductor'`,
  ).get(id);
  if (!fila) throw noEncontrado('El conductor');
  return fila;
}

export function actualizarConductor(id, { nombre, email, telefono, rut }) {
  const actual = exigirConductor(id);
  try {
    sql(
      `UPDATE usuarios SET nombre = ?, email = ?, telefono = ?, rut_cifrado = ?, rut_indice = ?,
              actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    ).run(
      nombre ?? actual.nombre,
      email ?? actual.email,
      telefono === undefined ? actual.telefono : telefono,
      rut ? cifrar(rut) : actual.rut_cifrado,
      rut ? indiceCiego(rut) : actual.rut_indice,
      id,
    );
  } catch (error) {
    if (esErrorDeRestriccion(error, 'usuarios.email')) throw conflicto('Ya existe una cuenta con ese correo', 'email_duplicado');
    if (esErrorDeRestriccion(error, 'usuarios.rut_indice')) throw conflicto('Ya existe una persona registrada con ese RUT', 'rut_duplicado');
    throw error;
  }
  return exigirConductor(id);
}
