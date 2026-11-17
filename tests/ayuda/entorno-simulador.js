/** Entorno para probar el simulador GPS: mismo entorno de pruebas, con pasos muy cortos. */
process.env.SIMULADOR_INTERVALO_MS = '40';
await import('./entorno.js');
