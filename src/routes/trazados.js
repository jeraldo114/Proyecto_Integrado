/** Trazados, flota en vivo y avisos de parada. */
import { Router } from 'express';
import { config } from '../config.js';
import { alertasParada } from '../db/nosql.js';
import { distanciaHastaParadero, etaMinutos, proyectarEnPolilinea } from '../lib/geo.js';
import { autenticar, autorizar, ROLES } from '../middleware/auth.js';
import { noEncontrado, prohibido } from '../middleware/errores.js';
import { validar, z, id, paramsId, texto, colorHex, latitud, longitud } from '../middleware/validar.js';
import { auditar } from '../services/auditoria.js';
import * as flota from '../services/flota.js';
import { avisarParada } from '../services/tiempoReal.js';
import { actualizarTrazado, crearTrazado, eliminarTrazado, listarTrazados, obtenerTrazado } from '../services/trazados.js';

export const rutasTrazados = Router();
rutasTrazados.use(autenticar);

const punto = z.strictObject({ lat: latitud, lng: longitud });
const paradero = z.strictObject({ nombre: texto(2, 60, 'El nombre del paradero'), lat: latitud, lng: longitud });
const cuerpoTrazado = z.strictObject({
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z]-?\d{2,3}$/, 'El código debe tener la forma T-01'),
  nombre: texto(4, 80, 'El nombre'),
  comuna: texto(2, 40, 'La comuna'),
  color: colorHex,
  tarifa: z.number({ error: 'La tarifa es obligatoria' }).int('La tarifa no lleva decimales').min(100, 'La tarifa mínima es $100').max(10000, 'La tarifa máxima es $10.000'),
  activo: z.boolean().optional(),
  puntos: z.array(punto).min(2, 'El recorrido necesita al menos 2 puntos').max(2000, 'El recorrido tiene demasiados puntos'),
  paraderos: z.array(paradero).min(2, 'Define al menos 2 paraderos').max(60, 'Demasiados paraderos'),
});

/** Los pasajeros y conductores solo ven trazados activos. */
function trazadoVisible(req, trazadoId) {
  const trazado = obtenerTrazado(trazadoId);
  if (!trazado.activo && req.usuario.rol !== ROLES.ADMIN) throw noEncontrado('El trazado');
  return trazado;
}

rutasTrazados.get('/', (req, res) => {
  const lista = listarTrazados({ soloActivos: req.usuario.rol !== ROLES.ADMIN });
  res.json({ trazados: lista.map((t) => ({ ...t, en_recorrido: flota.deTrazado(t.id).length })) });
});

rutasTrazados.get('/:id', validar({ params: paramsId }), (req, res) => {
  res.json({ trazado: trazadoVisible(req, req.datos.params.id) });
});

rutasTrazados.post('/', autorizar(ROLES.ADMIN), validar({ body: cuerpoTrazado }), (req, res) => {
  const trazado = crearTrazado(req.datos.body);
  auditar(req, 'crear', 'trazados', { id: trazado.id, codigo: trazado.codigo });
  res.status(201).json({ trazado });
});

rutasTrazados.put(
  '/:id',
  autorizar(ROLES.ADMIN),
  validar({ params: paramsId, body: cuerpoTrazado.partial().refine((c) => !c.paraderos || c.puntos, 'Para cambiar paraderos envía también el recorrido') }),
  (req, res) => {
    const trazado = actualizarTrazado(req.datos.params.id, req.datos.body);
    auditar(req, 'actualizar', 'trazados', { id: trazado.id, campos: Object.keys(req.datos.body) });
    res.json({ trazado });
  },
);

rutasTrazados.delete('/:id', autorizar(ROLES.ADMIN), validar({ params: paramsId }), (req, res) => {
  eliminarTrazado(req.datos.params.id);
  auditar(req, 'eliminar', 'trazados', { id: req.datos.params.id });
  res.status(204).end();
});

/**
 * Flota en vivo de un trazado (HU-01). Si se indica un paradero, agrega para cada
 * colectivo la distancia y el tiempo estimado de llegada.
 */
