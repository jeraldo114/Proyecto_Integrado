/**
 * Canal en tiempo real del navegador (WebSocket) con reconexión automática.
 * Si el canal se cae, la pantalla sigue funcionando: consulta la flota cada 3 segundos
 * hasta que vuelva la conexión (continuidad del servicio).
 */
import { api, renovar, sesion } from './api.js';

export function crearCanal() {
  const oyentes = new Map(); // tipo -> Set<fn>
  let ws = null;
  let trazado = null;
  let cerrado = false;
  let intentos = 0;
  let reconexion = null;
  let sondeo = null;

  const emitir = (tipo, datos) => {
    for (const fn of oyentes.get(tipo) ?? []) fn(datos);
  };

  function detenerSondeo() {
    clearInterval(sondeo);
    sondeo = null;
  }

  function iniciarSondeo() {
    if (sondeo || cerrado) return;
    emitir('estado', { conectado: false });
    sondeo = setInterval(async () => {
      if (!trazado) return;
      try {
        const datos = await api.get(`/trazados/${trazado}/flota`);
        emitir('flota', { trazado_id: trazado, vehiculos: datos.vehiculos });
      } catch {
        /* se reintenta en el próximo ciclo */
      }
    }, 3000);
  }

  async function conectar() {
    if (cerrado) return;
    if (!sesion.token) {
      try {
        if (!(await renovar())) return;
      } catch {
        return programar();
      }
    }
    const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocolo}://${location.host}/ws`);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ tipo: 'autenticar', token: sesion.token })));
    ws.addEventListener('message', (evento) => {
      let mensaje;
      try {
        mensaje = JSON.parse(evento.data);
      } catch {
        return;
      }
      if (mensaje.tipo === 'autenticado') {
        intentos = 0;
        detenerSondeo();
        emitir('estado', { conectado: true });
        if (trazado) ws.send(JSON.stringify({ tipo: 'suscribir', trazado_id: trazado }));
        return;
      }
      emitir(mensaje.tipo, mensaje);
    });
    ws.addEventListener('close', async (evento) => {
      ws = null;
      if (cerrado) return;
      iniciarSondeo();
      if (evento.code === 4401) {
        // El token que autorizó la conexión expiró: se renueva antes de reconectar.
        try {
          if (!(await renovar())) return;
        } catch {
          /* sin red: se reintenta */
        }
      }
      programar();
    });
    ws.addEventListener('error', () => {});
  }

  function programar() {
    clearTimeout(reconexion);
    const espera = Math.min(15000, 1000 * 2 ** intentos++);
    reconexion = setTimeout(conectar, espera);
  }

  conectar();

  return {
    on(tipo, fn) {
      if (!oyentes.has(tipo)) oyentes.set(tipo, new Set());
      oyentes.get(tipo).add(fn);
    },
    suscribir(trazadoId) {
      trazado = trazadoId;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo: 'suscribir', trazado_id: trazadoId }));
    },
    cerrar() {
      cerrado = true;
      clearTimeout(reconexion);
      detenerSondeo();
      ws?.close();
    },
  };
}
