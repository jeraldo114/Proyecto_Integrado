/**
 * Mapa (Leaflet + OpenStreetMap). Los marcadores se dibujan con clases CSS de la guía de
 * estilo. Si no hay internet para descargar las calles, el trazado y los colectivos se
 * siguen viendo sobre fondo gris.
 */
import { h, textoCupos, claseCupos, patenteLegible } from './ui.js';

const L = window.L;

export function crearMapa(contenedor) {
  const mapa = L.map(contenedor, { zoomControl: true, attributionControl: true, zoomSnap: 0.5 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(mapa);
  mapa.setView([-33.6098, -70.5757], 13);
  // El contenedor puede cambiar de tamaño al girar el teléfono o abrir un panel.
  const observador = new ResizeObserver(() => mapa.invalidateSize());
  observador.observe(contenedor);
  mapa.on('unload', () => observador.disconnect());
  return mapa;
}

const iconoDiv = (elemento, tam, clase = '') =>
  L.divIcon({ html: elemento, className: clase, iconSize: [tam, tam], iconAnchor: [tam / 2, tam / 2] });

/** Capa de un trazado: polilínea + paraderos. */
export function dibujarTrazado(mapa, trazado, { alElegirParadero, ajustar = true } = {}) {
  const grupo = L.layerGroup().addTo(mapa);
  const coordenadas = trazado.puntos.map((p) => [p.lat, p.lng]);
  L.polyline(coordenadas, { color: '#101214', weight: 9, opacity: 0.9 }).addTo(grupo);
  L.polyline(coordenadas, { color: trazado.color, weight: 5 }).addTo(grupo);

  const marcadores = new Map();
  for (const p of trazado.paraderos) {
    const m = L.marker([p.lat, p.lng], {
      icon: iconoDiv(h('div', { class: 'marcador-paradero' }), 16),
      title: p.nombre,
      keyboard: true,
      zIndexOffset: 100,
    }).addTo(grupo);
    m.bindTooltip(p.nombre, { direction: 'top', offset: [0, -8] });
    if (alElegirParadero) m.on('click', () => alElegirParadero(p));
    marcadores.set(p.id, m);
  }
  if (ajustar && coordenadas.length) mapa.fitBounds(L.latLngBounds(coordenadas), { padding: [28, 28] });

  return {
    grupo,
    elegir(paraderoId) {
      for (const [id, m] of marcadores) {
        const elegido = id === paraderoId;
        m.setIcon(iconoDiv(h('div', { class: `marcador-paradero${elegido ? ' marcador-paradero--elegido' : ''}` }), elegido ? 24 : 16));
        m.setZIndexOffset(elegido ? 300 : 100);
      }
    },
    quitar: () => grupo.remove(),
  };
}

/** Capa de colectivos en vivo. Cada vehículo muestra sus asientos libres; los llenos van en gris. */
export function capaFlota(mapa, { alTocar, propioId = null } = {}) {
  const grupo = L.layerGroup().addTo(mapa);
  const marcadores = new Map(); // vehiculo_id -> { marcador, firma }

  const crearIcono = (v) => {
    const clase = claseCupos(v.cupos);
    const propio = v.vehiculo_id === propioId ? ' marcador-colectivo--propio' : '';
    return iconoDiv(h('div', { class: `marcador-colectivo marcador-colectivo--${clase}${propio}` }, v.cupos > 0 ? String(v.cupos) : 'LLENO'), 38, 'marcador-movil');
  };

  function actualizar(v) {
    const etiqueta = `${patenteLegible(v.patente)} · ${textoCupos(v.cupos)}`;
    const existente = marcadores.get(v.vehiculo_id);
    if (existente) {
      existente.marcador.setLatLng([v.lat, v.lng]);
      if (existente.firma !== v.cupos) {
        existente.marcador.setIcon(crearIcono(v));
        existente.firma = v.cupos;
      }
      existente.marcador.setZIndexOffset(v.cupos > 0 ? 600 : 400);
      existente.marcador.getTooltip()?.setContent(etiqueta);
      existente.datos = v;
      return;
    }
    const marcador = L.marker([v.lat, v.lng], { icon: crearIcono(v), zIndexOffset: v.cupos > 0 ? 600 : 400, title: etiqueta }).addTo(grupo);
    marcador.bindTooltip(etiqueta, { direction: 'top', offset: [0, -18] });
    const registro = { marcador, firma: v.cupos, datos: v };
    if (alTocar) marcador.on('click', () => alTocar(registro.datos));
    marcadores.set(v.vehiculo_id, registro);
  }

  return {
    actualizar,
    reemplazar(vehiculos) {
      const vigentes = new Set(vehiculos.map((v) => v.vehiculo_id));
      for (const [id, r] of marcadores) {
        if (!vigentes.has(id)) {
          r.marcador.remove();
          marcadores.delete(id);
        }
      }
      vehiculos.forEach(actualizar);
    },
    quitar(vehiculoId) {
      marcadores.get(vehiculoId)?.marcador.remove();
      marcadores.delete(vehiculoId);
    },
    vaciar() {
      grupo.clearLayers();
      marcadores.clear();
    },
  };
}

/** Marca dónde está el pasajero y, si está lejos del trazado, la línea por la que debe caminar. */
export function capaPersona(mapa) {
  const grupo = L.layerGroup().addTo(mapa);
  return {
    mostrar(posicion, destino) {
      grupo.clearLayers();
      L.marker([posicion.lat, posicion.lng], { icon: iconoDiv(h('div', { class: 'marcador-persona' }), 20), zIndexOffset: 900, title: 'Tu ubicación' }).addTo(grupo);
      if (destino) {
        L.polyline(
          [
            [posicion.lat, posicion.lng],
            [destino.lat, destino.lng],
          ],
          { color: '#1d4ed8', weight: 4, dashArray: '2 10', lineCap: 'round' },
        ).addTo(grupo);
      }
    },
    limpiar: () => grupo.clearLayers(),
  };
}

export const iconoVertice = () => iconoDiv(h('div', { class: 'marcador-vertice' }), 12);
export const iconoParadero = () => iconoDiv(h('div', { class: 'marcador-paradero marcador-paradero--elegido' }), 24);
export { L };
