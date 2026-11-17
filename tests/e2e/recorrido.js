/**
 * Prueba de extremo a extremo (E2E) sobre la interfaz real, en un navegador.
 * Recorre los tres roles como lo haría una persona, comprueba los criterios de aceptación
 * de las historias de usuario y guarda capturas en docs/capturas/ (evidencia del informe).
 *
 * Requisitos: el servidor corriendo (npm start) y Chrome o Edge instalado.
 *
 *   npm run test:e2e
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as esperar } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { sql } from '../../src/db/sql.js';
import { descifrar } from '../../src/lib/cifrado.js';
import { totp } from '../../src/lib/totp.js';
import { CLAVE_DEMO, CUENTAS_DEMO } from '../../src/db/seed.js';

const URL_APP = process.env.URL_APP ?? 'http://localhost:3000';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const carpeta = join(raiz, 'docs', 'capturas');
mkdirSync(carpeta, { recursive: true });

const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const ejecutable = process.env.NAVEGADOR ?? NAVEGADORES.find(existsSync);
if (!ejecutable) throw new Error('No se encontró Chrome ni Edge. Indica la ruta con la variable NAVEGADOR.');

const ESCRITORIO = { width: 1366, height: 800, deviceScaleFactor: 2 };
const TELEFONO = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const TABLET = { width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const resultados = [];
function comprobar(nombre, condicion, detalle = '') {
  resultados.push({ nombre, ok: Boolean(condicion) });
  console.log(`  ${condicion ? '✔' : '✖'} ${nombre}${detalle ? ` (${detalle})` : ''}`);
}

const navegador = await puppeteer.launch({ executablePath: ejecutable, headless: true, args: ['--lang=es-CL', '--hide-scrollbars'] });

async function abrir(vista, { geolocalizacion } = {}) {
  const contexto = await navegador.createBrowserContext(); // cada rol con sus propias cookies
  const pagina = await contexto.newPage();
  await pagina.setViewport(vista);
  if (geolocalizacion) {
    await contexto.overridePermissions(URL_APP, ['geolocation']);
    await pagina.setGeolocation(geolocalizacion);
  }
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => {
    // Se ignoran las respuestas 400/401 que esta misma prueba provoca a propósito (clave errada,
    // código errado, RUT inválido) y el 401 inicial con que la app pregunta si hay sesión guardada.
    // Cualquier otro error (JavaScript, bloqueo de la CSP, error 500) sí cuenta como falla.
    // También se ignoran los cortes de red que la prueba del modo sin señal provoca a propósito.
    const esperado = /Failed to load resource: the server responded with a status of (400|401)|ERR_INTERNET_DISCONNECTED/.test(m.text());
    if (m.type() === 'error' && !esperado) errores.push(m.text());
  });
  await pagina.goto(URL_APP, { waitUntil: 'networkidle2' });
  return { pagina, contexto, errores };
}

const captura = async (pagina, nombre, opciones = {}) => {
  await pagina.screenshot({ path: join(carpeta, `${nombre}.png`), ...opciones });
};

/** Hace clic en el primer elemento visible cuyo texto contiene `texto`. */
async function pulsar(pagina, selector, texto) {
  const ok = await pagina.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t) && e.offsetParent !== null);
      if (!el) return false;
      el.click();
      return true;
    },
    selector,
    texto,
  );
  if (!ok) throw new Error(`No se encontró "${texto}" en ${selector}`);
}

const hayTexto = (pagina, texto, ms = 6000) =>
  pagina
    .waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, texto)
    .then(() => true)
    .catch(() => false);

async function entrar(pagina, email) {
  await pagina.waitForSelector('input[name="email"]');
  await pagina.type('input[name="email"]', email);
  await pagina.type('input[name="contrasena"]', CLAVE_DEMO);
  await pagina.keyboard.press('Enter');
}

async function mapaListo(pagina) {
  await pagina.waitForSelector('.marcador-colectivo', { timeout: 10000 });
  await pagina.waitForNetworkIdle({ idleTime: 700, timeout: 12000 }).catch(() => {});
  await esperar(600);
}

