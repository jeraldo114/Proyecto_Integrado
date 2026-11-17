/**
 * Entorno de pruebas. Debe importarse ANTES que cualquier módulo de src/.
 * Usa bases de datos en memoria: las pruebas nunca tocan los datos reales de data/.
 */
process.env.NODE_ENV = 'test';
process.env.LIMITE_LOGIN_POR_MINUTO = '5';
process.env.LIMITE_AUTENTICACION_POR_MINUTO = '100000'; // las pruebas hacen cientos de inicios de sesión desde una misma IP
process.env.LIMITE_API_POR_MINUTO = '100000';
process.env.SIMULADOR_GPS = 'false';
process.env.FLOTA_DEMO = 'false';
