/**
 * Piezas de interfaz reutilizables.
 * Seguridad: el DOM se construye con nodos y textContent, nunca con innerHTML de datos
 * del usuario, por lo que un nombre o comentario malicioso no puede ejecutar código (XSS).
 */

/** Crea un elemento. Los hijos de tipo texto se insertan como texto (escapados por el navegador). */
export function h(etiqueta, atributos, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos ?? {})) {
    if (valor === false || valor === null || valor === undefined) continue;
    if (clave === 'class') el.className = valor;
    else if (clave === 'vars') for (const [n, v] of Object.entries(valor)) el.style.setProperty(n, v);
    else if (clave.startsWith('on') && typeof valor === 'function') el.addEventListener(clave.slice(2), valor);
    else if (valor === true) el.setAttribute(clave, '');
    else el.setAttribute(clave, valor);
  }
  agregar(el, hijos);
  return el;
}

export function agregar(el, hijos) {
  for (const hijo of [hijos].flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

export function reemplazar(el, ...hijos) {
  el.replaceChildren();
  return agregar(el, hijos);
}

// ---- Iconos (trazos propios, 24x24) ----
const TRAZOS = {
  mapa: ['M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z', 'M9 4v13.5', 'M15 6.5V20'],
  billetera: ['M3 7a2 2 0 0 1 2-2h13v4', 'M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2', 'M16.5 14h.01'],
  opinion: ['M4 5h16v11H9l-5 4z'],
  volante: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4', 'M3.5 10.5 10 12', 'M20.5 10.5 14 12', 'M12 14v7'],
  monedas: ['M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3', 'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
  tablero: ['M4 4h7v9H4z', 'M13 4h7v5h-7z', 'M13 11h7v9h-7z', 'M4 15h7v5H4z'],
  personas: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1', 'M17 3.5a4 4 0 0 1 0 7', 'M22 21v-1a6 6 0 0 0-3-5.2'],
  auto: ['M5 11l1.6-4.5A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.5L19 11', 'M3 16v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1', 'M6 17v2', 'M18 17v2', 'M7 14h.01', 'M17 14h.01'],
  ruta: ['M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4', 'M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4', 'M8 17h6a4 4 0 0 0 0-8h-4a2 2 0 0 1 0-4h6'],
  escudo: ['M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z', 'M9 12l2 2 4-4'],
  salir: ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3', 'M10 8l-4 4 4 4', 'M6 12h10'],
  microfono: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
  ubicacion: ['M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5'],
  mas: ['M12 5v14', 'M5 12h14'],
  campana: ['M6 16V11a6 6 0 0 1 12 0v5l2 2H4z', 'M10 20a2 2 0 0 0 4 0'],
  usuario: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'],
  alerta: ['M12 4 2.5 20h19z', 'M12 10v4', 'M12 17h.01'],
  sinSenal: ['M2 8.5a15 15 0 0 1 20 0', 'M5.5 12a10 10 0 0 1 13 0', 'M9 15.5a5 5 0 0 1 6 0', 'M12 19h.01', 'M3 3l18 18'],
  paleta: ['M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.5-1.5-.5-2.5S14.500 15 16 15h2a3 3 0 0 0 3-3c0-5-4-9-9-9', 'M7.5 12h.01', 'M9.500 7.500h.01', 'M14.500 7h.01'],
  check: ['M5 12.5l4.5 4.5L19 7.500'],
};

export function icono(nombre, titulo) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icono');
  svg.setAttribute('aria-hidden', titulo ? 'false' : 'true');
  if (titulo) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = titulo;
    svg.append(t);
  }
  for (const d of TRAZOS[nombre] ?? []) {
    const trazo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    trazo.setAttribute('d', d);
    svg.append(trazo);
  }
  return svg;
}

// ---- Formato ----
const formatoPesos = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
export const pesos = (n) => formatoPesos.format(n);
export const hora = (iso) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const fechaHora = (iso) =>
  new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const patenteLegible = (p) => (p?.length === 6 ? `${p.slice(0, 2)}·${p.slice(2, 4)}·${p.slice(4)}` : p);
export const metros = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);

export function textoCupos(cupos) {
  if (cupos <= 0) return 'Lleno';
  return cupos === 1 ? '1 asiento' : `${cupos} asientos`;
}
export const claseCupos = (cupos) => (cupos <= 0 ? 'lleno' : cupos === 1 ? 'ultimo' : 'libre');

// ---- Avisos flotantes ----
export function flotante(mensaje, tipo = 'info', ms = 3800) {
  const zona = document.getElementById('flotantes');
  const el = h('div', { class: `flotante flotante--${tipo}` }, mensaje);
  zona.append(el);
  setTimeout(() => el.remove(), ms);
}

