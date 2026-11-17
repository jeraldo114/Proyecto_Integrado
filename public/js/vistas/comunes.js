/** Pantallas compartidas por todos los roles: enviar una opinión y guía de estilo. */
import { api, sesion } from '../api.js';
import { h, reemplazar, modal, campo, leerFormulario, mostrarErrores, errorGeneral, conBoton, flotante, icono, insignia } from '../ui.js';

/** Formulario de retroalimentación: cualquier usuario puede opinar desde cualquier pantalla. */
export function abrirOpinion() {
  let puntaje = 0;
  const estrellas = h('div', { class: 'estrellas', role: 'group', 'aria-label': 'Puntaje de 1 a 5' });
  const pintarEstrellas = () =>
    reemplazar(
      estrellas,
      [1, 2, 3, 4, 5].map((n) =>
        h(
          'button',
          {
            class: 'estrella',
            type: 'button',
            'aria-pressed': String(n <= puntaje),
            'aria-label': `${n} de 5`,
            onclick: () => {
              puntaje = puntaje === n ? 0 : n;
              pintarEstrellas();
            },
          },
          '★',
        ),
      ),
    );
  pintarEstrellas();

  const boton = h('button', { class: 'boton boton--primario', type: 'submit' }, 'Enviar opinión');
  const formulario = h(
    'form',
    { class: 'pila', novalidate: true },
    errorGeneral(),
    campo({
      etiqueta: '¿Qué nos quieres contar?',
      nombre: 'tipo',
      tipo: 'select',
      opciones: [
        { valor: 'sugerencia', texto: 'Una sugerencia' },
        { valor: 'problema', texto: 'Un problema' },
        { valor: 'felicitacion', texto: 'Una felicitación' },
      ],
    }),
    h('div', { class: 'campo' }, h('span', null, '¿Cómo calificas la aplicación? (opcional)'), estrellas),
    campo({ etiqueta: 'Tu comentario', nombre: 'comentario', tipo: 'textarea', maxlength: '600', required: true, ayuda: 'Lo lee el sindicato y el equipo que mejora la aplicación.' }),
    h('div', { class: 'modal-acciones' }, h('button', { class: 'boton boton--borde', type: 'button', onclick: () => m.cerrar() }, 'Cancelar'), boton),
  );
  const m = modal({ titulo: 'Enviar una opinión', contenido: formulario });

  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    conBoton(boton, async () => {
      const datos = leerFormulario(formulario);
      try {
        await api.post('/opiniones', {
          tipo: datos.tipo,
          comentario: datos.comentario,
          ...(puntaje ? { puntaje } : {}),
          // Contexto técnico mínimo para reproducir problemas de pantalla (sin datos personales).
          contexto: {
            pantalla: location.hash.replace('#/', '') || 'inicio',
            ancho: window.innerWidth,
            alto: window.innerHeight,
            tactil: navigator.maxTouchPoints > 0,
          },
        });
        m.cerrar();
        flotante('¡Gracias! Tu opinión quedó registrada.', 'exito');
      } catch (error) {
        mostrarErrores(formulario, error);
      }
    });
  });
}

/** Guía de estilo viva: muestra los mismos tokens y componentes que usa toda la aplicación. */
export async function vistaGuiaEstilo(vista) {
  const color = (nombre, variable) => h('div', { class: 'muestra' }, h('i', { vars: { '--color-muestra': `var(${variable})` } }), h('span', null, nombre));
  const tamano = (nombre, variable, uso) => h('p', { vars: { 'font-size': `var(${variable})` } }, `${nombre} · ${uso}`);

  reemplazar(
    vista,
    h(
      'div',
      { class: 'contenido pila' },
      h('h1', null, 'Guía de estilo'),
      h('p', { class: 'suave' }, `Una sola fuente de colores, letras y componentes para pasajero, conductor y sindicato. Estás viendo el tema ${sesion.usuario.rol === 'conductor' ? 'oscuro (conductor)' : 'claro'}.`),

      h('section', { class: 'tarjeta pila' }, h('h2', null, 'Colores de marca y de estado'), h('div', { class: 'muestras' },
        color('Amarillo colectivo', '--amarillo-500'), color('Negro', '--negro'), color('Fondo', '--fondo'), color('Superficie', '--superficie-2'),
        color('Asientos libres', '--cupo-libre'), color('Último asiento', '--cupo-ultimo'), color('Lleno', '--cupo-lleno'), color('Error', '--rojo-600'),
      ), h('p', { class: 'chico suave' }, 'El color nunca va solo: siempre lo acompaña un número o una palabra (accesible para daltonismo).')),

      h('section', { class: 'tarjeta pila-chica' }, h('h2', null, 'Tipografía Inter'),
        tamano('32', '--t-2xl', 'cifras destacadas'), tamano('24', '--t-xl', 'títulos'), tamano('18', '--t-l', 'botones de acción (mínimo)'),
        tamano('16', '--t-m', 'texto'), tamano('14', '--t-s', 'apoyo'),
      ),

      h('section', { class: 'tarjeta pila' }, h('h2', null, 'Botones'), h('div', { class: 'fila envolver' },
        h('button', { class: 'boton boton--primario', type: 'button' }, 'Acción principal'),
        h('button', { class: 'boton boton--oscuro', type: 'button' }, 'Secundaria'),
        h('button', { class: 'boton boton--borde', type: 'button' }, icono('ubicacion'), 'Con icono'),
        h('button', { class: 'boton boton--peligro', type: 'button' }, 'Acción delicada'),
      ), h('p', { class: 'chico suave' }, 'Altura mínima táctil: 48 px. En la vista del conductor los botones de cupos ocupan toda la pantalla.')),

      h('section', { class: 'tarjeta pila' }, h('h2', null, 'Estados'), h('div', { class: 'fila envolver' },
        insignia('3 asientos', 'libre'), insignia('1 asiento', 'ultimo'), insignia('Lleno', 'lleno'), insignia('Validado', 'validado'), insignia('Pendiente', 'pendiente'), insignia('Suspendido', 'suspendido'),
      ),
        h('div', { class: 'aviso' }, icono('escudo'), h('p', null, 'Aviso informativo')),
        h('div', { class: 'aviso aviso--alerta' }, icono('alerta'), h('p', null, 'Aviso de atención')),
        h('div', { class: 'aviso aviso--exito' }, icono('check'), h('p', null, 'Aviso de éxito')),
      ),

      h('section', { class: 'tarjeta pila-chica' }, h('h2', null, 'Adaptabilidad'),
        h('p', null, `Tu pantalla mide ${window.innerWidth} × ${window.innerHeight} px.`),
        h('p', { class: 'suave' }, 'Teléfono: una columna y menú inferior. Tablet (700 px): rejillas de 2 a 4 columnas. Escritorio (1000 px): panel junto al mapa y menú lateral.'),
      ),
    ),
  );
  return null;
}
