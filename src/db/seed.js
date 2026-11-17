/**
 * Datos de demostración. Todas las personas, RUT y patentes son FICTICIOS.
 * Los trazados usan calles reales de Puente Alto (OpenStreetMap) solo como ejemplo.
 *
 *   npm run seed   -> borra todo y vuelve a cargar los datos de demostración
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { db, sql } from './sql.js';
import { alertasParada, auditoria, nosqlLista, retroalimentacion, telemetria } from './nosql.js';
import { digitoVerificador } from '../lib/rut.js';
import { generarSecreto } from '../lib/totp.js';
import { crearTrazado, limpiarCacheTrazados } from '../services/trazados.js';
import { crearUsuario } from '../services/usuarios.js';
import { pagarPasaje } from '../services/pagos.js';
import { finalizarTurno, iniciarTurno } from '../services/turnos.js';
import * as flota from '../services/flota.js';
import { DOMINIO_DEMO } from '../services/simulador.js';

const aqui = dirname(fileURLToPath(import.meta.url));

/** Clave única de las cuentas de demostración (se puede cambiar con la variable CLAVE_DEMO). */
export const CLAVE_DEMO = process.env.CLAVE_DEMO ?? 'Colectivo2026';

export const CUENTAS_DEMO = Object.freeze({
  admin: 'admin@demo.cl',
  conductor: 'conductor@demo.cl',
  pasajero: 'pasajero@demo.cl',
});

const rutFicticio = (cuerpo) => `${cuerpo}${digitoVerificador(cuerpo)}`;

async function vaciar() {
  db.exec(`
    DELETE FROM movimientos; DELETE FROM pagos; DELETE FROM billeteras; DELETE FROM turnos;
    DELETE FROM refresh_tokens; DELETE FROM vehiculos; DELETE FROM paraderos; DELETE FROM puntos_trazado;
    DELETE FROM trazados; DELETE FROM usuarios; DELETE FROM sqlite_sequence;
  `);
  limpiarCacheTrazados();
  flota.vaciar();
  for (const c of [telemetria, auditoria, retroalimentacion, alertasParada]) await c.removeAsync({}, { multi: true });
}

function crearVehiculo({ patente, marca, modelo, anio, trazadoId, conductorId, estado = 'validado' }) {
  const { lastInsertRowid } = sql(
    'INSERT INTO vehiculos (patente, marca, modelo, anio, capacidad_maxima, trazado_id, conductor_id, estado) VALUES (?, ?, ?, ?, 4, ?, ?, ?)',
  ).run(patente, marca, modelo, anio, trazadoId, conductorId, estado);
  return Number(lastInsertRowid);
}

