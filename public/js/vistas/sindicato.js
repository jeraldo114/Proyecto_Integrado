/** Sindicato (administrador): resumen en vivo, conductores, vehículos, trazados, opiniones y auditoría. */
import { api } from '../api.js';
import { crearMapa, iconoVertice, iconoParadero, L } from '../mapa.js';
import { h, reemplazar, icono, pesos, fechaHora, patenteLegible, insignia, flotante, confirmar, conBoton, vacio, modal, campo, leerFormulario, mostrarErrores, errorGeneral } from '../ui.js';

const ESTADOS = { activo: 'Activo', pendiente: 'Por validar', suspendido: 'Suspendido', validado: 'Validado', nueva: 'Nueva', en_revision: 'En revisión', resuelta: 'Resuelta' };
const etiquetaEstado = (estado) => insignia(ESTADOS[estado] ?? estado, estado);

const celda = (etiqueta, ...contenido) => h('td', { 'data-etiqueta': etiqueta }, contenido);
const tabla = (columnas, filas) =>
  h('div', { class: 'tabla-caja' }, h('table', { class: 'tabla' }, h('thead', null, h('tr', null, columnas.map((c) => h('th', { scope: 'col' }, c)))), h('tbody', null, filas)));

function encabezado(titulo, descripcion, accion) {
  return h('div', { class: 'fila-entre envolver' }, h('div', { class: 'pila-chica' }, h('h1', null, titulo), h('p', { class: 'suave' }, descripcion)), accion);
}

/** Formulario dentro de una ventana modal, con errores del servidor junto a cada campo. */
function formularioModal({ titulo, campos, textoBoton = 'Guardar', alGuardar, ancha = false, preparar }) {
  const boton = h('button', { class: 'boton boton--primario', type: 'submit' }, textoBoton);
  const formulario = h('form', { class: 'pila', novalidate: true }, errorGeneral(), campos, h('div', { class: 'modal-acciones' }, h('button', { class: 'boton boton--borde', type: 'button', onclick: () => m.cerrar() }, 'Cancelar'), boton));
  const m = modal({ titulo, contenido: formulario, ancha });
  preparar?.(formulario);
  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    conBoton(boton, async () => {
      try {
        await alGuardar(leerFormulario(formulario), formulario);
        m.cerrar();
      } catch (error) {
        mostrarErrores(formulario, error);
      }
    });
  });
  return m;
}

// ============================================================ Resumen

