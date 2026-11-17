/** Pruebas unitarias: geometría del trazado (distancias, geocerca, llegada) y simulador. */
import '../ayuda/entorno.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { distanciaMetros, largoPolilinea, puntoEnDistancia, proyectarEnPolilinea, distanciaHastaParadero, etaMinutos, rumboEntre } from '../../src/lib/geo.js';
import { avanzar } from '../../src/services/simulador.js';

// Recorrido recto de sur a norte de ~2 km (cada 0,009° de latitud son ~1 km).
const RECTA = [
  { lat: -33.61, lng: -70.575 },
  { lat: -33.601, lng: -70.575 },
  { lat: -33.592, lng: -70.575 },
];
const cerca = (real, esperado, tolerancia) => assert.ok(Math.abs(real - esperado) <= tolerancia, `${real} no está a ±${tolerancia} de ${esperado}`);

describe('Distancias', () => {
  test('Haversine: 0,009° de latitud son cerca de 1 km', () => {
    cerca(distanciaMetros(RECTA[0], RECTA[1]), 1000, 5);
  });

  test('la distancia de un punto a sí mismo es 0', () => {
    assert.equal(distanciaMetros(RECTA[0], RECTA[0]), 0);
  });

  test('el largo de la polilínea suma sus tramos', () => {
    cerca(largoPolilinea(RECTA), 2000, 10);
    assert.equal(largoPolilinea([RECTA[0]]), 0);
  });

  test('rumbo: hacia el norte es 0° y hacia el este 90°', () => {
    assert.equal(rumboEntre(RECTA[0], RECTA[1]), 0);
    assert.equal(rumboEntre({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), 90);
  });
});

describe('Posición sobre el trazado', () => {
  test('punto a mitad de camino', () => {
    const p = puntoEnDistancia(RECTA, largoPolilinea(RECTA) / 2);
    cerca(p.lat, -33.601, 0.0001);
    cerca(p.lng, -70.575, 0.0001);
  });

  test('se limita a los extremos del trazado', () => {
    assert.deepEqual({ lat: puntoEnDistancia(RECTA, -50).lat }, { lat: RECTA[0].lat });
    assert.equal(puntoEnDistancia(RECTA, 999999).lat, RECTA[2].lat);
  });

  test('una polilínea vacía es un error', () => {
    assert.throws(() => puntoEnDistancia([], 10));
  });
});

describe('Geocerca (proyección sobre el trazado)', () => {
  test('un punto sobre la ruta está a ~0 m y conoce su avance', () => {
    const r = proyectarEnPolilinea(RECTA, { lat: -33.6055, lng: -70.575 });
    cerca(r.distancia, 0, 1);
    cerca(r.progreso, 500, 10);
  });

  test('un punto a ~470 m al este queda fuera de una geocerca de 200 m', () => {
    const r = proyectarEnPolilinea(RECTA, { lat: -33.601, lng: -70.57 });
    cerca(r.distancia, 465, 15);
    assert.ok(r.distancia > 200);
    cerca(r.punto.lng, -70.575, 0.0001); // el punto más cercano está sobre la ruta
  });

  test('más allá del final, el punto más cercano es el último vértice', () => {
    const r = proyectarEnPolilinea(RECTA, { lat: -33.58, lng: -70.575 });
    cerca(r.progreso, 2000, 10);
  });
});

describe('Llegada al paradero (ida y vuelta)', () => {
  const LARGO = 5000;
  test('de ida y el paradero está adelante', () => {
    assert.equal(distanciaHastaParadero(1000, 1, 3000, LARGO), 2000);
  });
  test('de ida y ya lo pasó: llega al final y vuelve', () => {
    assert.equal(distanciaHastaParadero(4000, 1, 3000, LARGO), 1000 + 2000);
  });
  test('de vuelta y el paradero está adelante', () => {
    assert.equal(distanciaHastaParadero(4000, -1, 3000, LARGO), 1000);
  });
  test('de vuelta y ya lo pasó: llega al inicio y regresa', () => {
    assert.equal(distanciaHastaParadero(2000, -1, 3000, LARGO), 2000 + 3000);
  });
  test('si está en el paradero la distancia es 0', () => {
    assert.equal(distanciaHastaParadero(3000, 1, 3000, LARGO), 0);
  });

  test('tiempo estimado: 2,5 km a 25 km/h son 6 minutos; mínimo 1', () => {
    assert.equal(etaMinutos(2500, 25), 6);
    assert.equal(etaMinutos(10, 25), 1);
    assert.equal(etaMinutos(1000, 0), null);
  });
});

describe('Simulador GPS', () => {
  test('avanza en su sentido', () => {
    assert.deepEqual(avanzar({ progreso: 100, sentido: 1 }, 50, 1000), { progreso: 150, sentido: 1 });
    assert.deepEqual(avanzar({ progreso: 100, sentido: -1 }, 50, 1000), { progreso: 50, sentido: -1 });
  });

  test('al llegar al final del trazado da la vuelta', () => {
    assert.deepEqual(avanzar({ progreso: 980, sentido: 1 }, 50, 1000), { progreso: 970, sentido: -1 });
  });

  test('al llegar al inicio retoma la ida', () => {
    assert.deepEqual(avanzar({ progreso: 20, sentido: -1 }, 50, 1000), { progreso: 30, sentido: 1 });
  });

  test('nunca sale del trazado', () => {
    let estado = { progreso: 0, sentido: 1 };
    for (let i = 0; i < 500; i++) {
      estado = avanzar(estado, 37, 1000);
      assert.ok(estado.progreso >= 0 && estado.progreso <= 1000);
    }
  });
});
