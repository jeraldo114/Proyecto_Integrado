/**
 * Genera los trazados de demostración (src/db/datos/trazados.json).
 *
 * Usa el servicio público de rutas de OpenStreetMap (OSRM) para obtener una polilínea
 * pegada a las calles entre dos puntos de Puente Alto. Solo se envían coordenadas
 * públicas; no viaja ningún dato personal. Se ejecuta una vez: el resultado queda
 * versionado en el repositorio y la aplicación NO depende de este servicio para funcionar.
 *
 * Uso: node scripts/generar-trazados.js
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { largoPolilinea, puntoEnDistancia } from '../src/lib/geo.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const PLAZA = { nombre: 'Plaza de Puente Alto', lat: -33.6098, lng: -70.5757 };

const DEFINICIONES = [
  {
    codigo: 'T-01',
    nombre: 'Plaza de Puente Alto – Hospital Sótero del Río',
    color: '#E6A700',
    tarifa: 800,
    origen: PLAZA,
    destino: { nombre: 'Hospital Sótero del Río', lat: -33.5769, lng: -70.5823 },
  },
  {
    codigo: 'T-02',
    nombre: 'Plaza de Puente Alto – Bajos de Mena',
    color: '#1F7A8C',
    tarifa: 900,
    origen: PLAZA,
    destino: { nombre: 'Bajos de Mena', lat: -33.6252, lng: -70.6126 },
  },
  {
    codigo: 'T-03',
    nombre: 'Plaza de Puente Alto – Las Vizcachas',
    color: '#B5446E',
    tarifa: 1000,
    origen: PLAZA,
    destino: { nombre: 'Las Vizcachas', lat: -33.5977, lng: -70.5154 },
  },
];

const SEPARACION_PARADEROS_M = 900;

async function pedirRuta(origen, destino) {
  const coords = `${origen.lng},${origen.lat};${destino.lng},${destino.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'route-demo-script/1.0' } });
  if (!res.ok) throw new Error(`OSRM respondió ${res.status}`);
  const json = await res.json();
  if (json.code !== 'Ok') throw new Error(`OSRM: ${json.code}`);
  return json.routes[0];
}

/** Devuelve el nombre de la calle que corresponde a una distancia recorrida de la ruta. */
function calleEnDistancia(pasos, distancia) {
  let acumulado = 0;
  let ultima = '';
  for (const paso of pasos) {
    if (paso.name) ultima = paso.name;
    acumulado += paso.distance;
    if (distancia <= acumulado) return paso.name || ultima;
  }
  return ultima;
}

const redondear = (n) => Math.round(n * 1e6) / 1e6;

const trazados = [];
for (const def of DEFINICIONES) {
  const ruta = await pedirRuta(def.origen, def.destino);
  const puntos = ruta.geometry.coordinates.map(([lng, lat]) => ({ lat: redondear(lat), lng: redondear(lng) }));
  const largo = largoPolilinea(puntos);
  const pasos = ruta.legs[0].steps;

  const cantidad = Math.max(2, Math.round(largo / SEPARACION_PARADEROS_M));
  const paraderos = [];
  for (let i = 0; i <= cantidad; i++) {
    const distancia = (largo * i) / cantidad;
    const p = puntoEnDistancia(puntos, distancia);
    let nombre;
    if (i === 0) nombre = def.origen.nombre;
    else if (i === cantidad) nombre = def.destino.nombre;
    else nombre = calleEnDistancia(pasos, distancia) || `Paradero ${i}`;
    paraderos.push({ nombre, lat: redondear(p.lat), lng: redondear(p.lng) });
  }
  // Evita nombres repetidos seguidos: agrega un número correlativo por calle.
  const vistos = new Map();
  for (const p of paraderos.slice(1, -1)) {
    const n = (vistos.get(p.nombre) || 0) + 1;
    vistos.set(p.nombre, n);
    p._n = n;
  }
  for (const p of paraderos.slice(1, -1)) {
    if (vistos.get(p.nombre) > 1) p.nombre = `${p.nombre} (${p._n})`;
    delete p._n;
  }

  trazados.push({
    codigo: def.codigo,
    nombre: def.nombre,
    comuna: 'Puente Alto',
    color: def.color,
    tarifa: def.tarifa,
    largo_m: Math.round(largo),
    puntos,
    paraderos,
  });
  console.log(`${def.codigo}: ${puntos.length} puntos, ${(largo / 1000).toFixed(1)} km, ${paraderos.length} paraderos`);
  await new Promise((r) => setTimeout(r, 1200));
}

const destino = join(raiz, 'src', 'db', 'datos', 'trazados.json');
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, JSON.stringify({ fuente: 'OpenStreetMap / OSRM (datos de demostración)', trazados }));
console.log('Escrito', destino);
