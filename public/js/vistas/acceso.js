/** Pantallas de acceso: iniciar sesión, verificación en dos pasos y registro de pasajeros. */
import { api } from '../api.js';
import { h, reemplazar, campo, leerFormulario, mostrarErrores, errorGeneral, conBoton, icono } from '../ui.js';

const DEMO = [
  { rol: 'Pasajero', email: 'pasajero@demo.cl' },
  { rol: 'Conductor', email: 'conductor@demo.cl' },
  { rol: 'Sindicato', email: 'admin@demo.cl' },
];

export async function vistaAcceso(raiz, hash) {
  const panel = h('section', { class: 'acceso-panel' });
  reemplazar(
    raiz,
    h(
      'div',
      { class: 'acceso' },
      h(
        'section',
        { class: 'acceso-portada' },
        h('div', { class: 'marca' }, h('span', { class: 'marca-sello', 'aria-hidden': 'true' }, 'CO'), 'Conatacoch'),
        h('p', { class: 'lema' }, 'Tu colectivo, en vivo.'),
        h('p', null, 'Mira dónde viene, cuántos asientos trae y paga sin efectivo.'),
      ),
      panel,
    ),
  );

  let hayDemo = false;
  try {
    hayDemo = Boolean((await api.salud()).modo_demo);
  } catch {
    /* sin conexión: se muestra el formulario igual */
  }

  const mostrarLogin = () => {
    const boton = h('button', { class: 'boton boton--primario boton--bloque', type: 'submit' }, 'Entrar');
    const formulario = h(
      'form',
      { novalidate: true },
      errorGeneral(),
      campo({ etiqueta: 'Correo', nombre: 'email', tipo: 'email', autocomplete: 'username', inputmode: 'email', required: true }),
      campo({ etiqueta: 'Contraseña', nombre: 'contrasena', tipo: 'password', autocomplete: 'current-password', required: true }),
      boton,
    );
    formulario.addEventListener('submit', (evento) => {
      evento.preventDefault();
      conBoton(boton, async () => {
        const { email, contrasena } = leerFormulario(formulario);
        try {
          const datos = await api.iniciarSesion(email, contrasena);
          if (datos.mfa_requerido) mostrarCodigo(datos.mfa_token);
        } catch (error) {
          mostrarErrores(formulario, error);
        }
      });
    });

    reemplazar(
      panel,
      h('div', { class: 'pila-chica' }, h('h1', null, 'Iniciar sesión'), h('p', { class: 'suave' }, 'Pasajeros, conductores y sindicato entran por aquí.')),
      formulario,
      hayDemo
        ? h(
            'div',
            { class: 'pila-chica' },
            h('span', { class: 'etiqueta suave' }, 'Cuentas de demostración (completan el correo)'),
            h(
              'div',
              { class: 'demo-cuentas' },
              DEMO.map((c) =>
                h(
                  'button',
                  {
                    class: 'chip',
                    type: 'button',
                    onclick: () => {
                      formulario.elements.email.value = c.email;
                      formulario.elements.contrasena.focus();
                    },
                  },
                  c.rol,
                ),
              ),
            ),
          )
        : null,
      h('p', { class: 'chico' }, '¿Eres pasajero y no tienes cuenta? ', h('a', { href: '#/registro' }, 'Crear cuenta')),
    );
    formulario.elements.email.focus();
  };

  const mostrarCodigo = (mfaToken) => {
    const boton = h('button', { class: 'boton boton--primario boton--bloque', type: 'submit' }, 'Verificar');
    const formulario = h(
      'form',
      { novalidate: true },
      errorGeneral(),
      campo({
        etiqueta: 'Código de 6 dígitos',
        nombre: 'codigo',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
        maxlength: '6',
        pattern: '[0-9]{6}',
        required: true,
        ayuda: 'Lo entrega tu aplicación autenticadora. En la demostración: npm run mfa',
      }),
      boton,
      h('button', { class: 'boton boton--fantasma boton--bloque', type: 'button', onclick: mostrarLogin }, 'Volver'),
    );
    formulario.addEventListener('submit', (evento) => {
      evento.preventDefault();
      conBoton(boton, async () => {
        try {
          await api.verificarCodigo(mfaToken, leerFormulario(formulario).codigo);
        } catch (error) {
          mostrarErrores(formulario, error);
        }
      });
    });
    reemplazar(
      panel,
      h('div', { class: 'pila-chica' }, h('h1', null, 'Verificación en dos pasos'), h('p', { class: 'suave' }, 'Las cuentas del sindicato piden un segundo código, igual que un banco.')),
      h('div', { class: 'aviso' }, icono('escudo'), h('p', null, 'Tu contraseña es correcta. Falta confirmar que eres tú.')),
      formulario,
    );
    formulario.elements.codigo.focus();
  };

  const mostrarRegistro = () => {
    const boton = h('button', { class: 'boton boton--primario boton--bloque', type: 'submit' }, 'Crear mi cuenta');
    const formulario = h(
      'form',
      { novalidate: true },
      errorGeneral(),
      campo({ etiqueta: 'Nombre y apellido', nombre: 'nombre', autocomplete: 'name', required: true }),
      campo({ etiqueta: 'Correo', nombre: 'email', tipo: 'email', autocomplete: 'email', inputmode: 'email', required: true }),
      campo({ etiqueta: 'Contraseña', nombre: 'contrasena', tipo: 'password', autocomplete: 'new-password', required: true, ayuda: 'Mínimo 10 caracteres, con letras y números.' }),
      boton,
    );
    formulario.addEventListener('submit', (evento) => {
      evento.preventDefault();
      conBoton(boton, async () => {
        try {
          await api.registrar(leerFormulario(formulario));
        } catch (error) {
          mostrarErrores(formulario, error);
        }
      });
    });
    reemplazar(
      panel,
      h('div', { class: 'pila-chica' }, h('h1', null, 'Crear cuenta de pasajero'), h('p', { class: 'suave' }, 'Solo pedimos lo necesario: nombre y correo. No pedimos tu RUT.')),
      formulario,
      h('p', { class: 'chico' }, '¿Ya tienes cuenta? ', h('a', { href: '#/entrar' }, 'Iniciar sesión')),
    );
    formulario.elements.nombre.focus();
  };

  if (hash === '#/registro') mostrarRegistro();
  else mostrarLogin();
  return null;
}