export async function vistaResumen(vista) {
  const contenedor = h('div', { class: 'contenido pila' });
  reemplazar(vista, contenedor);

  async function pintar() {
    const r = await api.get('/sindicato/resumen');
    reemplazar(
      contenedor,
      encabezado('Resumen del sindicato', 'Lo que está pasando ahora en tus trazados.', h('span', { class: 'chico suave' }, `Actualizado ${fechaHora(new Date().toISOString())}`)),
      h(
        'div',
        { class: 'datos' },
        h('div', { class: 'dato' }, h('strong', { class: 'numero' }, r.en_recorrido), h('span', null, 'Colectivos en recorrido')),
        h('div', { class: 'dato' }, h('strong', { class: 'numero' }, r.asientos_libres), h('span', null, 'Asientos libres ahora')),
        h('div', { class: 'dato' }, h('strong', { class: 'numero' }, `${r.ocupacion_pct}%`), h('span', null, 'Ocupación de la flota')),
        h('div', { class: 'dato' }, h('strong', { class: 'numero' }, pesos(r.pagos_hoy.total)), h('span', null, `Recaudado hoy (${r.pagos_hoy.cantidad} pagos)`)),
      ),
      r.conductores.pendientes || r.vehiculos.pendientes
        ? h(
            'div',
            { class: 'aviso aviso--alerta' },
            icono('alerta'),
            h('p', null, `Tienes ${r.conductores.pendientes} conductor(es) y ${r.vehiculos.pendientes} vehículo(s) por validar. Mientras no los valides, no pueden operar.`),
          )
        : null,
      h(
        'section',
        { class: 'tarjeta pila' },
        h('h2', null, 'Trazados'),
        r.trazados.map((t) =>
          h(
            'div',
            { class: 'pila-chica', vars: { '--color-trazado': t.color } },
            h('div', { class: 'fila-entre envolver' }, h('div', { class: 'fila' }, h('span', { class: 'punto-color' }), h('strong', null, `${t.codigo} · ${t.nombre}`)), h('span', { class: 'chico suave numero' }, `${t.en_recorrido} de ${t.vehiculos_validados} en recorrido · ${pesos(t.recaudado_hoy)} hoy`)),
            h('div', { class: 'barra-ocupacion', role: 'img', 'aria-label': `Ocupación ${t.ocupacion_pct}%` }, h('i', { vars: { width: `${t.ocupacion_pct}%` } })),
            h('span', { class: 'chico suave' }, `Ocupación ${t.ocupacion_pct}%`),
          ),
        ),
      ),
      h(
        'div',
        { class: 'datos' },
        h('div', { class: 'dato' }, h('strong', { class: 'numero' }, r.conductores.activos), h('span', null, 'Conductores activos')),
        h('div', { class: 'dato' }, h('strong', { class: 'numero' }, r.vehiculos.validados), h('span', null, 'Vehículos validados')),
        h('div', { class: 'dato' }, h('strong', { class: 'numero' }, r.pasajeros), h('span', null, 'Pasajeros registrados')),
        h('div', { class: 'dato' }, h('strong', { class: 'numero' }, r.conductores.suspendidos + r.vehiculos.suspendidos), h('span', null, 'Suspensiones vigentes')),
      ),
    );
  }

  await pintar();
  const temporizador = setInterval(() => pintar().catch(() => {}), 5000);
  return () => clearInterval(temporizador);
}

// ============================================================ Conductores

