/**
 * Conductor: turno y cupos con un toque (HU-02).
 * Diseño de "memoria muscular": pocos botones, enormes y siempre en el mismo lugar,
 * tema oscuro permanente, confirmación por voz y vibración para no mirar la pantalla.
 */
import { api, ErrorRed } from '../api.js';
import { crearCanal } from '../tiempoReal.js';
import { h, reemplazar, icono, pesos, hora, fechaHora, patenteLegible, flotante, confirmar, conBoton, vacio, insignia } from '../ui.js';

const CLAVE_PENDIENTE = 'cupos-pendientes';

// ---- Voz (mejora integrada desde la retroalimentación de conductores) ----
const Reconocedor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
const PALABRAS = [
  [/\b(lleno|llena|completo|cero)\b/, 0],
  [/\b(uno|una|1)\b/, 1],
  [/\b(dos|2)\b/, 2],
  [/\b(tres|3)\b/, 3],
  [/\b(cuatro|4|libre|vac[ií]o)\b/, 4],
];

export function interpretarVoz(frase) {
  const texto = String(frase).toLowerCase();
  for (const [patron, cupos] of PALABRAS) if (patron.test(texto)) return cupos;
  return null;
}

function decir(texto) {
  try {
    if (!window.speechSynthesis) return;
    const mensaje = new SpeechSynthesisUtterance(texto);
    mensaje.lang = 'es-CL';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(mensaje);
  } catch {
    /* la voz es un apoyo: si falla, la app sigue igual */
  }
}

const fraseCupos = (cupos) => (cupos === 0 ? 'Lleno' : cupos === 1 ? 'Queda un asiento' : `Quedan ${cupos} asientos`);

// ============================================================ Mi turno

