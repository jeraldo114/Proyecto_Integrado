/** Arranque de la aplicación, navegación y estructura común de todas las pantallas. */
import { api, renovar, sesion, ErrorRed } from './api.js';
import { h, reemplazar, icono, modal, cargando, flotante } from './ui.js';
import { vistaAcceso } from './vistas/acceso.js';
import { vistaMapa, vistaBilletera } from './vistas/pasajero.js';
import { vistaTurno, vistaRecaudacion } from './vistas/conductor.js';
import { vistaResumen, vistaConductores, vistaVehiculos, vistaTrazados, vistaOpiniones, vistaAuditoria } from './vistas/sindicato.js';
import { abrirOpinion, vistaGuiaEstilo } from './vistas/comunes.js';

const raiz = document.getElementById('raiz');

/** Menú de cada rol: lo que no aparece aquí, ese rol no lo puede abrir. */
const MENUS = {
  pasajero: [
    { ruta: '#/mapa', nombre: 'Mapa', icono: 'mapa', vista: vistaMapa },
    { ruta: '#/billetera', nombre: 'Billetera', icono: 'billetera', vista: vistaBilletera },
  ],
  conductor: [
    { ruta: '#/turno', nombre: 'Mi turno', icono: 'volante', vista: vistaTurno },
    { ruta: '#/recaudacion', nombre: 'Recaudación', icono: 'monedas', vista: vistaRecaudacion },
  ],
  admin: [
    { ruta: '#/resumen', nombre: 'Resumen', icono: 'tablero', vista: vistaResumen },
    { ruta: '#/conductores', nombre: 'Conductores', icono: 'personas', vista: vistaConductores },
    { ruta: '#/vehiculos', nombre: 'Vehículos', icono: 'auto', vista: vistaVehiculos },
    { ruta: '#/trazados', nombre: 'Trazados', icono: 'ruta', vista: vistaTrazados },
    { ruta: '#/opiniones', nombre: 'Opiniones', icono: 'opinion', vista: vistaOpiniones },
    { ruta: '#/auditoria', nombre: 'Auditoría', icono: 'escudo', vista: vistaAuditoria },
  ],
};
const NOMBRE_ROL = { pasajero: 'Pasajero', conductor: 'Conductor', admin: 'Sindicato' };

let limpiarVista = null;
let turnoNavegacion = 0;

function menuUsuario() {
  const usuario = sesion.usuario;
  const m = modal({
    titulo: usuario.nombre,
    contenido: [
      h('p', { class: 'suave' }, `${NOMBRE_ROL[usuario.rol]} · ${usuario.email}`),
      usuario.rol === 'admin' ? h('p', { class: 'chico suave' }, 'Tu cuenta usa verificación en dos pasos.') : null,
      h(
        'div',
        { class: 'pila-chica' },
        h('button', { class: 'boton boton--borde boton--bloque', type: 'button', onclick: () => { m.cerrar(); abrirOpinion(); } }, icono('opinion'), 'Enviar una opinión'),
        h('button', { class: 'boton boton--borde boton--bloque', type: 'button', onclick: () => { m.cerrar(); location.hash = '#/guia'; } }, icono('paleta'), 'Guía de estilo'),
        h('button', { class: 'boton boton--oscuro boton--bloque', type: 'button', onclick: async () => { m.cerrar(); await api.cerrarSesion(); } }, icono('salir'), 'Cerrar sesión'),
      ),
    ],
  });
}

function estructura(usuario, menu, actual) {
  const vista = h('main', { class: 'vista', id: 'vista', tabindex: '-1' });
  const app = h(
    'div',
    { class: `app${usuario.rol === 'admin' ? ' app--lateral' : ''}` },
    h(
      'header',
      { class: 'barra' },
      h('a', { class: 'marca', href: menu[0].ruta, 'aria-label': 'Conatacoch, inicio' }, h('span', { class: 'marca-sello', 'aria-hidden': 'true' }, 'CO'), 'Conatacoch'),
      h('span', { class: 'rol' }, NOMBRE_ROL[usuario.rol]),
      h('span', { class: 'crecer' }),
      h('button', { class: 'boton boton--fantasma', type: 'button', onclick: menuUsuario, 'aria-label': 'Abrir menú de usuario' }, icono('usuario'), h('span', { class: 'chico' }, usuario.nombre.split(' ')[0])),
    ),
    vista,
    h(
      'nav',
      { class: 'pestanas', 'aria-label': 'Secciones' },
      menu.map((item) =>
        h('a', { class: 'pestana', href: item.ruta, 'aria-current': item.ruta === actual?.ruta ? 'page' : null }, icono(item.icono), item.nombre),
      ),
    ),
  );
  return { app, vista };
}

async function navegar() {
  const turno = ++turnoNavegacion;
  limpiarVista?.();
  limpiarVista = null;

  const usuario = sesion.usuario;
  if (!usuario) {
    delete document.body.dataset.tema;
    limpiarVista = await vistaAcceso(raiz, location.hash);
    return;
  }

  // La vista del conductor usa siempre el tema oscuro de alto contraste.
  if (usuario.rol === 'conductor') document.body.dataset.tema = 'oscuro';
  else delete document.body.dataset.tema;

  const menu = MENUS[usuario.rol];
  const esGuia = location.hash === '#/guia';
  const actual = menu.find((m) => m.ruta === location.hash);
  if (!actual && !esGuia) {
    location.replace(menu[0].ruta); // ruta desconocida o de otro rol: vuelve al inicio del rol
    return;
  }

  const { app, vista } = estructura(usuario, menu, actual);
  reemplazar(raiz, app);
  reemplazar(vista, cargando());
  try {
    const limpiar = await (esGuia ? vistaGuiaEstilo : actual.vista)(vista);
    if (turno === turnoNavegacion) limpiarVista = limpiar ?? null;
    else limpiar?.();
  } catch (error) {
    if (turno !== turnoNavegacion) return;
    reemplazar(
      vista,
      h('div', { class: 'contenido pila' }, h('div', { class: 'aviso aviso--error', role: 'alert' }, icono('alerta'), h('p', null, error.message)), h('button', { class: 'boton boton--borde', type: 'button', onclick: navegar }, 'Reintentar')),
    );
  }
}

async function iniciar() {
  try {
    await renovar(); // recupera la sesión de esta pestaña si existe
  } catch (error) {
    if (error instanceof ErrorRed) flotante('No hay conexión con el servidor.', 'error');
  }
  sesion.alCambiar(() => navegar());
  window.addEventListener('hashchange', navegar);
  navegar();
}

iniciar();