export async function vistaConductores(vista) {
  const contenedor = h('div', { class: 'contenido pila' });
  reemplazar(vista, contenedor);

  function abrirFormulario(conductor) {
    formularioModal({
      titulo: conductor ? 'Editar conductor' : 'Registrar conductor',
      campos: [
        campo({ etiqueta: 'Nombre completo', nombre: 'nombre', valor: conductor?.nombre, required: true }),
        h(
          'div',
          { class: 'rejilla-2' },
          campo({ etiqueta: 'RUT', nombre: 'rut', valor: conductor?.rut, required: true, ayuda: 'Se valida el dígito verificador. Ej.: 12.345.678-5' }),
          campo({ etiqueta: 'Teléfono', nombre: 'telefono', tipo: 'tel', valor: conductor?.telefono ?? '', inputmode: 'tel', ayuda: 'Opcional' }),
        ),
        campo({ etiqueta: 'Correo', nombre: 'email', tipo: 'email', valor: conductor?.email, required: true }),
      ],
      async alGuardar(datos) {
        if (conductor) {
          await api.put(`/sindicato/conductores/${conductor.id}`, datos);
          flotante('Conductor actualizado.', 'exito');
        } else {
          const r = await api.post('/sindicato/conductores', datos);
          modal({
            titulo: 'Conductor registrado',
            contenido: [
              h('p', null, `${r.conductor.nombre} quedó "Por validar". Valídalo cuando revises sus documentos.`),
              h('div', { class: 'aviso aviso--alerta' }, icono('escudo'), h('p', null, 'Entrégale esta clave temporal. Se muestra una sola vez: ', h('strong', { class: 'numero' }, r.contrasena_temporal))),
            ],
          });
        }
        await pintar();
      },
    });
  }

  async function cambiarEstado(conductor, estado) {
    const textos = {
      activo: { titulo: `¿Validar a ${conductor.nombre}?`, mensaje: 'Confirmas que revisaste su RUT y documentos. Podrá iniciar turnos.', aceptar: 'Validar' },
      suspendido: { titulo: `¿Suspender a ${conductor.nombre}?`, mensaje: 'Se cierran sus sesiones y su turno en curso. No podrá operar hasta que lo reactives.', aceptar: 'Suspender', peligro: true },
    };
    if (!(await confirmar(textos[estado]))) return;
    try {
      await api.patch(`/sindicato/conductores/${conductor.id}/estado`, { estado });
      flotante(estado === 'activo' ? 'Conductor validado.' : 'Conductor suspendido.', 'exito');
      await pintar();
    } catch (error) {
      flotante(error.message, 'error');
    }
  }

  async function eliminar(conductor) {
    if (!(await confirmar({ titulo: `¿Eliminar a ${conductor.nombre}?`, mensaje: 'Solo se puede eliminar si nunca ha hecho un turno.', aceptar: 'Eliminar', peligro: true }))) return;
    try {
      await api.delete(`/sindicato/conductores/${conductor.id}`);
      flotante('Conductor eliminado.', 'exito');
      await pintar();
    } catch (error) {
      flotante(error.message, 'error');
    }
  }

  async function pintar() {
    const { conductores } = await api.get('/sindicato/conductores');
    reemplazar(
      contenedor,
      encabezado('Conductores', 'Solo los conductores validados por el sindicato pueden operar.', h('button', { class: 'boton boton--primario', type: 'button', onclick: () => abrirFormulario(null) }, icono('mas'), 'Registrar conductor')),
      conductores.length
        ? tabla(
            ['Conductor', 'RUT', 'Vehículo', 'Estado', ''],
            conductores.map((c) =>
              h(
                'tr',
                null,
                celda('Conductor', h('div', { class: 'pila-chica' }, h('strong', null, c.nombre), h('span', { class: 'chico suave' }, c.email))),
                celda('RUT', h('span', { class: 'numero' }, c.rut ?? '—')),
                celda('Vehículo', c.vehiculo ? h('span', { class: 'patente' }, patenteLegible(c.vehiculo.patente)) : h('span', { class: 'suave' }, 'Sin asignar')),
                celda('Estado', etiquetaEstado(c.estado)),
                h(
                  'td',
                  { class: 'sin-etiqueta' },
                  h(
                    'div',
                    { class: 'acciones' },
                    c.estado !== 'activo' ? h('button', { class: 'boton boton--primario boton--compacto', type: 'button', onclick: () => cambiarEstado(c, 'activo') }, c.estado === 'pendiente' ? 'Validar' : 'Reactivar') : null,
                    c.estado === 'activo' ? h('button', { class: 'boton boton--peligro boton--compacto', type: 'button', onclick: () => cambiarEstado(c, 'suspendido') }, 'Suspender') : null,
                    h('button', { class: 'boton boton--borde boton--compacto', type: 'button', onclick: () => abrirFormulario(c) }, 'Editar'),
                    h('button', { class: 'boton boton--fantasma boton--compacto', type: 'button', onclick: () => eliminar(c) }, 'Eliminar'),
                  ),
                ),
              ),
            ),
          )
        : vacio('Aún no hay conductores registrados.'),
    );
  }

  await pintar();
  return null;
}

// ============================================================ Vehículos

