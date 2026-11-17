/** Pasajero: mapa en vivo con cupos (HU-01), aviso de espera, pago del pasaje y billetera. */
import { api, ErrorApi } from '../api.js';
import { crearCanal } from '../tiempoReal.js';
import { crearMapa, dibujarTrazado, capaFlota, capaPersona } from '../mapa.js';
import { distanciaHastaParadero, etaMinutos } from '../geo.js';
import { h, reemplazar, icono, pesos, fechaHora, metros, patenteLegible, textoCupos, claseCupos, flotante, confirmar, conBoton, vacio } from '../ui.js';

// ============================================================ Mapa en vivo

export async function vistaMapa(vista) {
  const { trazados } = await api.get('/trazados');
  if (!trazados.length) {
    reemplazar(vista, h('div', { class: 'contenido' }, vacio('Aún no hay trazados disponibles.')));
    return null;
  }

  const estado = {
    trazado: null, // trazado completo (con polilínea y paraderos)
    paraderoId: null,
    vehiculos: new Map(),
    saldo: null,
  };

  // ---- Estructura de la pantalla ----
  const selector = h('div', { class: 'selector-trazado', role: 'group', 'aria-label': 'Elige tu trazado' });
  const cajaMapa = h('div', { class: 'mapa', role: 'application', 'aria-label': 'Mapa de colectivos en vivo' });
  const selectParadero = h('select', { class: 'entrada', id: 'paradero', 'aria-label': 'Paradero donde esperas' });
  const avisoRuta = h('div', { hidden: true });
  const lista = h('ul', { class: 'lista-colectivos' });
  const pieLista = h('p', { class: 'chico suave', hidden: true });
  const estadoConexion = h('span', { class: 'estado-turno' });
  const botonAviso = h('button', { class: 'boton boton--oscuro boton--bloque', type: 'button' }, icono('campana'), 'Avisar que espero aquí');
  const botonUbicacion = h('button', { class: 'boton boton--borde boton--bloque', type: 'button' }, icono('ubicacion'), 'Usar mi ubicación');
  const tituloLista = h('h2', null, 'Próximos colectivos');

  const panel = h(
    'section',
    { class: 'panel-pasajero' },
    h('label', { class: 'campo', for: 'paradero' }, h('span', null, '¿En qué paradero esperas?'), selectParadero),
    avisoRuta,
    h('div', { class: 'fila-entre' }, tituloLista, estadoConexion),
    lista,
    pieLista,
    botonAviso,
    botonUbicacion,
    h('p', { class: 'chico suave' }, 'También puedes tocar el mapa para indicar dónde estás.'),
  );
  reemplazar(vista, h('div', { class: 'pasajero' }, selector, cajaMapa, panel));

  const mapa = crearMapa(cajaMapa);
  const flota = capaFlota(mapa, { alTocar: (v) => abrirPago(v) });
  const persona = capaPersona(mapa);
  let capaTrazado = null;
  const canal = crearCanal();

  // ---- Lista de próximos colectivos ----
  // Cada fila se crea una vez y luego solo se actualizan sus textos: los datos llegan varias
  // veces por segundo y, si se redibujara todo, un toque en "Pagar" podría perderse.
  const filasDom = new Map(); // vehiculo_id -> { li, actualizar }

  function crearFila(vehiculoId) {
    const numero = h('strong', { class: 'numero' });
    const eta = h('div', { class: 'eta' }, numero, h('span', null, 'min'));
    const patente = h('span', { class: 'patente' });
    const cupos = h('span', { class: 'insignia' });
    const detalle = h('span', { class: 'chico suave' });
    const boton = h('button', { class: 'boton boton--primario boton--compacto', type: 'button' }, 'Pagar');
    boton.addEventListener('click', () => {
      const actual = estado.vehiculos.get(vehiculoId);
      if (actual) abrirPago(actual);
    });
    const li = h('li', { class: 'colectivo' }, eta, h('div', { class: 'pila-chica crecer' }, h('div', { class: 'fila envolver' }, patente, cupos), detalle), boton);
    return {
      li,
      actualizar(v) {
        numero.textContent = v.eta;
        eta.setAttribute('aria-label', `Llega en ${v.eta} minutos`);
        patente.textContent = patenteLegible(v.patente);
        cupos.textContent = textoCupos(v.cupos);
        cupos.className = `insignia insignia--${claseCupos(v.cupos)}`;
        detalle.textContent = `${v.conductor} · ${v.modelo} · a ${metros(v.distancia)}`;
      },
    };
  }

  function pintarLista() {
    const paradero = estado.trazado.paraderos.find((p) => p.id === estado.paraderoId);
    const filas = [...estado.vehiculos.values()]
      .map((v) => {
        const distancia = distanciaHastaParadero(v.progreso_m, v.sentido, paradero.progreso_m, estado.trazado.largo_m);
        return { ...v, distancia, eta: etaMinutos(distancia) };
      })
      .sort((a, b) => a.distancia - b.distancia);
    const conCupo = filas.filter((v) => v.cupos > 0).slice(0, 5);
    const llenos = filas.filter((v) => v.cupos <= 0).length;

    tituloLista.textContent = `Próximos colectivos · ${paradero.nombre}`;

    const vigentes = new Set();
    conCupo.forEach((v, i) => {
      let fila = filasDom.get(v.vehiculo_id);
      if (!fila) {
        fila = crearFila(v.vehiculo_id);
        filasDom.set(v.vehiculo_id, fila);
      }
      fila.actualizar(v);
      vigentes.add(v.vehiculo_id);
      if (lista.children[i] !== fila.li) lista.insertBefore(fila.li, lista.children[i] ?? null);
    });
    for (const [id, fila] of filasDom) {
      if (!vigentes.has(id)) {
        fila.li.remove();
        filasDom.delete(id);
      }
    }

    let nota = '';
    if (!filas.length) nota = 'No hay colectivos en recorrido en este trazado ahora.';
    else if (!conCupo.length) nota = 'Todos los colectivos del trazado van llenos. Apenas se libere un asiento aparecerán aquí.';
    else if (llenos) nota = `${llenos} ${llenos === 1 ? 'colectivo va lleno' : 'colectivos van llenos'} (en gris en el mapa).`;
    if (pieLista.textContent !== nota) pieLista.textContent = nota;
    pieLista.className = conCupo.length ? 'chico suave' : 'vacio';
    pieLista.hidden = !nota;
  }

  // ---- Cambio de trazado y paradero ----
  function elegirParadero(id) {
    estado.paraderoId = id;
    selectParadero.value = String(id);
    capaTrazado.elegir(id);
    localStorage.setItem(`paradero-${estado.trazado.id}`, String(id));
    pintarLista();
  }

  async function elegirTrazado(id) {
    for (const chip of selector.children) chip.setAttribute('aria-pressed', String(Number(chip.dataset.id) === id));
    const { trazado } = await api.get(`/trazados/${id}`);
    estado.trazado = trazado;
    estado.vehiculos.clear();
    flota.vaciar();
    persona.limpiar();
    avisoRuta.hidden = true;
    capaTrazado?.quitar();
    capaTrazado = dibujarTrazado(mapa, trazado, { alElegirParadero: (p) => elegirParadero(p.id) });
    reemplazar(selectParadero, trazado.paraderos.map((p) => h('option', { value: p.id }, p.nombre)));
    localStorage.setItem('trazado', String(id));
    const guardado = Number(localStorage.getItem(`paradero-${id}`));
    elegirParadero(trazado.paraderos.some((p) => p.id === guardado) ? guardado : trazado.paraderos[0].id);
    canal.suscribir(id);
    // Primera carga inmediata por HTTP; luego llegan los cambios por el canal en vivo.
    const { vehiculos } = await api.get(`/trazados/${id}/flota`);
    if (estado.trazado.id === id) recibirFlota(vehiculos);
  }

  function recibirFlota(vehiculos) {
    estado.vehiculos = new Map(vehiculos.map((v) => [v.vehiculo_id, v]));
    flota.reemplazar(vehiculos);
    pintarLista();
  }

  for (const t of trazados) {
    selector.append(
      h(
        'button',
        { class: 'chip', type: 'button', 'data-id': t.id, 'aria-pressed': 'false', onclick: () => elegirTrazado(t.id).catch((e) => flotante(e.message, 'error')) },
        h('span', { class: 'punto-color', vars: { '--color-trazado': t.color } }),
        `${t.codigo} · ${t.nombre.replace('Plaza de Puente Alto – ', '')}`,
      ),
    );
  }

  // ---- Eventos en vivo ----
  canal.on('flota', (m) => m.trazado_id === estado.trazado?.id && recibirFlota(m.vehiculos));
  canal.on('vehiculo', ({ vehiculo }) => {
    if (vehiculo.trazado_id !== estado.trazado?.id) return;
    estado.vehiculos.set(vehiculo.vehiculo_id, vehiculo);
    flota.actualizar(vehiculo);
    pintarLista();
  });
  canal.on('vehiculo_fuera', ({ vehiculo_id }) => {
    estado.vehiculos.delete(vehiculo_id);
    flota.quitar(vehiculo_id);
    pintarLista();
  });
  canal.on('estado', ({ conectado }) => {
    estadoConexion.textContent = conectado ? 'En vivo' : 'Reconectando';
    estadoConexion.classList.toggle('estado-turno--activo', conectado);
  });

  selectParadero.addEventListener('change', () => elegirParadero(Number(selectParadero.value)));

  // ---- Geocerca: ¿el pasajero está sobre el trazado? (HU-01, criterio 4) ----
  async function ubicar(posicion) {
    try {
      const r = await api.post(`/trazados/${estado.trazado.id}/ubicar`, posicion);
      persona.mostrar(posicion, r.en_trazado ? null : r.punto_mas_cercano);
      avisoRuta.hidden = false;
      if (r.en_trazado) {
        reemplazar(avisoRuta, h('div', { class: 'aviso aviso--exito' }, icono('check'), h('p', null, `Estás sobre el trazado. Tu paradero más cercano es ${r.paradero_sugerido.nombre}.`)));
      } else {
        reemplazar(
          avisoRuta,
          h(
            'div',
            { class: 'aviso aviso--alerta', role: 'alert' },
            icono('alerta'),
            h('p', null, `Estás a ${metros(r.distancia_m)} del recorrido. Los colectivos solo se detienen en su trazado: camina unos ${r.minutos_caminando} min hacia ${r.paradero_sugerido.nombre}.`),
          ),
        );
      }
      elegirParadero(r.paradero_sugerido.id);
    } catch (error) {
      flotante(error.message, 'error');
    }
  }

  mapa.on('click', (e) => ubicar({ lat: e.latlng.lat, lng: e.latlng.lng }));
  botonUbicacion.addEventListener('click', () => {
    if (!navigator.geolocation) return flotante('Este dispositivo no entrega ubicación. Toca el mapa para indicar dónde estás.', 'error');
    conBoton(
      botonUbicacion,
      () =>
        new Promise((listo) => {
          navigator.geolocation.getCurrentPosition(
            async (p) => {
              await ubicar({ lat: p.coords.latitude, lng: p.coords.longitude });
              listo();
            },
            () => {
              flotante('No pudimos obtener tu ubicación. Toca el mapa para indicar dónde estás.', 'error');
              listo();
            },
            { enableHighAccuracy: true, timeout: 8000 },
          );
        }),
    );
  });

  // ---- Aviso de espera (los colectivos llenos no lo reciben) ----
  botonAviso.addEventListener('click', () =>
    conBoton(botonAviso, async () => {
      try {
        const r = await api.post(`/trazados/${estado.trazado.id}/avisos`, { paradero_id: estado.paraderoId });
        flotante(
          r.colectivos_avisados
            ? `Listo: avisamos a ${r.colectivos_avisados} ${r.colectivos_avisados === 1 ? 'colectivo' : 'colectivos'} con asientos que esperas en ${r.paradero}.`
            : `Quedó registrado que esperas en ${r.paradero}. Ahora no hay colectivos con asientos libres.`,
          'exito',
          5000,
        );
      } catch (error) {
        flotante(error.message, 'error');
      }
    }),
  );

  // ---- Pago del pasaje ----
  async function abrirPago(v) {
    const tarifa = trazados.find((t) => t.id === v.trazado_id)?.tarifa ?? 0;
    const ok = await confirmar({
      titulo: `Pagar ${pesos(tarifa)}`,
      mensaje: `Colectivo ${patenteLegible(v.patente)} · ${v.conductor} · ${textoCupos(v.cupos)}. El pago se descuenta de tu billetera y le llega al conductor al instante.`,
      aceptar: `Pagar ${pesos(tarifa)}`,
    });
    if (!ok) return;
    // Llave de idempotencia: si la red falla y se reintenta, no se cobra dos veces.
    const codigo = crypto.randomUUID();
    try {
      const r = await api.post('/pagos', { vehiculo_id: v.vehiculo_id, codigo });
      flotante(`Pago realizado: ${pesos(r.pago.monto)}. Te quedan ${pesos(r.saldo)}.`, 'exito', 5000);
    } catch (error) {
      if (error instanceof ErrorApi && error.codigo === 'saldo_insuficiente') {
        const ir = await confirmar({ titulo: 'Saldo insuficiente', mensaje: 'Recarga tu billetera para pagar este pasaje.', aceptar: 'Ir a mi billetera' });
        if (ir) location.hash = '#/billetera';
      } else flotante(error.message, 'error');
    }
  }

  const inicial = Number(localStorage.getItem('trazado'));
  await elegirTrazado(trazados.some((t) => t.id === inicial) ? inicial : trazados[0].id);

  return () => {
    canal.cerrar();
    mapa.remove();
  };
}