rutasTrazados.get(
  '/:id/flota',
  validar({ params: paramsId, query: z.strictObject({ paradero_id: id.optional() }) }),
  (req, res) => {
    const trazado = trazadoVisible(req, req.datos.params.id);
    const paraderoElegido = req.datos.query.paradero_id
      ? trazado.paraderos.find((p) => p.id === req.datos.query.paradero_id)
      : null;
    if (req.datos.query.paradero_id && !paraderoElegido) throw noEncontrado('El paradero');

    const vehiculos = flota.deTrazado(trazado.id).map((v) => {
      const publico = flota.vistaPublica(v);
      if (!paraderoElegido) return publico;
      const distancia = distanciaHastaParadero(v.progreso_m, v.sentido, paraderoElegido.progreso_m, trazado.largo_m);
      return { ...publico, distancia_m: Math.round(distancia), eta_min: etaMinutos(distancia, config.negocio.velocidadPromedioKmh) };
    });
    if (paraderoElegido) vehiculos.sort((a, b) => a.distancia_m - b.distancia_m);
    res.json({ trazado_id: trazado.id, actualizado: new Date().toISOString(), vehiculos });
  },
);

/** Geocerca del pasajero: ¿está sobre el trazado? Si no, se le indica hacia dónde caminar. */
rutasTrazados.post('/:id/ubicar', validar({ params: paramsId, body: punto }), (req, res) => {
  const trazado = trazadoVisible(req, req.datos.params.id);
  const proyeccion = proyectarEnPolilinea(trazado.puntos, req.datos.body);
  const cercano = trazado.paraderos.reduce((mejor, p) =>
    Math.abs(p.progreso_m - proyeccion.progreso) < Math.abs(mejor.progreso_m - proyeccion.progreso) ? p : mejor,
  );
  res.json({
    en_trazado: proyeccion.distancia <= config.negocio.geocercaMetros,
    distancia_m: Math.round(proyeccion.distancia),
    punto_mas_cercano: proyeccion.punto,
    paradero_sugerido: { id: cercano.id, nombre: cercano.nombre },
    minutos_caminando: Math.max(1, Math.round(proyeccion.distancia / 80)), // ~4,8 km/h
  });
});

/** El pasajero avisa que espera en un paradero. Los colectivos llenos no reciben el aviso (HU-02). */
rutasTrazados.post(
  '/:id/avisos',
  autorizar(ROLES.PASAJERO),
  validar({ params: paramsId, body: z.strictObject({ paradero_id: id }) }),
  async (req, res) => {
    const trazado = trazadoVisible(req, req.datos.params.id);
    const paraderoElegido = trazado.paraderos.find((p) => p.id === req.datos.body.paradero_id);
    if (!paraderoElegido) throw noEncontrado('El paradero');

    // Un aviso vigente por pasajero: evita llenar de avisos a los conductores.
    await alertasParada.removeAsync({ pasajero_id: req.usuario.id }, { multi: true });
    await alertasParada.insertAsync({ trazado_id: trazado.id, paradero_id: paraderoElegido.id, paradero: paraderoElegido.nombre, pasajero_id: req.usuario.id, ts: new Date() });
    const avisados = avisarParada(trazado.id, { trazado_id: trazado.id, paradero_id: paraderoElegido.id, paradero: paraderoElegido.nombre });
    res.status(201).json({ paradero: paraderoElegido.nombre, colectivos_avisados: avisados, vigencia_min: config.tiempoReal.minutosAlertaParada });
  },
);

/** Avisos vigentes del trazado, agrupados por paradero (pantalla del conductor). */
rutasTrazados.get('/:id/avisos', autorizar(ROLES.CONDUCTOR, ROLES.ADMIN), validar({ params: paramsId }), async (req, res) => {
  const trazado = trazadoVisible(req, req.datos.params.id);
  if (req.usuario.rol === ROLES.CONDUCTOR) {
    const propio = flota.deTrazado(trazado.id).find((v) => v.conductor_id === req.usuario.id);
    if (!propio) throw prohibido('Solo puedes ver los avisos de tu trazado mientras estás en turno');
    if (propio.cupos === 0) return res.json({ avisos: [], motivo: 'lleno' });
  }
  const desde = new Date(Date.now() - config.tiempoReal.minutosAlertaParada * 60000);
  const docs = await alertasParada.findAsync({ trazado_id: trazado.id, ts: { $gte: desde } });
  const porParadero = new Map();
  for (const d of docs) {
    const actual = porParadero.get(d.paradero_id) ?? { paradero_id: d.paradero_id, paradero: d.paradero, pasajeros: 0 };
    actual.pasajeros++;
    porParadero.set(d.paradero_id, actual);
  }
  res.json({ avisos: [...porParadero.values()] });
});