export async function vistaVehiculos(vista) {
  const contenedor = h('div', { class: 'contenido pila' });
  reemplazar(vista, contenedor);
  let trazados = [];
  let conductores = [];

  function abrirFormulario(vehiculo) {
    const libres = conductores.filter((c) => !c.vehiculo || c.vehiculo.id === vehiculo?.id);
    formularioModal({
      titulo: vehiculo ? `Editar ${patenteLegible(vehiculo.patente)}` : 'Registrar vehículo',
      campos: [
        h(
          'div',
          { class: 'rejilla-2' },
          campo({ etiqueta: 'Patente', nombre: 'patente', valor: vehiculo?.patente, required: true, ayuda: 'Ej.: BBCL12 o AB1234', autocapitalize: 'characters' }),
          campo({ etiqueta: 'Año', nombre: 'anio', tipo: 'number', valor: vehiculo?.anio ?? new Date().getFullYear(), min: '1990', required: true }),
          campo({ etiqueta: 'Marca', nombre: 'marca', valor: vehiculo?.marca, required: true }),
          campo({ etiqueta: 'Modelo', nombre: 'modelo', valor: vehiculo?.modelo, required: true }),
          campo({ etiqueta: 'Asientos para pasajeros', nombre: 'capacidad_maxima', tipo: 'number', valor: vehiculo?.capacidad_maxima ?? 4, min: '1', max: '6', required: true }),
          campo({ etiqueta: 'Trazado autorizado', nombre: 'trazado_id', tipo: 'select', valor: vehiculo?.trazado_id, opciones: trazados.map((t) => ({ valor: t.id, texto: `${t.codigo} · ${t.nombre}` })) }),
        ),
        campo({
          etiqueta: 'Conductor asignado',
          nombre: 'conductor_id',
          tipo: 'select',
          valor: vehiculo?.conductor_id ?? '',
          opciones: [{ valor: '', texto: 'Sin asignar' }, ...libres.map((c) => ({ valor: c.id, texto: c.nombre }))],
          ayuda: 'Solo aparecen conductores sin otro vehículo.',
        }),
      ],
      async alGuardar(datos) {
        const cuerpo = {
          patente: datos.patente,
          marca: datos.marca,
          modelo: datos.modelo,
          anio: Number(datos.anio),
          capacidad_maxima: Number(datos.capacidad_maxima),
          trazado_id: Number(datos.trazado_id),
          conductor_id: datos.conductor_id ? Number(datos.conductor_id) : null,
        };
        if (vehiculo) await api.put(`/sindicato/vehiculos/${vehiculo.id}`, cuerpo);
        else await api.post('/sindicato/vehiculos', cuerpo);
        flotante(vehiculo ? 'Vehículo actualizado.' : 'Vehículo registrado. Queda "Por validar".', 'exito');
        await pintar();
      },
    });
  }

  async function cambiarEstado(vehiculo, estado) {
    const textos = {
      validado: { titulo: `¿Validar ${patenteLegible(vehiculo.patente)}?`, mensaje: 'Confirmas que la patente y los papeles corresponden a un colectivo autorizado del trazado.', aceptar: 'Validar' },
      suspendido: { titulo: `¿Suspender ${patenteLegible(vehiculo.patente)}?`, mensaje: 'Sale del mapa de inmediato y no podrá iniciar turnos.', aceptar: 'Suspender', peligro: true },
    };
    if (!(await confirmar(textos[estado]))) return;
    try {
      await api.patch(`/sindicato/vehiculos/${vehiculo.id}/estado`, { estado });
      flotante(estado === 'validado' ? 'Vehículo validado.' : 'Vehículo suspendido.', 'exito');
      await pintar();
    } catch (error) {
      flotante(error.message, 'error');
    }
  }

  async function eliminar(vehiculo) {
    if (!(await confirmar({ titulo: `¿Eliminar ${patenteLegible(vehiculo.patente)}?`, mensaje: 'Solo se puede eliminar si nunca ha hecho un turno.', aceptar: 'Eliminar', peligro: true }))) return;
    try {
      await api.delete(`/sindicato/vehiculos/${vehiculo.id}`);
      flotante('Vehículo eliminado.', 'exito');
      await pintar();
    } catch (error) {
      flotante(error.message, 'error');
    }
  }

  async function pintar() {
    const [v, t, c] = await Promise.all([api.get('/sindicato/vehiculos'), api.get('/trazados'), api.get('/sindicato/conductores')]);
    trazados = t.trazados;
    conductores = c.conductores;
    reemplazar(
      contenedor,
      encabezado('Vehículos', 'Cada patente se valida antes de aparecer en el mapa: así no operan colectivos no autorizados.', h('button', { class: 'boton boton--primario', type: 'button', onclick: () => abrirFormulario(null) }, icono('mas'), 'Registrar vehículo')),
      v.vehiculos.length
        ? tabla(
            ['Patente', 'Vehículo', 'Trazado', 'Conductor', 'Estado', ''],
            v.vehiculos.map((x) =>
              h(
                'tr',
                null,
                celda('Patente', h('span', { class: 'patente' }, patenteLegible(x.patente))),
                celda('Vehículo', `${x.marca} ${x.modelo} ${x.anio} · ${x.capacidad_maxima} asientos`),
                celda('Trazado', x.trazado_codigo),
                celda('Conductor', x.conductor_nombre ?? h('span', { class: 'suave' }, 'Sin asignar')),
                celda('Estado', h('div', { class: 'fila envolver' }, etiquetaEstado(x.estado), x.en_recorrido ? insignia('En recorrido', 'activo') : null)),
                h(
                  'td',
                  { class: 'sin-etiqueta' },
                  h(
                    'div',
                    { class: 'acciones' },
                    x.estado !== 'validado' ? h('button', { class: 'boton boton--primario boton--compacto', type: 'button', onclick: () => cambiarEstado(x, 'validado') }, x.estado === 'pendiente' ? 'Validar' : 'Reactivar') : null,
                    x.estado === 'validado' ? h('button', { class: 'boton boton--peligro boton--compacto', type: 'button', onclick: () => cambiarEstado(x, 'suspendido') }, 'Suspender') : null,
                    h('button', { class: 'boton boton--borde boton--compacto', type: 'button', onclick: () => abrirFormulario(x) }, 'Editar'),
                    h('button', { class: 'boton boton--fantasma boton--compacto', type: 'button', onclick: () => eliminar(x) }, 'Eliminar'),
                  ),
                ),
              ),
            ),
          )
        : vacio('Aún no hay vehículos registrados.'),
    );
  }

  await pintar();
  return null;
}

