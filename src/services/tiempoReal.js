/**
 * Canal en tiempo real (WebSocket). Empuja al pasajero cada cambio de posición o de
 * cupos del trazado que está mirando, sin que tenga que recargar.
 *
 * Seguridad: la conexión no entrega nada hasta que el cliente se autentica con su token
 * de acceso; se cierra sola cuando ese token expira y se limita el tamaño de los mensajes.
 */
import { WebSocketServer } from 'ws';
import { sql } from '../db/sql.js';
import { verificarToken } from './sesiones.js';
import * as flota from './flota.js';
import { recibeAvisos } from '../lib/cupos.js';

const clientes = new Set();

function enviar(ws, mensaje) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(mensaje));
}

function difundir(filtro, mensaje) {
  const texto = JSON.stringify(mensaje);
  for (const ws of clientes) {
    if (ws.readyState === ws.OPEN && ws.sesion && filtro(ws.sesion)) ws.send(texto);
  }
}

/** Mensaje directo a un usuario conectado (por ejemplo, "recibiste un pago"). */
export function notificarUsuario(usuarioId, mensaje) {
  difundir((s) => s.usuario.id === usuarioId, mensaje);
}

/** Aviso de pasajero esperando: solo llega a conductores del trazado que llevan cupos. */
export function avisarParada(trazadoId, aviso) {
  const conCupos = new Set(flota.deTrazado(trazadoId).filter((v) => recibeAvisos(v.cupos)).map((v) => v.conductor_id));
  difundir((s) => s.usuario.rol === 'conductor' && conCupos.has(s.usuario.id), { tipo: 'aviso_parada', ...aviso });
  return conCupos.size;
}

function alRecibir(ws, crudo) {
  let mensaje;
  try {
    mensaje = JSON.parse(crudo.toString());
  } catch {
    return enviar(ws, { tipo: 'error', mensaje: 'Mensaje inválido' });
  }

  if (mensaje.tipo === 'autenticar') {
    try {
      const datos = verificarToken(String(mensaje.token ?? ''), 'acceso');
      const usuario = sql('SELECT id, nombre, rol, estado FROM usuarios WHERE id = ?').get(datos.id);
      if (!usuario || usuario.estado === 'suspendido') throw new Error('cuenta no disponible');
      ws.sesion = { usuario, trazados: new Set() };
      clearTimeout(ws.temporizadorAuth);
      // La conexión no puede vivir más que el token que la autorizó.
      ws.temporizadorExpira = setTimeout(() => ws.close(4401, 'token expirado'), Math.max(1000, datos.exp * 1000 - Date.now()));
      return enviar(ws, { tipo: 'autenticado' });
    } catch {
      enviar(ws, { tipo: 'error', codigo: 'no_autenticado', mensaje: 'Sesión no válida' });
      return ws.close(4401, 'no autenticado');
    }
  }

  if (!ws.sesion) return enviar(ws, { tipo: 'error', codigo: 'no_autenticado', mensaje: 'Debes autenticarte primero' });

  if (mensaje.tipo === 'suscribir') {
    const trazadoId = Number(mensaje.trazado_id);
    if (!Number.isInteger(trazadoId) || trazadoId <= 0) return enviar(ws, { tipo: 'error', mensaje: 'Trazado inválido' });
    ws.sesion.trazados = new Set([trazadoId]); // un trazado a la vez: solo se envía lo que el usuario mira
    return enviar(ws, { tipo: 'flota', trazado_id: trazadoId, vehiculos: flota.deTrazado(trazadoId).map(flota.vistaPublica) });
  }
  if (mensaje.tipo === 'desuscribir') {
    ws.sesion.trazados.clear();
    return;
  }
  if (mensaje.tipo === 'ping') return enviar(ws, { tipo: 'pong' });
}

/** Conecta el servidor WebSocket al servidor HTTP y a los eventos de la flota. */
export function iniciarTiempoReal(servidorHttp) {
  const wss = new WebSocketServer({ server: servidorHttp, path: '/ws', maxPayload: 4096 });

  wss.on('connection', (ws) => {
    clientes.add(ws);
    ws.temporizadorAuth = setTimeout(() => ws.close(4401, 'sin autenticar'), 10000);
    ws.on('message', (datos) => alRecibir(ws, datos));
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(ws.temporizadorAuth);
      clearTimeout(ws.temporizadorExpira);
      clientes.delete(ws);
    });
  });

  const alMover = (estado) =>
    difundir((s) => s.trazados.has(estado.trazado_id), { tipo: 'vehiculo', vehiculo: flota.vistaPublica(estado) });
  const alSalir = ({ vehiculo_id, trazado_id }) =>
    difundir((s) => s.trazados.has(trazado_id), { tipo: 'vehiculo_fuera', vehiculo_id, trazado_id });
  flota.eventos.on('vehiculo', alMover);
  flota.eventos.on('fuera', alSalir);

  return {
    conexiones: () => clientes.size,
    cerrar() {
      flota.eventos.off('vehiculo', alMover);
      flota.eventos.off('fuera', alSalir);
      for (const ws of clientes) ws.terminate();
      wss.close();
    },
  };
}
