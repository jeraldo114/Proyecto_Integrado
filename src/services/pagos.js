/**
 * Billetera y pagos. Cada pago es UNA transacción ACID:
 * descuenta al pasajero, abona al conductor y deja el registro, todo o nada.
 * La base rechaza saldos negativos (CHECK) aunque el código fallara.
 *
 * Alcance del prototipo: la recarga simula la respuesta de una pasarela certificada.
 * La plataforma nunca recibe ni guarda datos de tarjetas (PCI-DSS: se delega al adquirente).
 */
import { sql, transaccion } from '../db/sql.js';
import { config } from '../config.js';
import { conflicto, invalido, noEncontrado, ErrorHttp } from '../middleware/errores.js';

const saldoDe = (usuarioId) => sql('SELECT saldo FROM billeteras WHERE usuario_id = ?').get(usuarioId)?.saldo;

function mover(usuarioId, tipo, monto, pagoId = null) {
  const saldo = saldoDe(usuarioId);
  if (saldo === undefined) throw noEncontrado('La billetera');
  const nuevo = saldo + monto;
  if (nuevo < 0) throw new ErrorHttp(402, 'saldo_insuficiente', 'No tienes saldo suficiente. Recarga tu billetera.');
  sql("UPDATE billeteras SET saldo = ?, actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE usuario_id = ?").run(nuevo, usuarioId);
  sql('INSERT INTO movimientos (usuario_id, tipo, monto, saldo_resultante, pago_id) VALUES (?, ?, ?, ?, ?)').run(usuarioId, tipo, monto, nuevo, pagoId);
  return nuevo;
}

export function crearBilletera(usuarioId, saldoInicial = 0) {
  sql('INSERT INTO billeteras (usuario_id, saldo) VALUES (?, 0)').run(usuarioId);
  if (saldoInicial > 0) mover(usuarioId, 'recarga', saldoInicial);
}

export function verBilletera(usuarioId) {
  const saldo = saldoDe(usuarioId);
  if (saldo === undefined) throw noEncontrado('La billetera');
  const movimientos = sql(
    `SELECT m.id, m.tipo, m.monto, m.saldo_resultante, m.creado_en, v.patente, t.codigo AS trazado
       FROM movimientos m
       LEFT JOIN pagos p ON p.id = m.pago_id
       LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
       LEFT JOIN trazados t ON t.id = p.trazado_id
      WHERE m.usuario_id = ? ORDER BY m.id DESC LIMIT 30`,
  ).all(usuarioId);
  return { saldo, movimientos };
}

/** Recarga de saldo (simulación de pasarela aprobada). */
export function recargar(usuarioId, monto) {
  const { recargaMinima, recargaMaxima } = config.negocio;
  if (!Number.isInteger(monto) || monto < recargaMinima || monto > recargaMaxima) {
    throw invalido(`La recarga debe estar entre $${recargaMinima} y $${recargaMaxima}`);
  }
  return transaccion(() => ({ saldo: mover(usuarioId, 'recarga', monto) }));
}

/**
 * Pago de un pasaje. `codigo` es la llave de idempotencia que genera la app:
 * si la red falla y la app reintenta, el pasajero no paga dos veces.
 */
export function pagarPasaje({ pasajeroId, vehiculoId, codigo }) {
  return transaccion(() => {
    const previo = sql('SELECT id, monto, pasajero_id, creado_en FROM pagos WHERE codigo = ?').get(codigo);
    if (previo) {
      if (previo.pasajero_id !== pasajeroId) throw conflicto('Código de pago ya utilizado', 'codigo_duplicado');
      return { pago: previo, saldo: saldoDe(pasajeroId), repetido: true };
    }

    const turno = sql(
      `SELECT tu.id, tu.conductor_id, tu.trazado_id, t.tarifa, v.patente, v.estado
         FROM turnos tu
         JOIN vehiculos v ON v.id = tu.vehiculo_id
         JOIN trazados t ON t.id = tu.trazado_id
        WHERE tu.vehiculo_id = ? AND tu.fin IS NULL`,
    ).get(vehiculoId);
    if (!turno) {
      if (!sql('SELECT 1 FROM vehiculos WHERE id = ?').get(vehiculoId)) throw noEncontrado('El vehículo');
      throw conflicto('Ese colectivo no está en recorrido en este momento.', 'vehiculo_fuera_de_turno');
    }

    const { lastInsertRowid } = sql(
      'INSERT INTO pagos (codigo, pasajero_id, conductor_id, vehiculo_id, trazado_id, turno_id, monto) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(codigo, pasajeroId, turno.conductor_id, vehiculoId, turno.trazado_id, turno.id, turno.tarifa);
    const pagoId = Number(lastInsertRowid);

    const saldo = mover(pasajeroId, 'pago', -turno.tarifa, pagoId); // falla con 402 si no alcanza => ROLLBACK
    mover(turno.conductor_id, 'cobro', turno.tarifa, pagoId);

    return {
      pago: { id: pagoId, monto: turno.tarifa, patente: turno.patente, conductor_id: turno.conductor_id, creado_en: new Date().toISOString() },
      saldo,
      repetido: false,
    };
  });
}

export function listarPagos({ usuario, limite = 50 }) {
  const base = `SELECT p.id, p.monto, p.creado_en, v.patente, t.codigo AS trazado,
                       up.nombre AS pasajero, uc.nombre AS conductor
                  FROM pagos p
                  JOIN vehiculos v ON v.id = p.vehiculo_id
                  JOIN trazados t ON t.id = p.trazado_id
                  JOIN usuarios up ON up.id = p.pasajero_id
                  JOIN usuarios uc ON uc.id = p.conductor_id`;
  if (usuario.rol === 'admin') return sql(`${base} ORDER BY p.id DESC LIMIT ?`).all(limite);
  const columna = usuario.rol === 'conductor' ? 'p.conductor_id' : 'p.pasajero_id';
  return sql(`${base} WHERE ${columna} = ? ORDER BY p.id DESC LIMIT ?`).all(usuario.id, limite);
}