// ============================================================ Trazados

export async function vistaTrazados(vista) {
  const contenedor = h('div', { class: 'contenido pila' });
  reemplazar(vista, contenedor);

  async function abrirEditor(resumen) {
    const trazado = resumen ? (await api.get(`/trazados/${resumen.id}`)).trazado : null;
    let puntos = trazado ? trazado.puntos.map((p) => ({ lat: p.lat, lng: p.lng })) : [];
    let paraderos = trazado ? trazado.paraderos.map((p) => ({ nombre: p.nombre, lat: p.lat, lng: p.lng })) : [];
    let geometriaCambio = !trazado;
    let modo = 'recorrido';
    let mapa = null;
    let capa = null;

    const cajaMapa = h('div', { class: 'editor-mapa', role: 'application', 'aria-label': 'Editor del recorrido' });
    const listaParaderos = h('div', { class: 'pila-chica' });
    const botonModo = (valor, texto) => h('button', { class: 'chip', type: 'button', 'data-modo': valor, 'aria-pressed': String(modo === valor), onclick: () => cambiarModo(valor) }, texto);
    const modos = h('div', { class: 'fila envolver' }, botonModo('recorrido', 'Dibujar recorrido'), botonModo('paradero', 'Marcar paraderos'));

    function cambiarModo(valor) {
      modo = valor;
      for (const b of modos.children) b.setAttribute('aria-pressed', String(b.dataset.modo === valor));
    }

    function pintarParaderos() {
      reemplazar(
        listaParaderos,
        h('span', { class: 'etiqueta' }, `Paraderos (${paraderos.length})`),
        paraderos.length
          ? paraderos.map((p, i) => {
              const entrada = h('input', { class: 'entrada', value: p.nombre, 'aria-label': `Nombre del paradero ${i + 1}`, maxlength: '60' });
              entrada.addEventListener('input', () => {
                p.nombre = entrada.value;
                geometriaCambio = true;
              });
              return h('div', { class: 'fila' }, entrada, h('button', { class: 'boton boton--fantasma boton--compacto', type: 'button', onclick: () => { paraderos.splice(i, 1); geometriaCambio = true; redibujar(); } }, 'Quitar'));
            })
          : h('span', { class: 'ayuda' }, 'Elige "Marcar paraderos" y toca el mapa sobre el recorrido.'),
      );
    }

    function redibujar() {
      capa?.remove();
      capa = L.layerGroup().addTo(mapa);
      if (puntos.length > 1) L.polyline(puntos.map((p) => [p.lat, p.lng]), { color: '#101214', weight: 6 }).addTo(capa);
      if (puntos.length && puntos.length <= 60) for (const p of puntos) L.marker([p.lat, p.lng], { icon: iconoVertice(), interactive: false }).addTo(capa);
      for (const p of paraderos) L.marker([p.lat, p.lng], { icon: iconoParadero(), interactive: false, title: p.nombre }).addTo(capa);
      pintarParaderos();
    }

    formularioModal({
      titulo: trazado ? `Editar ${trazado.codigo}` : 'Nuevo trazado',
      ancha: true,
      campos: [
        h(
          'div',
          { class: 'rejilla-2' },
          campo({ etiqueta: 'Código', nombre: 'codigo', valor: trazado?.codigo, required: true, ayuda: 'Ej.: T-04' }),
          campo({ etiqueta: 'Comuna', nombre: 'comuna', valor: trazado?.comuna ?? 'Puente Alto', required: true }),
        ),
        campo({ etiqueta: 'Nombre del recorrido', nombre: 'nombre', valor: trazado?.nombre, required: true, ayuda: 'Ej.: Plaza de Puente Alto – Hospital' }),
        h(
          'div',
          { class: 'rejilla-2' },
          campo({ etiqueta: 'Tarifa (pesos)', nombre: 'tarifa', tipo: 'number', valor: trazado?.tarifa ?? 800, min: '100', step: '50', required: true }),
          campo({ etiqueta: 'Color en el mapa', nombre: 'color', tipo: 'color', valor: trazado?.color ?? '#E6A700' }),
        ),
        campo({ etiqueta: 'Estado', nombre: 'activo', tipo: 'select', valor: String(trazado?.activo ?? true), opciones: [{ valor: 'true', texto: 'Activo (visible para pasajeros)' }, { valor: 'false', texto: 'Inactivo' }] }),
        h('div', { class: 'pila-chica' }, h('span', { class: 'etiqueta' }, 'Recorrido autorizado'), modos, cajaMapa,
          h('div', { class: 'fila envolver' },
            h('button', { class: 'boton boton--borde boton--compacto', type: 'button', onclick: () => { if (modo === 'paradero') paraderos.pop(); else puntos.pop(); geometriaCambio = true; redibujar(); } }, 'Deshacer último'),
            h('button', { class: 'boton boton--fantasma boton--compacto', type: 'button', onclick: () => { puntos = []; paraderos = []; geometriaCambio = true; redibujar(); } }, 'Borrar recorrido'),
          ),
          h('small', { class: 'error', 'data-error': 'puntos', hidden: true }),
          h('small', { class: 'error', 'data-error': 'paraderos', hidden: true }),
        ),
        listaParaderos,
      ],
      preparar() {
        mapa = crearMapa(cajaMapa);
        if (puntos.length) mapa.fitBounds(L.latLngBounds(puntos.map((p) => [p.lat, p.lng])), { padding: [20, 20] });
        mapa.on('click', (e) => {
          const p = { lat: Number(e.latlng.lat.toFixed(6)), lng: Number(e.latlng.lng.toFixed(6)) };
          if (modo === 'recorrido') puntos.push(p);
          else paraderos.push({ ...p, nombre: `Paradero ${paraderos.length + 1}` });
          geometriaCambio = true;
          redibujar();
        });
        redibujar();
        setTimeout(() => mapa.invalidateSize(), 50);
      },
      async alGuardar(datos) {
        const cuerpo = { codigo: datos.codigo, nombre: datos.nombre, comuna: datos.comuna, color: datos.color, tarifa: Number(datos.tarifa), activo: datos.activo === 'true' };
        // La geometría solo se envía si cambió: así un ajuste de tarifa no toca el recorrido.
        if (geometriaCambio) Object.assign(cuerpo, { puntos, paraderos });
        if (trazado) await api.put(`/trazados/${trazado.id}`, cuerpo);
        else await api.post('/trazados', cuerpo);
        flotante(trazado ? 'Trazado actualizado.' : 'Trazado creado.', 'exito');
        await pintar();
      },
    });
  }

  async function eliminar(t) {
    if (!(await confirmar({ titulo: `¿Eliminar ${t.codigo}?`, mensaje: 'Solo se puede eliminar un trazado sin vehículos ni historial. Si ya operó, desactívalo.', aceptar: 'Eliminar', peligro: true }))) return;
    try {
      await api.delete(`/trazados/${t.id}`);
      flotante('Trazado eliminado.', 'exito');
      await pintar();
    } catch (error) {
      flotante(error.message, 'error');
    }
  }

  async function pintar() {
    const { trazados } = await api.get('/trazados');
    reemplazar(
      contenedor,
      encabezado('Trazados', 'Recorridos fijos autorizados. Los colectivos solo aparecen sobre su trazado.', h('button', { class: 'boton boton--primario', type: 'button', onclick: () => abrirEditor(null) }, icono('mas'), 'Nuevo trazado')),
      tabla(
        ['Trazado', 'Tarifa', 'Recorrido', 'En recorrido', 'Estado', ''],
        trazados.map((t) =>
          h(
            'tr',
            null,
            celda('Trazado', h('div', { class: 'fila', vars: { '--color-trazado': t.color } }, h('span', { class: 'punto-color' }), h('div', { class: 'pila-chica' }, h('strong', null, t.codigo), h('span', { class: 'chico suave' }, t.nombre)))),
            celda('Tarifa', h('span', { class: 'numero' }, pesos(t.tarifa))),
            celda('Recorrido', h('div', { class: 'pila-chica' }, h('span', { class: 'numero' }, `${(t.largo_m / 1000).toFixed(1).replace('.', ',')} km`), h('span', { class: 'chico suave numero' }, `${t.paraderos} paraderos`))),
            celda('En recorrido', h('span', { class: 'numero' }, `${t.en_recorrido} de ${t.vehiculos}`)),
            celda('Estado', insignia(t.activo ? 'Activo' : 'Inactivo', t.activo ? 'activo' : 'lleno')),
            h('td', { class: 'sin-etiqueta' }, h('div', { class: 'acciones' }, h('button', { class: 'boton boton--borde boton--compacto', type: 'button', onclick: (e) => conBoton(e.currentTarget, () => abrirEditor(t)) }, 'Editar'), h('button', { class: 'boton boton--fantasma boton--compacto', type: 'button', onclick: () => eliminar(t) }, 'Eliminar'))),
          ),
        ),
      ),
    );
  }

  await pintar();
  return null;
}