// ---- Ventanas modales (elemento <dialog> nativo: foco atrapado y cierre con Esc) ----
export function modal({ titulo, contenido, ancha = false, alCerrar }) {
  const cuerpo = h('div', { class: 'modal-cuerpo' }, h('h2', { id: 'modal-titulo' }, titulo), contenido);
  const dialogo = h('dialog', { class: `modal${ancha ? ' modal--ancha' : ''}`, 'aria-labelledby': 'modal-titulo' }, cuerpo);
  dialogo.addEventListener('close', () => {
    dialogo.remove();
    alCerrar?.();
  });
  dialogo.addEventListener('click', (e) => {
    if (e.target === dialogo) dialogo.close();
  });
  document.body.append(dialogo);
  dialogo.showModal();
  return { cerrar: () => dialogo.close(), dialogo, cuerpo };
}

export function confirmar({ titulo, mensaje, aceptar = 'Aceptar', cancelar = 'Cancelar', peligro = false }) {
  return new Promise((resolver) => {
    let respuesta = false;
    const m = modal({
      titulo,
      contenido: [
        mensaje ? h('p', { class: 'suave' }, mensaje) : null,
        h(
          'div',
          { class: 'modal-acciones' },
          h('button', { class: 'boton boton--borde', type: 'button', onclick: () => m.cerrar() }, cancelar),
          h(
            'button',
            {
              class: `boton ${peligro ? 'boton--peligro' : 'boton--primario'}`,
              type: 'button',
              onclick: () => {
                respuesta = true;
                m.cerrar();
              },
            },
            aceptar,
          ),
        ),
      ],
      alCerrar: () => resolver(respuesta),
    });
  });
}

// ---- Formularios ----
export function campo({ etiqueta, nombre, tipo = 'text', valor = '', ayuda, opciones, ...resto }) {
  let control;
  if (tipo === 'select') {
    control = h('select', { class: 'entrada', name: nombre, id: `c-${nombre}`, ...resto });
    for (const o of opciones) {
      const opcion = h('option', { value: o.valor }, o.texto);
      if (String(o.valor) === String(valor)) opcion.selected = true;
      control.append(opcion);
    }
  } else if (tipo === 'textarea') {
    control = h('textarea', { class: 'entrada', name: nombre, id: `c-${nombre}`, ...resto });
    control.value = valor;
  } else {
    control = h('input', { class: 'entrada', type: tipo, name: nombre, id: `c-${nombre}`, ...resto });
    control.value = valor ?? '';
  }
  return h(
    'label',
    { class: 'campo', for: `c-${nombre}` },
    h('span', null, etiqueta),
    control,
    ayuda ? h('small', { class: 'ayuda' }, ayuda) : null,
    h('small', { class: 'error', 'data-error': nombre, hidden: true }),
  );
}

export function leerFormulario(formulario) {
  const datos = {};
  for (const [clave, valor] of new FormData(formulario).entries()) datos[clave] = typeof valor === 'string' ? valor.trim() : valor;
  return datos;
}

/** Muestra junto a cada campo el mensaje de validación que devolvió el servidor. */
export function mostrarErrores(formulario, error, alias = {}) {
  for (const el of formulario.querySelectorAll('[data-error]')) {
    el.hidden = true;
    el.textContent = '';
  }
  for (const el of formulario.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  const general = formulario.querySelector('[data-error-general]');
  if (general) general.hidden = true;
  if (!error) return;

  let ubicados = 0;
  for (const d of error.detalles ?? []) {
    const nombre = alias[d.campo] ?? d.campo.split('.')[0];
    const destino = formulario.querySelector(`[data-error="${CSS.escape(nombre)}"]`);
    if (!destino) continue;
    destino.textContent = d.mensaje;
    destino.hidden = false;
    formulario.querySelector(`[name="${CSS.escape(nombre)}"]`)?.setAttribute('aria-invalid', 'true');
    ubicados++;
  }
  if (general && (!ubicados || !error.detalles?.length)) {
    const sueltos = (error.detalles ?? []).map((d) => d.mensaje).join(' ');
    general.querySelector('p').textContent = ubicados ? error.message : sueltos || error.message;
    general.hidden = false;
  }
}

export const errorGeneral = () =>
  h('div', { class: 'aviso aviso--error', 'data-error-general': true, hidden: true, role: 'alert' }, icono('alerta'), h('p'));

/** Deshabilita un botón mientras corre una acción asíncrona (evita doble envío). */
export async function conBoton(boton, accion) {
  if (boton.disabled) return undefined;
  boton.disabled = true;
  try {
    return await accion();
  } finally {
    boton.disabled = false;
  }
}

export const cargando = (texto = 'Cargando…') => h('div', { class: 'cargando', role: 'status' }, texto);
export const vacio = (texto) => h('div', { class: 'vacio' }, texto);
export const insignia = (texto, clase) => h('span', { class: `insignia insignia--${clase}` }, texto);