// ============================================================ Billetera

export async function vistaBilletera(vista) {
  const contenedor = h('div', { class: 'contenido pila' });
  reemplazar(vista, contenedor);

  async function pintar() {
    const { saldo, movimientos } = await api.get('/billetera');
    const NOMBRES = { recarga: 'Recarga de saldo', pago: 'Pasaje', cobro: 'Cobro de pasaje' };
    reemplazar(
      contenedor,
      h('h1', null, 'Mi billetera'),
      h('section', { class: 'saldo', 'aria-label': 'Saldo disponible' }, h('span', null, 'Saldo disponible'), h('span', { class: 'monto numero' }, pesos(saldo))),
      h(
        'section',
        { class: 'tarjeta pila' },
        h('h2', null, 'Recargar saldo'),
        h(
          'div',
          { class: 'fila envolver' },
          [1000, 2000, 5000].map((monto) =>
            h(
              'button',
              {
                class: 'boton boton--borde crecer',
                type: 'button',
                onclick: (e) =>
                  conBoton(e.currentTarget, async () => {
                    try {
                      await api.post('/billetera/recargas', { monto });
                      flotante(`Recarga de ${pesos(monto)} aprobada.`, 'exito');
                      await pintar();
                    } catch (error) {
                      flotante(error.message, 'error');
                    }
                  }),
              },
              `+ ${pesos(monto)}`,
            ),
          ),
        ),
        h('div', { class: 'aviso' }, icono('escudo'), h('p', null, 'Prototipo: la recarga simula la aprobación de la pasarela de pago. Conatacoch nunca ve ni guarda los datos de tu tarjeta.')),
      ),
      h(
        'section',
        { class: 'tarjeta pila-chica' },
        h('h2', null, 'Últimos movimientos'),
        movimientos.length
          ? h(
              'ul',
              { class: 'movimientos' },
              movimientos.map((m) =>
                h(
                  'li',
                  null,
                  h('div', { class: 'pila-chica' }, h('strong', null, `${NOMBRES[m.tipo]}${m.patente ? ` · ${patenteLegible(m.patente)}` : ''}`), h('span', { class: 'chico suave' }, `${fechaHora(m.creado_en)}${m.trazado ? ` · ${m.trazado}` : ''}`)),
                  h('span', { class: `numero ${m.monto > 0 ? 'positivo' : 'negativo'}` }, `${m.monto > 0 ? '+' : '−'} ${pesos(Math.abs(m.monto))}`),
                ),
              ),
            )
          : vacio('Aún no tienes movimientos.'),
      ),
    );
  }

  await pintar();
  return null;
}