// ============================================================ Opiniones

export async function vistaOpiniones(vista) {
  const contenedor = h('div', { class: 'contenido pila' });
  reemplazar(vista, contenedor);
  const TIPOS = { sugerencia: 'Sugerencia', problema: 'Problema', felicitacion: 'Felicitación' };
  const ROLES = { pasajero: 'Pasajero', conductor: 'Conductor', admin: 'Sindicato' };

  function responder(opinion) {
    formularioModal({
      titulo: 'Gestionar opinión',
      campos: [
        h('p', { class: 'suave' }, `"${opinion.comentario}"`),
        campo({ etiqueta: 'Estado', nombre: 'estado', tipo: 'select', valor: opinion.estado, opciones: Object.entries({ nueva: 'Nueva', en_revision: 'En revisión', resuelta: 'Resuelta' }).map(([valor, texto]) => ({ valor, texto })) }),
        campo({ etiqueta: 'Qué se hizo con esta opinión', nombre: 'respuesta', tipo: 'textarea', valor: opinion.respuesta ?? '', maxlength: '400', ayuda: 'Ej.: "Se agrandaron los botones de cupos".' }),
      ],
      async alGuardar(datos) {
        await api.patch(`/sindicato/opiniones/${opinion.id}`, { estado: datos.estado, ...(datos.respuesta ? { respuesta: datos.respuesta } : {}) });
        flotante('Opinión actualizada.', 'exito');
        await pintar();
      },
    });
  }

  async function pintar() {
    const { opiniones } = await api.get('/sindicato/opiniones');
    reemplazar(
      contenedor,
      encabezado('Opiniones de usuarios', 'Lo que dicen pasajeros y conductores, y qué mejora generó cada opinión.'),
      opiniones.length
        ? opiniones.map((o) =>
            h(
              'article',
              { class: 'tarjeta pila-chica' },
              h('div', { class: 'fila-entre envolver' }, h('div', { class: 'fila envolver' }, h('strong', null, `${TIPOS[o.tipo] ?? o.tipo} · ${ROLES[o.usuario?.rol] ?? ''} ${o.usuario?.nombre ?? ''}`), o.puntaje ? h('span', { class: 'chico', 'aria-label': `${o.puntaje} de 5` }, '★'.repeat(o.puntaje)) : null), etiquetaEstado(o.estado)),
              h('p', null, o.comentario),
              o.respuesta ? h('div', { class: 'aviso aviso--exito' }, icono('check'), h('p', null, `Mejora aplicada: ${o.respuesta}`)) : null,
              h('div', { class: 'fila-entre envolver' }, h('span', { class: 'chico suave' }, `${fechaHora(o.ts)}${o.contexto?.ancho ? ` · pantalla ${o.contexto.ancho}×${o.contexto.alto} px` : ''}${o.demo ? ' · dato de ejemplo' : ''}`), h('button', { class: 'boton boton--borde boton--compacto', type: 'button', onclick: () => responder(o) }, 'Gestionar')),
            ),
          )
        : vacio('Aún no hay opiniones.'),
    );
  }

  await pintar();
  return null;
}