export async function vistaTurno(vista) {
  const contenedor = h('div', { class: 'conductor' });
  reemplazar(vista, contenedor);

  let estado = await api.get('/turno');
  let cuposMostrados = estado.turno?.cupos_disponibles ?? null;
  let avisos = [];
  let reconocimiento = null;
  let vozActiva = false;
  let gps = null; // id de watchPosition
  let ultimoEnvioGps = 0;
  const temporizadores = [];
  const canal = crearCanal();

  // ---- Modo sin señal: el último cambio se guarda en el teléfono y se reenvía solo ----
  const pendiente = () => JSON.parse(localStorage.getItem(CLAVE_PENDIENTE) ?? 'null');

  async function enviarCupos(cupos, { silencioso = false } = {}) {
    const registrado_en = new Date().toISOString();
    try {
      await api.put('/turno/cupos', { cupos, registrado_en });
      localStorage.removeItem(CLAVE_PENDIENTE);
      if (!silencioso) decir(fraseCupos(cupos));
      return true;
    } catch (error) {
      if (error instanceof ErrorRed) {
        localStorage.setItem(CLAVE_PENDIENTE, JSON.stringify({ cupos, registrado_en }));
        return false;
      }
      localStorage.removeItem(CLAVE_PENDIENTE);
      throw error;
    }
  }

  async function reintentarPendiente() {
    const p = pendiente();
    if (!p || !estado.turno) return;
    try {
      if (await enviarCupos(p.cupos, { silencioso: true })) {
        flotante('Volvió la señal: tus cupos quedaron actualizados.', 'exito');
        pintar();
      }
    } catch {
      /* el turno pudo haber terminado: se descarta el pendiente */
      pintar();
    }
  }

  async function marcar(cupos) {
    if (!estado.turno) return;
    cuposMostrados = cupos; // respuesta inmediata en pantalla
    navigator.vibrate?.(60);
    pintar();
    try {
      const enviado = await enviarCupos(cupos);
      if (!enviado) decir(`${fraseCupos(cupos)}. Sin señal, se enviará al reconectar`);
      if (cupos > 0) cargarAvisos();
      else avisos = [];
    } catch (error) {
      flotante(error.message, 'error');
      estado = await api.get('/turno');
      cuposMostrados = estado.turno?.cupos_disponibles ?? null;
    }
    pintar();
  }

  // ---- Avisos de pasajeros esperando (no llegan si el auto va lleno) ----
  async function cargarAvisos() {
    if (!estado.turno) return;
    try {
      avisos = (await api.get(`/trazados/${estado.turno.trazado_id}/avisos`)).avisos;
      pintarAvisos();
    } catch {
      /* se reintenta en el próximo ciclo */
    }
  }

  const zonaAvisos = h('section', { class: 'pila-chica', 'aria-live': 'polite' });
  function pintarAvisos() {
    if (!estado.turno) return reemplazar(zonaAvisos);
    if (cuposMostrados === 0) {
      return reemplazar(zonaAvisos, h('p', { class: 'chico suave' }, 'Vas lleno: no recibirás avisos de pasajeros hasta que se libere un asiento.'));
    }
    reemplazar(
      zonaAvisos,
      h('h2', null, 'Pasajeros esperando'),
      avisos.length
        ? avisos.map((a) => h('div', { class: 'aviso aviso--alerta' }, icono('campana'), h('p', null, `${a.paradero}: ${a.pasajeros} ${a.pasajeros === 1 ? 'pasajero' : 'pasajeros'}`)))
        : h('p', { class: 'chico suave' }, 'Nadie ha avisado en tu trazado en los últimos 10 minutos.'),
    );
  }

  // ---- Voz ----
  function alternarVoz() {
    if (!Reconocedor) return flotante('Este navegador no permite comandos de voz. Usa los botones.', 'error');
    if (vozActiva) {
      vozActiva = false;
      reconocimiento?.stop();
      return pintar();
    }
    try {
      reconocimiento = new Reconocedor();
      reconocimiento.lang = 'es-CL';
      reconocimiento.continuous = true;
      reconocimiento.interimResults = false;
      reconocimiento.onresult = (evento) => {
        const frase = evento.results[evento.results.length - 1][0].transcript;
        const cupos = interpretarVoz(frase);
        if (cupos !== null && cupos <= (estado.vehiculo?.capacidad_maxima ?? 4)) marcar(cupos);
      };
      reconocimiento.onerror = (evento) => {
        if (evento.error === 'not-allowed' || evento.error === 'service-not-allowed') {
          vozActiva = false;
          flotante('No hay permiso para usar el micrófono.', 'error');
          pintar();
        }
      };
      reconocimiento.onend = () => {
        if (vozActiva) {
          try {
            reconocimiento.start(); // el navegador corta la escucha cada cierto tiempo: se retoma
          } catch {
            vozActiva = false;
            pintar();
          }
        }
      };
      reconocimiento.start();
      vozActiva = true;
      decir('Voz activada. Di uno, dos, tres, libre o lleno');
    } catch {
      vozActiva = false;
      flotante('No se pudo activar el micrófono.', 'error');
    }
    pintar();
  }

  // ---- GPS real del teléfono (en la demo, la posición la mueve el simulador) ----
  function alternarGps() {
    if (gps !== null) {
      navigator.geolocation.clearWatch(gps);
      gps = null;
      return pintar();
    }
    if (!navigator.geolocation) return flotante('Este dispositivo no entrega ubicación.', 'error');
    gps = navigator.geolocation.watchPosition(
      async (p) => {
        if (!estado.turno || Date.now() - ultimoEnvioGps < 3000) return;
        ultimoEnvioGps = Date.now();
        try {
          const r = await api.post('/turno/ubicacion', { lat: p.coords.latitude, lng: p.coords.longitude, precision_m: Math.min(5000, p.coords.accuracy) });
          if (r.fuera_de_ruta) flotante(`Estás a ${r.distancia_trazado_m} m de tu trazado autorizado.`, 'error');
        } catch (error) {
          if (!(error instanceof ErrorRed)) flotante(error.message, 'error');
        }
      },
      () => {
        flotante('No pudimos leer el GPS del teléfono.', 'error');
        gps = null;
        pintar();
      },
      { enableHighAccuracy: true, maximumAge: 2000 },
    );
    flotante('Usando el GPS de este teléfono hasta el fin del turno.', 'exito');
    pintar();
  }

  // ---- Turno ----
  async function iniciar(boton) {
    await conBoton(boton, async () => {
      try {
        estado = await api.post('/turno/iniciar', { origen: 'simulado' });
        cuposMostrados = estado.turno.cupos_disponibles;
        decir('Turno iniciado. Buen viaje');
        cargarAvisos();
      } catch (error) {
        flotante(error.message, 'error');
      }
    });
    pintar();
  }

  async function finalizar() {
    const ok = await confirmar({
      titulo: '¿Terminar tu turno?',
      mensaje: 'Dejarás de aparecer en el mapa y tu ubicación deja de registrarse de inmediato.',
      aceptar: 'Sí, terminar turno',
      cancelar: 'Seguir en turno',
      peligro: true,
    });
    if (!ok) return;
    try {
      const r = await api.post('/turno/finalizar');
      estado = r;
      cuposMostrados = null;
      avisos = [];
      if (gps !== null) {
        navigator.geolocation.clearWatch(gps); // corte inmediato del rastreo (privacidad laboral)
        gps = null;
      }
      if (vozActiva) alternarVoz();
      localStorage.removeItem(CLAVE_PENDIENTE);
      flotante(`Turno terminado: ${r.resumen.pagos} ${r.resumen.pagos === 1 ? 'pago' : 'pagos'} por ${pesos(r.resumen.total)}.`, 'exito', 6000);
    } catch (error) {
      flotante(error.message, 'error');
    }
    pintar();
  }

  // ---- Pantalla ----
  // Los botones de cupos se crean UNA vez por turno y después solo cambian de estado.
  // Así nunca "se mueven" bajo el dedo: un toque rápido jamás cae en un botón recién reemplazado.
  let modoPintado = null;
  let piezas = null;

  function actualizarTurno() {
    for (const [cupos, boton] of piezas.botones) boton.setAttribute('aria-pressed', String(cuposMostrados === cupos));
    piezas.sinSenal.hidden = !pendiente();
    piezas.voz.setAttribute('aria-pressed', String(vozActiva));
    piezas.vozTexto.textContent = vozActiva ? 'Voz activada' : 'Activar voz';
    piezas.gps.setAttribute('aria-pressed', String(gps !== null));
    piezas.gpsTexto.textContent = gps !== null ? 'GPS del teléfono' : 'GPS simulado';
    pintarAvisos();
  }

  function pintar() {
    const v = estado.vehiculo;
    const modo = !v ? 'sin-vehiculo' : estado.turno ? 'turno' : 'fuera';
    if (modo === 'turno' && modoPintado === 'turno') return actualizarTurno();
    modoPintado = modo;

    if (!v) {
      return reemplazar(
        contenedor,
        h('h1', null, 'Mi turno'),
        h('div', { class: 'aviso aviso--alerta' }, icono('alerta'), h('p', null, 'Aún no tienes un vehículo asignado. Pide a tu sindicato que lo registre y lo valide.')),
      );
    }

    const cabecera = h(
      'header',
      { class: 'fila-entre envolver' },
      h('div', { class: 'pila-chica' }, h('span', { class: 'patente' }, patenteLegible(v.patente)), h('span', { class: 'chico suave' }, `${v.trazado_codigo} · ${v.trazado_nombre}`)),
      h('span', { class: `estado-turno${estado.turno ? ' estado-turno--activo' : ''}` }, estado.turno ? 'En recorrido' : 'Fuera de turno'),
    );

    if (!estado.turno) {
      const bloqueado = v.estado !== 'validado';
      const boton = h('button', { class: 'boton boton--primario boton--enorme boton--bloque', type: 'button', disabled: bloqueado }, 'INICIAR TURNO');
      boton.addEventListener('click', () => iniciar(boton));
      return reemplazar(
        contenedor,
        cabecera,
        bloqueado
          ? h('div', { class: 'aviso aviso--alerta' }, icono('alerta'), h('p', null, 'Tu vehículo todavía no está validado por el sindicato. Cuando lo validen podrás iniciar tu turno.'))
          : h('div', { class: 'aviso' }, icono('escudo'), h('p', null, 'Tu ubicación solo se comparte mientras estás en turno. Al terminar, el rastreo se corta de inmediato.')),
        h('div', { class: 'crecer' }),
        boton,
      );
    }

    const capacidad = v.capacidad_maxima;
    const botones = new Map();
    const botonCupo = (cupos, etiqueta, clase = '') => {
      const b = h(
        'button',
        { class: `cupo ${clase}`, type: 'button', 'aria-pressed': 'false', 'aria-label': fraseCupos(cupos) },
        h('strong', null, cupos === 0 ? 'LLENO' : String(cupos)),
        etiqueta ? h('span', null, etiqueta) : null,
      );
      b.addEventListener('click', () => marcar(cupos));
      botones.set(cupos, b);
      return b;
    };
    // Orden fijo: arriba "libre"; abajo de mayor a menor, y LLENO siempre abajo a la derecha.
    const rejilla = [botonCupo(capacidad, 'LIBRE', 'cupo--ancho')];
    for (let c = capacidad - 1; c >= 1; c--) rejilla.push(botonCupo(c, c === 1 ? 'asiento' : 'asientos'));
    rejilla.push(botonCupo(0, null, 'cupo--lleno'));

    const vozTexto = h('span');
    const gpsTexto = h('span');
    piezas = {
      botones,
      sinSenal: h('div', { class: 'aviso aviso--alerta sin-senal', role: 'status', hidden: true }, icono('sinSenal'), h('p', null, 'Sin señal: tu cambio quedó guardado y se enviará solo al reconectar.')),
      voz: h('button', { class: 'boton boton--borde crecer', type: 'button', onclick: alternarVoz }, icono('microfono'), vozTexto),
      vozTexto,
      gps: h('button', { class: 'boton boton--borde crecer', type: 'button', onclick: alternarGps }, icono('ubicacion'), gpsTexto),
      gpsTexto,
    };

    reemplazar(
      contenedor,
      cabecera,
      piezas.sinSenal,
      h('p', { class: 'suave' }, '¿Cuántos asientos libres llevas?'),
      h('div', { class: 'cupos', role: 'group', 'aria-label': 'Asientos libres' }, rejilla),
      zonaAvisos,
      h('div', { class: 'fila envolver' }, piezas.voz, piezas.gps),
      h('button', { class: 'boton boton--peligro boton--bloque', type: 'button', onclick: finalizar }, 'Fin de turno'),
      h('p', { class: 'chico suave' }, `Turno iniciado a las ${hora(estado.turno.inicio)} h`),
    );
    actualizarTurno();
  }

  canal.on('aviso_parada', (a) => {
    if (cuposMostrados === 0) return;
    flotante(`Pasajero esperando en ${a.paradero}`, 'info', 6000);
    decir(`Pasajero esperando en ${a.paradero}`);
    navigator.vibrate?.([80, 60, 80]);
    cargarAvisos();
  });
  canal.on('pago_recibido', (p) => {
    flotante(`Pago recibido: ${pesos(p.monto)} de ${p.pasajero}`, 'exito', 5000);
    decir('Pago recibido');
  });

  window.addEventListener('online', reintentarPendiente);
  temporizadores.push(setInterval(reintentarPendiente, 5000), setInterval(cargarAvisos, 20000));

  pintar();
  if (estado.turno) cargarAvisos();

  return () => {
    canal.cerrar();
    temporizadores.forEach(clearInterval);
    window.removeEventListener('online', reintentarPendiente);
    if (gps !== null) navigator.geolocation.clearWatch(gps);
    vozActiva = false;
    reconocimiento?.stop();
  };
}

