/** Aplicación Express: seguridad de cabeceras, API y archivos de la interfaz web. */
import express from 'express';
import helmet from 'helmet';
import { join } from 'node:path';
import { RAIZ, config } from './config.js';
import { limiteApi } from './middleware/limites.js';
import { manejadorErrores, rutaNoEncontrada } from './middleware/errores.js';
import { rutasAuth } from './routes/auth.js';
import { rutasTrazados } from './routes/trazados.js';
import { rutasSindicato } from './routes/sindicato.js';
import { rutasOperacion } from './routes/operacion.js';
import * as flota from './services/flota.js';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');

  // Cabeceras de seguridad. La política de contenido (CSP) solo permite código propio:
  // aunque alguien lograra inyectar un <script>, el navegador no lo ejecutaría (XSS).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=()');
    next();
  });

  // ---- API ----
  const api = express.Router();
  api.use(limiteApi);
  api.use(express.json({ limit: '200kb' }));
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); // las respuestas con datos personales no se guardan en caché
    next();
  });
  api.get('/salud', (req, res) => {
    res.json({
      estado: 'ok',
      modo_demo: !config.esProduccion, // la pantalla de acceso solo sugiere cuentas de prueba fuera de producción
      en_recorrido: flota.todos().length,
      hora: new Date().toISOString(),
    });
  });
  api.use('/auth', rutasAuth);
  api.use('/trazados', rutasTrazados);
  api.use('/sindicato', rutasSindicato);
  api.use('/', rutasOperacion);
  api.use(rutaNoEncontrada);
  app.use('/api', api);

  // ---- Interfaz web (archivos estáticos) ----
  const estaticos = { maxAge: config.esProduccion ? '1h' : 0 };
  app.use('/vendor/leaflet', express.static(join(RAIZ, 'node_modules', 'leaflet', 'dist'), { maxAge: '7d' }));
  app.use('/vendor/inter', express.static(join(RAIZ, 'node_modules', '@fontsource-variable', 'inter', 'files'), { maxAge: '7d' }));
  app.use(express.static(join(RAIZ, 'public'), estaticos));

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);
  return app;
}
