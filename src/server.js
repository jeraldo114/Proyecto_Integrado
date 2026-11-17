/** Punto de entrada: levanta HTTP + WebSocket, restaura turnos y arranca el simulador. */
import { createServer } from 'node:http';
import { config } from './config.js';
import { crearApp } from './app.js';
import { db, sql } from './db/sql.js';
import { nosqlLista, cerrarNosql, purgarVencidosNosql } from './db/nosql.js';
import { sembrar } from './db/seed.js';
import { iniciarTiempoReal } from './services/tiempoReal.js';
import { iniciarSimulador } from './services/simulador.js';
import { restaurarTurnosAbiertos } from './services/turnos.js';
import { purgarVencidos } from './services/sesiones.js';

await nosqlLista;

// Primer arranque: si la base está vacía se cargan los datos de demostración.
if (sql('SELECT COUNT(*) AS n FROM usuarios').get().n === 0) {
  console.log('Base de datos vacía: cargando datos de demostración...');
  await sembrar();
}

const app = crearApp();
const servidor = createServer(app);
const tiempoReal = iniciarTiempoReal(servidor);

const restaurados = restaurarTurnosAbiertos();
const simulador = config.tiempoReal.simulador ? iniciarSimulador() : null;

// Limpieza periódica: sesiones vencidas y posiciones GPS fuera de su plazo de retención.
await purgarVencidosNosql();
const limpieza = setInterval(() => {
  purgarVencidos();
  purgarVencidosNosql().catch((e) => console.error('[limpieza]', e.message));
}, 10 * 60 * 1000);
limpieza.unref();

// backlog: cola de conexiones entrantes en espera; amplia para absorber la hora punta.
servidor.listen({ port: config.puerto, backlog: 2048 }, () => {
  console.log('');
  console.log('  Plataforma Digital Conatacoch');
  console.log(`  Abre en el navegador:  http://localhost:${config.puerto}`);
  console.log(`  Turnos restaurados: ${restaurados} · Simulador GPS: ${simulador ? 'activo' : 'apagado'}`);
  console.log('  Cuentas de demostración: ver README.md · Código del administrador: npm run mfa');
  console.log('');
});

servidor.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${config.puerto} está ocupado. Cierra la otra ventana del servidor o cambia PUERTO en .env`);
    process.exit(1);
  }
  throw error;
});

function apagar() {
  console.log('\nCerrando...');
  simulador?.detener();
  clearInterval(limpieza);
  tiempoReal.cerrar();
  cerrarNosql();
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