// ============================================================ Recaudación

export async function vistaRecaudacion(vista) {
  const { hoy, saldo, ultimos } = await api.get('/turno/recaudacion');
  reemplazar(
    vista,
    h(
      'div',
      { class: 'conductor' },
      h('h1', null, 'Recaudación'),
      h('section', { class: 'saldo', 'aria-label': 'Recaudado hoy' }, h('span', null, 'Recaudado hoy'), h('span', { class: 'monto numero' }, pesos(hoy.total)), h('span', { class: 'chico' }, `${hoy.pagos} ${hoy.pagos === 1 ? 'pago digital' : 'pagos digitales'}`)),
      h('div', { class: 'tarjeta fila-entre' }, h('span', null, 'Saldo acumulado en tu billetera'), h('strong', { class: 'numero' }, pesos(saldo))),
      h(
        'section',
        { class: 'tarjeta pila-chica' },
        h('h2', null, 'Últimos cobros'),
        ultimos.length
          ? h(
              'ul',
              { class: 'movimientos' },
              ultimos.map((p) => h('li', null, h('div', { class: 'pila-chica' }, h('strong', null, 'Pasaje'), h('span', { class: 'chico suave' }, `${fechaHora(p.creado_en)} · ${p.trazado}`)), h('span', { class: 'numero positivo' }, `+ ${pesos(p.monto)}`))),
            )
          : vacio('Todavía no recibes pagos digitales.'),
      ),
      h('div', { class: 'fila' }, insignia('Sin efectivo', 'activo'), h('span', { class: 'chico suave' }, 'Menos vuelto, menos riesgo de asalto.')),
    ),
  );
  return null;
}
