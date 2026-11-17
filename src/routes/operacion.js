/** Operación diaria: turno del conductor, billetera, pagos y opiniones de usuarios. */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { retroalimentacion } from '../db/nosql.js';
import { autenticar, autorizar, ROLES } from '../middleware/auth.js';
import { conflicto } from '../middleware/errores.js';
import { validar, z, id, latitud, longitud } from '../middleware/validar.js';
import { auditar } from '../services/auditoria.js';
import * as flota from '../services/flota.js';
import { listarPagos, pagarPasaje, recargar, verBilletera } from '../services/pagos.js';
import { notificarUsuario } from '../services/tiempoReal.js';
import { actualizarCupos, estadoConductor, finalizarTurno, iniciarTurno, recaudacion } from '../services/turnos.js';

export const rutasOperacion = Router();
rutasOperacion.use(autenticar);

// ======================= Turno del conductor =======================
// Cada conductor solo puede escribir sobre SU propio estado: el vehículo se deduce de la
// sesión, nunca de un identificador enviado por el cliente (evita modificar autos ajenos).

const soloConductor = autorizar(ROLES.CONDUCTOR);

rutasOperacion.get('/turno', soloConductor, (req, res) => {
  res.json(estadoConductor(req.usuario));
});

rutasOperacion.post(
  '/turno/iniciar',
  soloConductor,
  validar({ body: z.strictObject({ origen: z.enum(['simulado', 'gps']).default('simulado') }) }),
  (req, res) => {
    const turno = iniciarTurno(req.usuario, req.datos.body);
    auditar(req, 'iniciar_turno', 'turnos', { turno_id: turno.id, vehiculo_id: turno.vehiculo_id });
    res.status(201).json(estadoConductor(req.usuario));
  },
);

rutasOperacion.post('/turno/finalizar', soloConductor, (req, res) => {
  const resumen = finalizarTurno(req.usuario);
  auditar(req, 'finalizar_turno', 'turnos', resumen);
  res.json({ ...estadoConductor(req.usuario), resumen });
});

rutasOperacion.put(
  '/turno/cupos',
  soloConductor,
  validar({
    body: z.strictObject({
      cupos: z.number({ error: 'Indica los cupos' }).int('Los cupos deben ser un número entero').min(0, 'Los cupos no pueden ser negativos').max(6),
      // Marca de tiempo del teléfono: permite reenviar cambios guardados sin conexión.
      registrado_en: z.iso.datetime().optional(),
    }),
  }),
  (req, res) => {
    res.json(actualizarCupos(req.usuario, req.datos.body.cupos));
  },
);

/** Posición real del GPS del teléfono. Se rechaza si el conductor no está en turno. */
rutasOperacion.post(
  '/turno/ubicacion',
  soloConductor,
  validar({ body: z.strictObject({ lat: latitud, lng: longitud, precision_m: z.number().min(0).max(5000).optional() }) }),
  (req, res) => {
    const estado = estadoConductor(req.usuario);
    if (!estado.turno) throw conflicto('Fuera de turno no se registra tu ubicación.', 'sin_turno');
    const resultado = flota.reportarGps(estado.turno.vehiculo_id, req.datos.body);
    if (resultado?.rechazado) {
      auditar(req, 'gps_sospechoso', 'telemetria', resultado);
      throw conflicto('La posición no es coherente con el recorrido anterior.', 'posicion_sospechosa');
    }
    if (resultado?.fuera_de_ruta) auditar(req, 'fuera_de_trazado', 'telemetria', { distancia_m: resultado.distancia_trazado_m });
    res.json(resultado);
  },
);

rutasOperacion.get('/turno/recaudacion', soloConductor, (req, res) => {
  res.json(recaudacion(req.usuario.id));
});

// ======================= Billetera y pagos =======================

rutasOperacion.get('/billetera', autorizar(ROLES.PASAJERO, ROLES.CONDUCTOR), (req, res) => {
  res.json(verBilletera(req.usuario.id));
});

rutasOperacion.post(
  '/billetera/recargas',
  autorizar(ROLES.PASAJERO),
  validar({ body: z.strictObject({ monto: z.number({ error: 'Indica el monto' }).int('El monto no lleva decimales').positive('El monto debe ser mayor que cero') }) }),
  (req, res) => {
    const resultado = recargar(req.usuario.id, req.datos.body.monto);
    auditar(req, 'recarga', 'billeteras', { monto: req.datos.body.monto });
    res.status(201).json(resultado);
  },
);

rutasOperacion.post(
  '/pagos',
  autorizar(ROLES.PASAJERO),
  validar({ body: z.strictObject({ vehiculo_id: id, codigo: z.uuid('Código de pago inválido').optional() }) }),
  (req, res) => {
    const resultado = pagarPasaje({
      pasajeroId: req.usuario.id,
      vehiculoId: req.datos.body.vehiculo_id,
      codigo: req.datos.body.codigo ?? randomUUID(),
    });
    if (!resultado.repetido) {
      auditar(req, 'pago', 'pagos', { pago_id: resultado.pago.id, monto: resultado.pago.monto, vehiculo_id: req.datos.body.vehiculo_id });
      notificarUsuario(resultado.pago.conductor_id, { tipo: 'pago_recibido', monto: resultado.pago.monto, pasajero: req.usuario.nombre.split(' ')[0] });
    }
    const { conductor_id, ...pago } = resultado.pago;
    res.status(resultado.repetido ? 200 : 201).json({ pago, saldo: resultado.saldo, repetido: resultado.repetido });
  },
);

rutasOperacion.get('/pagos', (req, res) => {
  const pagos = listarPagos({ usuario: req.usuario });
  // Minimización de datos: fuera del sindicato solo se muestra el primer nombre de la contraparte.
  const corto = (nombre) => String(nombre).split(' ')[0];
  res.json({
    pagos: req.usuario.rol === ROLES.ADMIN ? pagos : pagos.map((p) => ({ ...p, pasajero: corto(p.pasajero), conductor: corto(p.conductor) })),
  });
});

// ======================= Opiniones (retroalimentación de usuarios) =======================
// Documento flexible en NoSQL: cada opinión guarda el contexto que tenga disponible.

rutasOperacion.post(
  '/opiniones',
  validar({
    body: z.strictObject({
      tipo: z.enum(['sugerencia', 'problema', 'felicitacion']),
      puntaje: z.number().int().min(1).max(5).optional(),
      comentario: z.string().trim().min(5, 'Cuéntanos un poco más (mínimo 5 caracteres)').max(600, 'Máximo 600 caracteres'),
      contexto: z
        .strictObject({
          pantalla: z.string().max(60).optional(),
          ancho: z.number().int().min(0).max(10000).optional(),
          alto: z.number().int().min(0).max(10000).optional(),
          tactil: z.boolean().optional(),
        })
        .optional(),
    }),
  }),
  async (req, res) => {
    const doc = await retroalimentacion.insertAsync({
      ...req.datos.body,
      usuario: { id: req.usuario.id, rol: req.usuario.rol, nombre: req.usuario.nombre.split(' ')[0] },
      estado: 'nueva',
      ts: new Date(),
    });
    res.status(201).json({ id: doc._id });
  },
);