// ============================================================ Auditoría

export async function vistaAuditoria(vista) {
  const { eventos } = await api.get('/sindicato/auditoria?limite=80');
  const NOMBRES = {
    login: 'Inicio de sesión', login_fallido: 'Intento de acceso fallido', mfa_fallido: 'Código de verificación incorrecto', registro: 'Nuevo registro',
    acceso_denegado: 'Acceso denegado', crear: 'Creación', actualizar: 'Modificación', eliminar: 'Eliminación', cambiar_estado: 'Cambio de estado',
    iniciar_turno: 'Inicio de turno', finalizar_turno: 'Fin de turno', pago: 'Pago de pasaje', recarga: 'Recarga de saldo',
    gps_sospechoso: 'Posición GPS sospechosa', fuera_de_trazado: 'Vehículo fuera de su trazado', refresh_reutilizado: 'Sesión posiblemente robada',
  };
  const ALERTAS = new Set(['login_fallido', 'mfa_fallido', 'acceso_denegado', 'gps_sospechoso', 'fuera_de_trazado', 'refresh_reutilizado']);
  reemplazar(
    vista,
    h(
      'div',
      { class: 'contenido pila' },
      encabezado('Auditoría', 'Registro de quién hizo qué. No guarda contraseñas ni RUT completos.'),
      eventos.length
        ? h(
            'section',
            { class: 'tarjeta' },
            eventos.map((e) =>
              h(
                'div',
                { class: 'evento' },
                h('span', { class: 'chico suave numero' }, fechaHora(e.ts)),
                h('div', { class: 'pila-chica' }, h('div', { class: 'fila envolver' }, h('strong', null, NOMBRES[e.accion] ?? e.accion), ALERTAS.has(e.accion) ? insignia('Revisar', 'suspendido') : null, h('span', { class: 'suave' }, `${e.recurso} · ${e.actor ? `${e.actor.nombre} (${e.actor.rol})` : 'sin sesión'}`)), Object.keys(e.detalle ?? {}).length ? h('code', null, JSON.stringify(e.detalle)) : null),
              ),
            ),
          )
        : vacio('Aún no hay eventos registrados.'),
    ),
  );
  return null;
}
