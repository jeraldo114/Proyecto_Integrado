/**
 * Entorno para las pruebas de rendimiento.
 * Se apaga el límite de solicitudes por IP: en la prueba toda la carga sale de una sola
 * máquina (una IP), mientras que en operación real viene de miles de teléfonos distintos.
 * El límite sí se prueba, activado, en tests/integration/autenticacion.test.js.
 */
process.env.LIMITES_ACTIVOS = 'false';
await import('./entorno.js');