try {
  // ================================================================ Acceso
  console.log('\nAcceso y seguridad');
  const p = await abrir(ESCRITORIO);
  await captura(p.pagina, '01-acceso');
  comprobar('La pantalla de acceso carga', await hayTexto(p.pagina, 'Iniciar sesión'));

  await p.pagina.type('input[name="email"]', CUENTAS_DEMO.pasajero);
  await p.pagina.type('input[name="contrasena"]', 'clave-incorrecta-1');
  await p.pagina.keyboard.press('Enter');
  comprobar('Una contraseña incorrecta muestra un mensaje claro y no entra', await hayTexto(p.pagina, 'Correo o contraseña incorrectos'));
  await p.pagina.evaluate(() => {
    document.querySelector('input[name="email"]').value = '';
    document.querySelector('input[name="contrasena"]').value = '';
  });

  // ================================================================ Conductor (teléfono)
  console.log('\nConductor (teléfono, tema oscuro)');
  const c = await abrir(TELEFONO);
  await entrar(c.pagina, CUENTAS_DEMO.conductor);
  await c.pagina.waitForSelector('.conductor');
  if (await c.pagina.$('.cupos')) {
    // Quedó un turno abierto de una ejecución anterior: se cierra para partir de cero.
    await pulsar(c.pagina, 'button', 'Fin de turno');
    await pulsar(c.pagina, 'dialog[open] button', 'Sí, terminar turno');
  }
  comprobar('El conductor entra a "Mi turno"', await hayTexto(c.pagina, 'INICIAR TURNO'));
  comprobar('La vista del conductor usa el tema oscuro', (await c.pagina.evaluate(() => document.body.dataset.tema)) === 'oscuro');
  await captura(c.pagina, 'm1-conductor-fuera-de-turno');

  await pulsar(c.pagina, 'button', 'INICIAR TURNO');
  await c.pagina.waitForSelector('.cupos');
  const altoBoton = await c.pagina.evaluate(() => Math.min(...[...document.querySelectorAll('.cupo')].map((b) => b.getBoundingClientRect().height)));
  comprobar('Los botones de cupos son gigantes (mínimo 96 px de alto)', altoBoton >= 96, `${Math.round(altoBoton)} px`);
  await c.pagina.click('.cupo[aria-label="Quedan 2 asientos"]');
  await c.pagina.waitForSelector('.cupo[aria-label="Quedan 2 asientos"][aria-pressed="true"]');
  await esperar(400);
  await captura(c.pagina, 'm2-conductor-cupos');

  // ================================================================ Pasajero (escritorio)
  console.log('\nPasajero (escritorio)');
  await entrar(p.pagina, CUENTAS_DEMO.pasajero);
  await mapaListo(p.pagina);
  comprobar('El pasajero ve el mapa con colectivos en vivo', (await p.pagina.$$('.marcador-colectivo')).length >= 3);
  const filaPropia = () =>
    p.pagina.evaluate(() => [...document.querySelectorAll('.colectivo')].find((li) => li.textContent.includes('HJ·KL·45'))?.textContent ?? null);
  await p.pagina.waitForFunction(() => [...document.querySelectorAll('.colectivo')].some((li) => li.textContent.includes('HJ·KL·45')), { timeout: 8000 });
  comprobar('El colectivo del conductor aparece con "2 asientos" (HU-01 / HU-02)', (await filaPropia())?.includes('2 asientos'));
  await captura(p.pagina, '02-pasajero-mapa');

  // Cambio de cupos: debe verse en menos de 3 segundos.
  const t0 = Date.now();
  await c.pagina.click('.cupo[aria-label="Quedan 3 asientos"]');
  await p.pagina.waitForFunction(() => [...document.querySelectorAll('.colectivo')].some((li) => li.textContent.includes('HJ·KL·45') && li.textContent.includes('3 asientos')), { timeout: 5000 });
  const latencia = Date.now() - t0;
  comprobar('Un cambio de cupos llega a la pantalla del pasajero en menos de 3 s', latencia < 3000, `${latencia} ms`);

  // Pago del pasaje al colectivo del conductor.
  await p.pagina.evaluate(() => [...document.querySelectorAll('.colectivo')].find((li) => li.textContent.includes('HJ·KL·45')).querySelector('button').click());
  await p.pagina.waitForSelector('dialog[open]');
  await esperar(300);
  await captura(p.pagina, '03-pasajero-pago');
  await pulsar(p.pagina, 'dialog[open] button', 'Pagar $');
  comprobar('El pasajero paga el pasaje desde su billetera', await hayTexto(p.pagina, 'Pago realizado'));
  comprobar('El conductor recibe el aviso del pago al instante', await hayTexto(c.pagina, 'Pago recibido'));

  // Aviso de espera.
  await pulsar(p.pagina, 'button', 'Avisar que espero aquí');
  comprobar('El pasajero avisa que espera en su paradero', await hayTexto(p.pagina, 'avisamos a'));
  comprobar('El conductor ve "Pasajeros esperando" con el paradero', await hayTexto(c.pagina, 'Plaza de Puente Alto: 1 pasajero'));
  await esperar(6500); // se van los avisos flotantes
  await captura(c.pagina, 'm3-conductor-aviso-pasajero');

  // Colectivo lleno: no recibe avisos y deja de ofrecerse.
  await c.pagina.click('.cupo[aria-label="Lleno"]');
  comprobar('Al marcar LLENO el conductor deja de recibir avisos (HU-02)', await hayTexto(c.pagina, 'Vas lleno'));
  await p.pagina.waitForFunction(() => ![...document.querySelectorAll('.colectivo')].some((li) => li.textContent.includes('HJ·KL·45')), { timeout: 5000 });
  comprobar('Un colectivo lleno sale de la lista y queda en gris en el mapa (HU-01)', (await p.pagina.$$('.marcador-colectivo--lleno')).length >= 1);
  await c.pagina.click('.cupo[aria-label="Quedan 2 asientos"]');

  // Modo sin señal (HU-02, criterio 3): se corta la red del teléfono del conductor.
  await c.pagina.setOfflineMode(true);
  await c.pagina.click('.cupo[aria-label="Queda un asiento"]');
  comprobar('Sin señal, el cambio de cupos queda guardado en el teléfono y se avisa al conductor', await hayTexto(c.pagina, 'Sin señal: tu cambio quedó guardado'));
  await esperar(300);
  await captura(c.pagina, 'm10-conductor-sin-senal');
  await c.pagina.setOfflineMode(false);
  comprobar('Al volver la señal el cambio se envía solo', await hayTexto(c.pagina, 'Volvió la señal', 12000));
  await p.pagina.waitForFunction(() => [...document.querySelectorAll('.colectivo')].some((li) => li.textContent.includes('HJ·KL·45') && li.textContent.includes('1 asiento')), { timeout: 8000 }).catch(() => {});
  comprobar('El pasajero ve el dato que se había guardado sin señal', (await filaPropia())?.includes('1 asiento'));

  // Geocerca: el pasajero indica una posición lejos del trazado.
  const mapa = await (await p.pagina.$('.mapa')).boundingBox();
  await p.pagina.mouse.click(mapa.x + 90, mapa.y + mapa.height - 120);
  comprobar('Fuera del trazado, la app indica la distancia y hacia dónde caminar (HU-01)', await hayTexto(p.pagina, 'del recorrido'));
  await esperar(500);
  await captura(p.pagina, '04-pasajero-geocerca');

  await p.pagina.goto(`${URL_APP}/#/billetera`);
  comprobar('La billetera muestra saldo y movimientos', (await hayTexto(p.pagina, 'Saldo disponible')) && (await hayTexto(p.pagina, 'Pasaje · HJ·KL·45')));
  await pulsar(p.pagina, 'button', '+ $2.000');
  comprobar('La recarga (simulada) actualiza el saldo', await hayTexto(p.pagina, 'Recarga de $2.000 aprobada'));
  await esperar(4200);
  await captura(p.pagina, '05-pasajero-billetera');

  // Un pasajero no puede abrir pantallas del sindicato.
  await p.pagina.goto(`${URL_APP}/#/conductores`);
  await esperar(600);
  comprobar('Un pasajero que intenta abrir el panel del sindicato vuelve a su mapa', (await p.pagina.evaluate(() => location.hash)) === '#/mapa');

  // ================================================================ Conductor: recaudación
  await c.pagina.goto(`${URL_APP}/#/recaudacion`);
  comprobar('El conductor ve su recaudación del día', await hayTexto(c.pagina, 'Recaudado hoy'));
  await esperar(400);
  await captura(c.pagina, 'm4-conductor-recaudacion');
  await c.pagina.goto(`${URL_APP}/#/turno`);
  await c.pagina.waitForSelector('.cupos');

  // ================================================================ Pasajero en teléfono y tablet
  console.log('\nAdaptabilidad (teléfono y tablet)');
  const pm = await abrir(TELEFONO);
  await captura(pm.pagina, 'm5-acceso');
  await entrar(pm.pagina, CUENTAS_DEMO.pasajero);
  await mapaListo(pm.pagina);
  const sinDesborde = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  comprobar('Teléfono (390 px): el mapa del pasajero no se desborda a lo ancho', await sinDesborde(pm.pagina));
  await captura(pm.pagina, 'm6-pasajero-mapa');
  await pm.pagina.goto(`${URL_APP}/#/billetera`);
  await hayTexto(pm.pagina, 'Saldo disponible');
  await captura(pm.pagina, 'm7-pasajero-billetera');

  const pt = await abrir(TABLET);
  await entrar(pt.pagina, CUENTAS_DEMO.pasajero);
  await mapaListo(pt.pagina);
  comprobar('Tablet (820 px): el mapa del pasajero no se desborda a lo ancho', await sinDesborde(pt.pagina));
  await captura(pt.pagina, 't1-pasajero-mapa');

  await c.pagina.setViewport(TABLET);
  await esperar(500);
  comprobar('Tablet en el tablero del auto: los botones de cupos siguen ocupando la pantalla', await sinDesborde(c.pagina));
  await captura(c.pagina, 't2-conductor-cupos');
  await c.pagina.setViewport(TELEFONO);

  // ================================================================ Sindicato
  console.log('\nSindicato (administrador con verificación en dos pasos)');
  const a = await abrir(ESCRITORIO);
  await entrar(a.pagina, CUENTAS_DEMO.admin);
  comprobar('La contraseña sola no basta: se pide un segundo código', await hayTexto(a.pagina, 'Verificación en dos pasos'));
  await captura(a.pagina, '06-sindicato-verificacion');
  await a.pagina.type('input[name="codigo"]', '000000');
  await a.pagina.keyboard.press('Enter');
  comprobar('Un código incorrecto se rechaza', await hayTexto(a.pagina, 'Código incorrecto'));
  const { mfa_secreto } = sql('SELECT mfa_secreto FROM usuarios WHERE email = ?').get(CUENTAS_DEMO.admin);
  await a.pagina.evaluate(() => (document.querySelector('input[name="codigo"]').value = ''));
  await a.pagina.type('input[name="codigo"]', totp(descifrar(mfa_secreto)));
  await a.pagina.keyboard.press('Enter');
  comprobar('Con el código correcto entra al resumen', await hayTexto(a.pagina, 'Resumen del sindicato'));
  await esperar(500);
  await captura(a.pagina, '07-sindicato-resumen');

  for (const [ruta, texto, archivo] of [
    ['conductores', 'Registrar conductor', '08-sindicato-conductores'],
    ['vehiculos', 'Registrar vehículo', '09-sindicato-vehiculos'],
    ['trazados', 'Nuevo trazado', '10-sindicato-trazados'],
    ['opiniones', 'Opiniones de usuarios', '11-sindicato-opiniones'],
    ['auditoria', 'Registro de quién hizo qué', '12-sindicato-auditoria'],
  ]) {
    await a.pagina.goto(`${URL_APP}/#/${ruta}`);
    comprobar(`El sindicato abre "${ruta}"`, await hayTexto(a.pagina, texto));
    await esperar(500);
    await captura(a.pagina, archivo);
  }
  comprobar('La auditoría registró el intento fallido y los inicios de sesión', (await hayTexto(a.pagina, 'Intento de acceso fallido')) && (await hayTexto(a.pagina, 'Pago de pasaje')));

  // Validación de RUT en el formulario de conductor.
  await a.pagina.goto(`${URL_APP}/#/conductores`);
  await hayTexto(a.pagina, 'Registrar conductor');
  await pulsar(a.pagina, 'button', 'Registrar conductor');
  await a.pagina.waitForSelector('dialog[open] input[name="nombre"]');
  await a.pagina.type('dialog[open] input[name="nombre"]', 'Prueba Validación');
  await a.pagina.type('dialog[open] input[name="rut"]', '12.345.678-9');
  await a.pagina.type('dialog[open] input[name="email"]', 'prueba@ejemplo.cl');
  await pulsar(a.pagina, 'dialog[open] button', 'Guardar');
  comprobar('El formulario rechaza un RUT con dígito verificador incorrecto', await hayTexto(a.pagina, 'El RUT no es válido'));
  await esperar(300);
  await captura(a.pagina, '13-sindicato-validacion-rut');
  await a.pagina.keyboard.press('Escape');

  // Editor de trazados.
  await a.pagina.goto(`${URL_APP}/#/trazados`);
  await hayTexto(a.pagina, 'Nuevo trazado');
  await pulsar(a.pagina, 'button', 'Editar');
  await a.pagina.waitForSelector('dialog[open] .editor-mapa.leaflet-container');
  await a.pagina.waitForNetworkIdle({ idleTime: 700, timeout: 12000 }).catch(() => {});
  await a.pagina.evaluate(() => document.querySelector('dialog[open] .editor-mapa').scrollIntoView({ block: 'center' }));
  await esperar(900);
  await captura(a.pagina, '14-sindicato-editor-trazado');
  await a.pagina.keyboard.press('Escape');

  // Guía de estilo y vista del sindicato en teléfono.
  await a.pagina.goto(`${URL_APP}/#/guia`);
  await hayTexto(a.pagina, 'Guía de estilo');
  await esperar(400);
  await captura(a.pagina, '15-guia-de-estilo');
  await a.pagina.setViewport(TELEFONO);
  await a.pagina.goto(`${URL_APP}/#/vehiculos`);
  await hayTexto(a.pagina, 'Registrar vehículo');
  await esperar(500);
  comprobar('Teléfono: las tablas del sindicato se convierten en tarjetas sin desbordarse', await sinDesborde(a.pagina));
  await captura(a.pagina, 'm8-sindicato-vehiculos');

  // ================================================================ Fin de turno
  console.log('\nFin de turno (privacidad laboral)');
  await pulsar(c.pagina, 'button', 'Fin de turno');
  await c.pagina.waitForSelector('dialog[open]');
  await esperar(300);
  await captura(c.pagina, 'm9-conductor-fin-de-turno');
  await pulsar(c.pagina, 'dialog[open] button', 'Sí, terminar turno');
  comprobar('El conductor termina su turno', await hayTexto(c.pagina, 'INICIAR TURNO'));
  await pt.pagina.waitForFunction(() => ![...document.querySelectorAll('.colectivo')].some((li) => li.textContent.includes('HJ·KL·45')), { timeout: 5000 }).catch(() => {});
  const sigue = await pt.pagina.evaluate(() => [...document.querySelectorAll('.colectivo')].some((li) => li.textContent.includes('HJ·KL·45')));
  comprobar('Al terminar el turno el colectivo desaparece del mapa de los pasajeros', !sigue);

  const erroresConsola = [p, c, pm, pt, a].flatMap((x) => x.errores);
  comprobar('Ninguna pantalla produjo errores de JavaScript ni bloqueos de la política de contenido (CSP)', erroresConsola.length === 0, erroresConsola.slice(0, 3).join(' | '));
} finally {
  await navegador.close();
}

const fallas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallas.length} de ${resultados.length} comprobaciones correctas. Capturas en docs/capturas/`);
process.exit(fallas.length ? 1 : 0);
