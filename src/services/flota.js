/**
 * Flota en vivo: estado en memoria de cada colectivo que está en turno.
 * Es el "motor en tiempo real": cada cambio se emite como evento (arquitectura orientada
 * a eventos) y se guarda como documento de telemetría en la base NoSQL.
 * La fuente de verdad administrativa (quién conduce, qué turno) sigue en la base relacional.
 */
import { EventEmitter } from 'node:events';
import { telemetria } from '../db/nosql.js';
import { config } from '../config.js';
import { obtenerTrazado } from './trazados.js';
import { distanciaMetros, proyectarEnPolilinea, puntoEnDistancia } from '../lib/geo.js';

export const eventos = new EventEmitter();
eventos.setMaxListeners(50);

/** vehiculo_id -> estado vivo */
const enRuta = new Map();

const nombreCorto = (nombre) => {
  const [primero, segundo] = String(nombre).trim().split(/\s+/);
  return segundo ? `${primero} ${segundo[0]}.` : primero;
};

/** Lo que puede ver un pasajero: sin RUT, sin correo, solo nombre corto del conductor. */
export function vistaPublica(v) {
  return {
    vehiculo_id: v.vehiculo_id,
    patente: v.patente,
    modelo: v.modelo,
    conductor: v.conductor,
    trazado_id: v.trazado_id,
    cupos: v.cupos,
    capacidad: v.capacidad,
    lat: v.lat,
    lng: v.lng,
    rumbo: v.rumbo,
    velocidad_kmh: v.velocidad_kmh,
    progreso_m: Math.round(v.progreso_m),
    sentido: v.sentido,
    actualizado: v.actualizado,
  };
}

function guardarTelemetria(v) {
  // Documento JSON flexible (GeoJSON Point), listo para índices geoespaciales en MongoDB.
  return telemetria
    .insertAsync({
      patente: v.patente,
      vehiculo_id: v.vehiculo_id,
      trazado_id: v.trazado_id,
      turno_id: v.turno_id,
      ubicacion: { type: 'Point', coordinates: [v.lng, v.lat] },
      cupos: v.cupos,
      velocidad_kmh: v.velocidad_kmh,
      rumbo: v.rumbo,
      origen: v.origen,
      ...(v.fuera_de_ruta ? { alerta: 'fuera_de_trazado', distancia_trazado_m: v.distancia_trazado_m } : {}),
      ts: new Date(),
    })
    .catch((e) => {
      if (!config.esPrueba) console.error('[telemetria]', e.message);
    });
}

/** Un vehículo inicia turno: aparece en el mapa. */
export function entrar({ turno, vehiculo, conductor, origen = 'simulado', progreso = 0, sentido = 1 }) {
  const trazado = obtenerTrazado(vehiculo.trazado_id);
  const p = puntoEnDistancia(trazado.puntos, progreso);
  const estado = {
    vehiculo_id: vehiculo.id,
    patente: vehiculo.patente,
    modelo: `${vehiculo.marca} ${vehiculo.modelo}`,
    capacidad: vehiculo.capacidad_maxima,
    trazado_id: vehiculo.trazado_id,
    turno_id: turno.id,
    conductor_id: conductor.id,
    conductor: nombreCorto(conductor.nombre),
    cupos: turno.cupos_disponibles,
    lat: p.lat,
    lng: p.lng,
    rumbo: p.rumbo ?? 0,
    velocidad_kmh: 0,
    progreso_m: progreso,
    sentido,
    origen,
    fuera_de_ruta: false,
    actualizado: new Date().toISOString(),
  };
  enRuta.set(vehiculo.id, estado);
  guardarTelemetria(estado);
  eventos.emit('vehiculo', estado);
  return estado;
}

/** Fin de turno: el vehículo desaparece del mapa y deja de registrarse su ubicación. */
export function salir(vehiculoId) {
  const estado = enRuta.get(vehiculoId);
  if (!estado) return false;
  enRuta.delete(vehiculoId);
  eventos.emit('fuera', { vehiculo_id: vehiculoId, trazado_id: estado.trazado_id, conductor_id: estado.conductor_id });
  return true;
}

export function cambiarCupos(vehiculoId, cupos) {
  const estado = enRuta.get(vehiculoId);
  if (!estado) return null;
  estado.cupos = cupos;
  estado.actualizado = new Date().toISOString();
  guardarTelemetria(estado);
  eventos.emit('vehiculo', estado);
  return estado;
}

/** Avance calculado por el simulador (posición ya sobre el trazado). */
export function moverSimulado(vehiculoId, { progreso, sentido, velocidad }) {
  const estado = enRuta.get(vehiculoId);
  if (!estado) return null;
  const trazado = obtenerTrazado(estado.trazado_id);
  const p = puntoEnDistancia(trazado.puntos, progreso);
  Object.assign(estado, {
    lat: p.lat,
    lng: p.lng,
    rumbo: sentido === 1 ? p.rumbo : (p.rumbo + 180) % 360,
    progreso_m: progreso,
    sentido,
    velocidad_kmh: Math.round(velocidad),
    actualizado: new Date().toISOString(),
  });
  guardarTelemetria(estado);
  eventos.emit('vehiculo', estado);
  return estado;
}

/**
 * Posición enviada por el GPS real del teléfono del conductor.
 * Controles anti-fraude: velocidad imposible (GPS falso) y geocerca del trazado.
 */
export function reportarGps(vehiculoId, { lat, lng }) {
  const estado = enRuta.get(vehiculoId);
  if (!estado) return null;
  const trazado = obtenerTrazado(estado.trazado_id);
  const ahora = Date.now();
  const segundos = Math.max(1, (ahora - Date.parse(estado.actualizado)) / 1000);
  const salto = distanciaMetros({ lat: estado.lat, lng: estado.lng }, { lat, lng });
  const velocidad = (salto / segundos) * 3.6;
  if (estado.origen === 'gps' && velocidad > config.negocio.velocidadMaximaKmh) {
    return { rechazado: true, motivo: 'velocidad_imposible', velocidad_kmh: Math.round(velocidad) };
  }
  const proyeccion = proyectarEnPolilinea(trazado.puntos, { lat, lng });
  const fuera = proyeccion.distancia > config.negocio.geocercaMetros;
  Object.assign(estado, {
    lat,
    lng,
    sentido: proyeccion.progreso >= estado.progreso_m ? 1 : -1,
    progreso_m: proyeccion.progreso,
    velocidad_kmh: estado.origen === 'gps' ? Math.round(velocidad) : 0,
    origen: 'gps',
    fuera_de_ruta: fuera,
    distancia_trazado_m: Math.round(proyeccion.distancia),
    actualizado: new Date(ahora).toISOString(),
  });
  guardarTelemetria(estado);
  eventos.emit('vehiculo', estado);
  return { rechazado: false, fuera_de_ruta: fuera, distancia_trazado_m: estado.distancia_trazado_m };
}

export const obtener = (vehiculoId) => enRuta.get(vehiculoId) ?? null;
export const deTrazado = (trazadoId) => [...enRuta.values()].filter((v) => v.trazado_id === trazadoId);
export const todos = () => [...enRuta.values()];
export const vaciar = () => enRuta.clear();
