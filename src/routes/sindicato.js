/**
 * Panel del sindicato (rol administrador): conductores, vehículos, resumen, opiniones
 * y auditoría. Aquí se valida quién puede operar (REQ-F01: sin "colectivos piratas").
 */
import { Router } from 'express';
import { sql, transaccion, esErrorDeRestriccion } from '../db/sql.js';
import { retroalimentacion } from '../db/nosql.js';
import { ocupacion } from '../lib/cupos.js';
import { tokenAleatorio } from '../lib/cifrado.js';
import { autenticar, autorizar, ROLES } from '../middleware/auth.js';
import { conflicto, noEncontrado } from '../middleware/errores.js';
import { validar, z, id, paramsId, texto, email, rut, patente, telefono, contrasena } from '../middleware/validar.js';
import { auditar, ultimosEventos } from '../services/auditoria.js';
import * as flota from '../services/flota.js';
import { revocarTodos } from '../services/sesiones.js';
import { actualizarConductor, crearUsuario, exigirConductor, listarConductores, vistaConductor } from '../services/usuarios.js';

export const rutasSindicato = Router();
rutasSindicato.use(autenticar, autorizar(ROLES.ADMIN));

// ======================= Conductores =======================

rutasSindicato.get('/conductores', (req, res) => {
  res.json({ conductores: listarConductores().map((c) => vistaConductor(c, { rutCompleto: true })) });
});

rutasSindicato.post(
  '/conductores',
  validar({ body: z.strictObject({ nombre: texto(2, 80, 'El nombre'), email, rut, telefono, contrasena: contrasena.optional() }) }),
  async (req, res) => {
    const datos = req.datos.body;
    // Si el sindicato no define una clave, se genera una temporal que se muestra una sola vez.
    const temporal = datos.contrasena ? null : `${tokenAleatorio(9)}7a`;
    const usuario = await crearUsuario({ ...datos, contrasena: datos.contrasena ?? temporal, rol: 'conductor', estado: 'pendiente' });
    auditar(req, 'crear', 'conductores', { id: usuario.id });
    res.status(201).json({ conductor: vistaConductor(exigirConductor(usuario.id), { rutCompleto: true }), contrasena_temporal: temporal });
  },
);

rutasSindicato.put(
  '/conductores/:id',
  validar({ params: paramsId, body: z.strictObject({ nombre: texto(2, 80, 'El nombre'), email, rut, telefono }).partial() }),
  (req, res) => {
    const conductor = actualizarConductor(req.datos.params.id, req.datos.body);
    auditar(req, 'actualizar', 'conductores', { id: conductor.id, campos: Object.keys(req.datos.body) });
    res.json({ conductor: vistaConductor(conductor, { rutCompleto: true }) });
  },
);