export async function sembrar({ reiniciar = false } = {}) {
  await nosqlLista;
  if (reiniciar) await vaciar();

  // ---- Trazados (recorridos fijos) ----
  const { trazados: definiciones } = JSON.parse(readFileSync(join(aqui, 'datos', 'trazados.json'), 'utf8'));
  const trazados = definiciones.map((t) =>
    crearTrazado({
      codigo: t.codigo,
      nombre: t.nombre,
      comuna: t.comuna,
      color: t.color,
      tarifa: t.tarifa,
      puntos: t.puntos,
      paraderos: t.paraderos.map((p) => ({ ...p, nombre: p.nombre.replace(/^Avenida /, 'Av. ').replace(/ \((\d+)\)$/, ' · parada $1') })),
    }),
  );
  const [t1, t2, t3] = trazados;

  // ---- Sindicato (administrador con segundo factor obligatorio) ----
  await crearUsuario({
    nombre: 'Sindicato Puente Alto',
    email: CUENTAS_DEMO.admin,
    contrasena: CLAVE_DEMO,
    rol: 'admin',
    rut: rutFicticio('10000001'),
    mfaSecreto: generarSecreto(),
  });

  // ---- Conductor principal de la demostración ----
  const conductor = await crearUsuario({
    nombre: 'Luis Morales Pinto',
    email: CUENTAS_DEMO.conductor,
    contrasena: CLAVE_DEMO,
    rol: 'conductor',
    rut: rutFicticio('10000002'),
    telefono: '+56911110002',
  });
  const vehiculoPrincipal = crearVehiculo({ patente: 'HJKL45', marca: 'Nissan', modelo: 'V16', anio: 2019, trazadoId: t1.id, conductorId: conductor.id });

  // ---- Flota de demostración: se mueve sola para dar vida al mapa ----
  const flotaDemo = [
    ['Marta Fuentes Rivas', 'RSTV21', 'Hyundai', 'Accent', 2021, t1.id],
    ['Jorge Cárdenas Soto', 'BCDF34', 'Kia', 'Rio 4', 2020, t1.id],
    ['Elena Vidal Parra', 'GHJK78', 'Chevrolet', 'Sail', 2022, t1.id],
    ['Raúl Espinoza Díaz', 'PRST56', 'Toyota', 'Yaris', 2018, t2.id],
    ['Patricia Leiva Mora', 'WXYZ90', 'Nissan', 'Versa', 2021, t2.id],
    ['Héctor Olivares Rey', 'KLPR67', 'Suzuki', 'Dzire', 2023, t3.id],
    ['Sonia Bravo Tapia', 'FGHJ23', 'Hyundai', 'Accent', 2019, t3.id],
  ];
  for (const [i, [nombre, patente, marca, modelo, anio, trazadoId]] of flotaDemo.entries()) {
    const u = await crearUsuario({
      nombre,
      email: `conductor${i + 1}${DOMINIO_DEMO}`,
      contrasena: CLAVE_DEMO,
      rol: 'conductor',
      rut: rutFicticio(String(10000010 + i)),
    });
    crearVehiculo({ patente, marca, modelo, anio, trazadoId, conductorId: u.id });
  }

  // ---- Un conductor y un vehículo por validar (para mostrar el control del sindicato) ----
  const pendiente = await crearUsuario({
    nombre: 'Pedro Araya Núñez',
    email: 'pedro.araya@demo.cl',
    contrasena: CLAVE_DEMO,
    rol: 'conductor',
    estado: 'pendiente',
    rut: rutFicticio('10000030'),
    telefono: '+56911110030',
  });
  crearVehiculo({ patente: 'AB1234', marca: 'Samsung', modelo: 'SM3', anio: 2015, trazadoId: t2.id, conductorId: pendiente.id, estado: 'pendiente' });

  // ---- Pasajera de la demostración, con saldo para pagar pasajes ----
  const pasajera = await crearUsuario({
    nombre: 'Camila Rojas Vera',
    email: CUENTAS_DEMO.pasajero,
    contrasena: CLAVE_DEMO,
    rol: 'pasajero',
    saldoInicial: 5000,
  });

  // ---- Un turno ya cerrado con dos pagos, para que los historiales no partan vacíos ----
  iniciarTurno(conductor);
  pagarPasaje({ pasajeroId: pasajera.id, vehiculoId: vehiculoPrincipal, codigo: '00000000-0000-4000-8000-000000000001' });
  pagarPasaje({ pasajeroId: pasajera.id, vehiculoId: vehiculoPrincipal, codigo: '00000000-0000-4000-8000-000000000002' });
  finalizarTurno(conductor);
  await telemetria.removeAsync({}, { multi: true });

  // ---- Opiniones de ejemplo (marcadas como demo). La primera resume la retroalimentación
  //      real recogida con conductores en la Evaluación 2. ----
  await retroalimentacion.insertAsync([
    {
      tipo: 'problema',
      comentario: 'En calles con baches cuesta apretar los botones chicos. Ojalá fueran más grandes.',
      usuario: { id: conductor.id, rol: 'conductor', nombre: 'Luis' },
      contexto: { pantalla: 'conductor', ancho: 360, alto: 740, tactil: true },
      estado: 'resuelta',
      respuesta: 'Botones de cupos a pantalla completa y comandos de voz.',
      demo: true,
      ts: new Date(Date.now() - 20 * 86400000),
    },
    {
      tipo: 'sugerencia',
      puntaje: 4,
      comentario: 'Sería bueno ver cuántos minutos faltan para que llegue el colectivo a mi paradero.',
      usuario: { id: pasajera.id, rol: 'pasajero', nombre: 'Camila' },
      contexto: { pantalla: 'pasajero', ancho: 390, alto: 844, tactil: true },
      estado: 'resuelta',
      respuesta: 'Se agregó el tiempo estimado de llegada por paradero.',
      demo: true,
      ts: new Date(Date.now() - 12 * 86400000),
    },
  ]);

  return { trazados: trazados.length, conductores: flotaDemo.length + 2, pasajeros: 1 };
}

// Ejecución directa: npm run seed
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const reiniciar = process.argv.includes('--reiniciar');
  const resumen = await sembrar({ reiniciar });
  console.log('Datos de demostración cargados:', resumen);
  console.log('Cuentas: ver README.md (sección "Cuentas de demostración").');
  process.exit(0);
}