/** Validar, suspender o reactivar a un conductor. Suspender cierra sus sesiones y su turno. */
rutasSindicato.patch(
  '/conductores/:id/estado',
  validar({ params: paramsId, body: z.strictObject({ estado: z.enum(['pendiente', 'activo', 'suspendido']) }) }),
  (req, res) => {
    const conductor = exigirConductor(req.datos.params.id);
    const { estado } = req.datos.body;
    sql("UPDATE usuarios SET estado = ?, actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(estado, conductor.id);
    if (estado === 'suspendido') {
      revocarTodos(conductor.id);
      const turno = sql('SELECT id, vehiculo_id FROM turnos WHERE conductor_id = ? AND fin IS NULL').get(conductor.id);
      if (turno) {
        sql("UPDATE turnos SET fin = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(turno.id);
        flota.salir(turno.vehiculo_id);
      }
    }
    auditar(req, 'cambiar_estado', 'conductores', { id: conductor.id, de: conductor.estado, a: estado });
    res.json({ conductor: vistaConductor(exigirConductor(conductor.id), { rutCompleto: true }) });
  },
);

rutasSindicato.delete('/conductores/:id', validar({ params: paramsId }), (req, res) => {
  const conductor = exigirConductor(req.datos.params.id);
  if (sql('SELECT 1 FROM turnos WHERE conductor_id = ?').get(conductor.id)) {
    throw conflicto('El conductor tiene historial de turnos. Suspéndelo en lugar de eliminarlo.', 'conductor_con_historial');
  }
  sql('DELETE FROM usuarios WHERE id = ?').run(conductor.id);
  auditar(req, 'eliminar', 'conductores', { id: conductor.id });
  res.status(204).end();
});

// ======================= Vehículos =======================

const SELECT_VEHICULO = `SELECT v.id, v.patente, v.marca, v.modelo, v.anio, v.capacidad_maxima, v.estado, v.creado_en,
                                v.trazado_id, t.codigo AS trazado_codigo, t.nombre AS trazado_nombre,
                                v.conductor_id, u.nombre AS conductor_nombre
                           FROM vehiculos v
                           JOIN trazados t ON t.id = v.trazado_id
                           LEFT JOIN usuarios u ON u.id = v.conductor_id`;

const vistaVehiculo = (v) => ({ ...v, en_recorrido: Boolean(flota.obtener(v.id)) });

function exigirVehiculo(vehiculoId) {
  const v = sql(`${SELECT_VEHICULO} WHERE v.id = ?`).get(vehiculoId);
  if (!v) throw noEncontrado('El vehículo');
  return v;
}

const cuerpoVehiculo = z.strictObject({
  patente,
  marca: texto(2, 30, 'La marca'),
  modelo: texto(1, 30, 'El modelo'),
  anio: z.number({ error: 'El año es obligatorio' }).int().min(1990, 'Año demasiado antiguo').max(new Date().getFullYear() + 1, 'Año inválido'),
  capacidad_maxima: z.number().int().min(1, 'Mínimo 1 asiento').max(6, 'Máximo 6 asientos').default(4),
  trazado_id: id,
  conductor_id: id.nullable().optional(),
});

function comprobarReferencias({ trazado_id, conductor_id }) {
  if (trazado_id !== undefined && !sql('SELECT 1 FROM trazados WHERE id = ?').get(trazado_id)) throw noEncontrado('El trazado');
  if (conductor_id) {
    if (!sql("SELECT 1 FROM usuarios WHERE id = ? AND rol = 'conductor'").get(conductor_id)) throw noEncontrado('El conductor');
  }
}

function traducirRestriccion(error) {
  if (esErrorDeRestriccion(error, 'vehiculos.patente')) return conflicto('Ya existe un vehículo con esa patente', 'patente_duplicada');
  if (esErrorDeRestriccion(error, 'vehiculos.conductor_id')) return conflicto('Ese conductor ya tiene otro vehículo asignado', 'conductor_ocupado');
  return error;
}

rutasSindicato.get('/vehiculos', (req, res) => {
  res.json({ vehiculos: sql(`${SELECT_VEHICULO} ORDER BY v.patente`).all().map(vistaVehiculo) });
});

rutasSindicato.post('/vehiculos', validar({ body: cuerpoVehiculo }), (req, res) => {
  const d = req.datos.body;
  comprobarReferencias(d);
  try {
    const { lastInsertRowid } = sql(
      'INSERT INTO vehiculos (patente, marca, modelo, anio, capacidad_maxima, trazado_id, conductor_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(d.patente, d.marca, d.modelo, d.anio, d.capacidad_maxima, d.trazado_id, d.conductor_id ?? null);
    auditar(req, 'crear', 'vehiculos', { id: Number(lastInsertRowid), patente: d.patente });
    res.status(201).json({ vehiculo: vistaVehiculo(exigirVehiculo(Number(lastInsertRowid))) });
  } catch (error) {
    throw traducirRestriccion(error);
  }
});

rutasSindicato.put('/vehiculos/:id', validar({ params: paramsId, body: cuerpoVehiculo.partial() }), (req, res) => {
  const actual = exigirVehiculo(req.datos.params.id);
  const d = req.datos.body;
  comprobarReferencias(d);
  if (flota.obtener(actual.id) && (d.trazado_id !== undefined || d.conductor_id !== undefined || d.capacidad_maxima !== undefined)) {
    throw conflicto('El vehículo está en recorrido. Espera al fin del turno para reasignarlo.', 'vehiculo_en_recorrido');
  }
  const nuevo = { ...actual, ...d };
  try {
    sql('UPDATE vehiculos SET patente = ?, marca = ?, modelo = ?, anio = ?, capacidad_maxima = ?, trazado_id = ?, conductor_id = ? WHERE id = ?').run(
      nuevo.patente, nuevo.marca, nuevo.modelo, nuevo.anio, nuevo.capacidad_maxima, nuevo.trazado_id, nuevo.conductor_id ?? null, actual.id,
    );
  } catch (error) {
    throw traducirRestriccion(error);
  }
  auditar(req, 'actualizar', 'vehiculos', { id: actual.id, campos: Object.keys(d) });
  res.json({ vehiculo: vistaVehiculo(exigirVehiculo(actual.id)) });
});

rutasSindicato.patch(
  '/vehiculos/:id/estado',
  validar({ params: paramsId, body: z.strictObject({ estado: z.enum(['pendiente', 'validado', 'suspendido']) }) }),
  (req, res) => {
    const actual = exigirVehiculo(req.datos.params.id);
    const { estado } = req.datos.body;
    transaccion(() => {
      sql('UPDATE vehiculos SET estado = ? WHERE id = ?').run(estado, actual.id);
      if (estado !== 'validado') {
        sql("UPDATE turnos SET fin = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE vehiculo_id = ? AND fin IS NULL").run(actual.id);
      }
    });
    if (estado !== 'validado') flota.salir(actual.id);
    auditar(req, 'cambiar_estado', 'vehiculos', { id: actual.id, patente: actual.patente, de: actual.estado, a: estado });
    res.json({ vehiculo: vistaVehiculo(exigirVehiculo(actual.id)) });
  },
);

rutasSindicato.delete('/vehiculos/:id', validar({ params: paramsId }), (req, res) => {
  const actual = exigirVehiculo(req.datos.params.id);
  if (sql('SELECT 1 FROM turnos WHERE vehiculo_id = ?').get(actual.id)) {
    throw conflicto('El vehículo tiene historial de turnos. Suspéndelo en lugar de eliminarlo.', 'vehiculo_con_historial');
  }
  sql('DELETE FROM vehiculos WHERE id = ?').run(actual.id);
  auditar(req, 'eliminar', 'vehiculos', { id: actual.id, patente: actual.patente });
  res.status(204).end();
});

// ======================= Resumen, opiniones y auditoría =======================

rutasSindicato.get('/resumen', (req, res) => {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const desde = hoy.toISOString();
  const enRuta = flota.todos();
  const conductores = sql("SELECT estado, COUNT(*) AS n FROM usuarios WHERE rol = 'conductor' GROUP BY estado").all();
  const vehiculos = sql('SELECT estado, COUNT(*) AS n FROM vehiculos GROUP BY estado').all();
  const pagosHoy = sql('SELECT COUNT(*) AS cantidad, COALESCE(SUM(monto), 0) AS total FROM pagos WHERE creado_en >= ?').get(desde);
  const porTrazado = sql(
    `SELECT t.id, t.codigo, t.nombre, t.color,
            (SELECT COUNT(*) FROM vehiculos v WHERE v.trazado_id = t.id AND v.estado = 'validado') AS vehiculos_validados,
            (SELECT COALESCE(SUM(p.monto), 0) FROM pagos p WHERE p.trazado_id = t.id AND p.creado_en >= ?) AS recaudado_hoy
       FROM trazados t ORDER BY t.codigo`,
  ).all(desde);
  const contar = (filas, estado) => filas.find((f) => f.estado === estado)?.n ?? 0;
  res.json({
    en_recorrido: enRuta.length,
    asientos_libres: enRuta.reduce((s, v) => s + v.cupos, 0),
    ocupacion_pct: ocupacion(enRuta),
    conductores: { activos: contar(conductores, 'activo'), pendientes: contar(conductores, 'pendiente'), suspendidos: contar(conductores, 'suspendido') },
    vehiculos: { validados: contar(vehiculos, 'validado'), pendientes: contar(vehiculos, 'pendiente'), suspendidos: contar(vehiculos, 'suspendido') },
    pasajeros: sql("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'pasajero'").get().n,
    pagos_hoy: pagosHoy,
    trazados: porTrazado.map((t) => {
      const vivos = flota.deTrazado(t.id);
      return { ...t, en_recorrido: vivos.length, ocupacion_pct: ocupacion(vivos) };
    }),
  });
});

rutasSindicato.get('/opiniones', async (req, res) => {
  const docs = await retroalimentacion.findAsync({}).sort({ ts: -1 }).limit(100);
  res.json({ opiniones: docs.map(({ _id, ...resto }) => ({ id: _id, ...resto })) });
});

rutasSindicato.patch(
  '/opiniones/:id',
  validar({
    params: z.strictObject({ id: z.string().regex(/^[A-Za-z0-9]{8,32}$/, 'Identificador inválido') }),
    body: z.strictObject({ estado: z.enum(['nueva', 'en_revision', 'resuelta']), respuesta: z.string().trim().max(400).optional() }),
  }),
  async (req, res) => {
    const cambios = { estado: req.datos.body.estado, revisado_por: req.usuario.id, revisado_en: new Date() };
    if (req.datos.body.respuesta) cambios.respuesta = req.datos.body.respuesta;
    const { numAffected } = await retroalimentacion.updateAsync({ _id: req.datos.params.id }, { $set: cambios });
    if (!numAffected) throw noEncontrado('La opinión');
    auditar(req, 'actualizar', 'opiniones', { id: req.datos.params.id, estado: cambios.estado });
    res.json({ ok: true });
  },
);

rutasSindicato.get('/auditoria', validar({ query: z.strictObject({ limite: z.coerce.number().int().min(1).max(200).default(60) }) }), async (req, res) => {
  res.json({ eventos: await ultimosEventos(req.datos.query.limite) });
});
