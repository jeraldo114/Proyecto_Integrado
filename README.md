# Conatacoch: tu colectivo, en vivo

Este es nuestro Proyecto Integrado de INACAP Puente Alto. Partió con una pregunta que cualquiera que haya esperado un colectivo en la esquina se ha hecho alguna vez: *¿viene o no viene? Y si viene, ¿trae asiento?*

Lo que construimos para responderla es una aplicación web con tres pantallas que conversan entre sí en tiempo real:

- el **pasajero** ve dónde viene cada colectivo, cuántos minutos le faltan y cuántos asientos trae, y paga sin efectivo;
- el **conductor** informa sus asientos libres con un solo toque, sin tener que mirar el teléfono mientras maneja;
- el **sindicato** decide quién puede operar y ve lo que pasa en sus recorridos.

Lo que hace uno, los otros lo ven al instante.

## El equipo

| Integrante | Rol |
| --- | --- |
| Matías Jeraldo | Back end |
| Francisco Soto | Scrum Master |
| Eduardo Toro | Base de datos |
| Gustavo Rojas | Base de datos |

Sección 102-4A · Docente: Yaleni Gomez Peña · Cliente: Confederación Nacional de Taxis Colectivos (Conatacoch), cuyo representante hace de Product Owner.

## Por qué lo hicimos así

Lo más fácil habría sido hacer otra aplicación llena de botones y pantallas. Pero el conductor va manejando, a veces por calles con baches, y los mismos conductores nos dijeron que no le atinaban a los botones chicos. Así que su pantalla tiene pocos botones, enormes y siempre en el mismo lugar, y también funciona por voz.

Con eso nos quedó claro que la tecnología vale poco si no entiende a quien la va a usar. Casi todas las decisiones del proyecto salieron de esa idea.

## Cómo echarla a andar

Solo necesitas [Node.js](https://nodejs.org) 22.13 o superior (nosotros la probamos con la 24). No hay que instalar ninguna base de datos porque vienen incluidas.

```bash
npm install
```

```bash
npm start
```

Después abre <http://localhost:3000>. La primera vez, la aplicación se arma sola: crea sus bases de datos, sus claves secretas (`.env`) y los datos de demostración.

## Cuentas para probar

Todas tienen la misma contraseña: `Colectivo2026`

| Rol | Correo | Qué puede hacer |
| --- | --- | --- |
| Pasajero | `pasajero@demo.cl` | Ver el mapa en vivo, avisar que está esperando, pagar su pasaje y recargar saldo |
| Conductor | `conductor@demo.cl` | Iniciar y terminar su turno, informar asientos libres y ver lo que ha recaudado |
| Sindicato | `admin@demo.cl` | Validar conductores y vehículos, administrar trazados, ver opiniones y auditoría |

El sindicato entra con **verificación en dos pasos**, igual que en el banco. Para obtener el código de 6 dígitos, abre otra terminal y ejecuta:

```bash
npm run mfa
```

Ese mismo comando explica cómo agregar la cuenta a Google Authenticator o Microsoft Authenticator.

Para que el mapa no se vea vacío, hay 7 colectivos de demostración que circulan solos. Si quieres volver a los datos iniciales, detén el servidor y ejecuta `npm run seed`.

> Las personas, los RUT y las patentes son inventados. Los trazados usan calles reales de Puente Alto, pero solo como ejemplo.

## La demo en 5 minutos

Abre los tres roles en pestañas distintas del mismo navegador y sigue estos pasos:

1. **Pasajero** (pestaña 1): entra, elige el trazado T-01 y mira cómo se mueven los colectivos con su número de asientos.
2. **Conductor** (pestaña 2, mejor con la ventana angosta, como un teléfono): entra, toca **INICIAR TURNO** y después el botón **2**. Vuelve al pasajero: el colectivo `HJ·KL·45` ahora dice "2 asientos".
3. En el pasajero, toca **Avisar que espero aquí**. En el conductor aparece "Pasajeros esperando".
4. En el pasajero, toca **Pagar** en el colectivo `HJ·KL·45`. Al conductor le llega "Pago recibido" y sube su recaudación.
5. En el conductor, toca **LLENO**. El colectivo sale de la lista del pasajero y queda gris en el mapa.
6. En el pasajero, toca el mapa lejos de la ruta. La app te dice a cuántos metros estás del recorrido y hacia dónde caminar.
7. **Sindicato** (pestaña 3): entra con el código de `npm run mfa`, revisa el resumen y valida el vehículo `AB·12·34`, que está "Por validar".
8. En el conductor, toca **Fin de turno** y confirma. El colectivo desaparece del mapa de inmediato, porque su ubicación solo se comparte mientras trabaja.

## Qué resuelve

| Necesidad del negocio | Dónde se ve |
| --- | --- |
| N-01 Monitoreo GPS sobre trazado fijo | Mapa del pasajero, geocerca y control contra GPS falso |
| N-02 Gestión de cupos | Botones gigantes del conductor y cupos en vivo para el pasajero |
| N-03 Pago digital | Billetera, pago del pasaje y recaudación del conductor |
| Control del sindicato | Validación de RUT y patentes, estados y auditoría |

## Cómo sabemos que funciona

No quisimos quedarnos en "en mi computador funciona". Por eso cada parte importante tiene pruebas que cualquiera puede repetir:

```bash
npm test
```

```bash
npm run test:cobertura
```

```bash
npm run test:rendimiento
```

```bash
npm run test:e2e
```

| Comando | Qué prueba | Herramienta |
| --- | --- | --- |
| `npm test` | 55 pruebas unitarias y 121 de integración: API, bases de datos, seguridad y tiempo real | Node Test Runner y Supertest |
| `npm run test:cobertura` | Lo mismo, con el porcentaje de código cubierto | Cobertura nativa de Node |
| `npm run test:rendimiento` | 4 escenarios de carga, incluida una hora punta con 10.000 solicitudes simultáneas | autocannon |
| `npm run test:e2e` | 39 comprobaciones de un recorrido real en el navegador por los tres roles (necesita `npm start` corriendo) | Puppeteer con Chrome o Edge |

Los resultados de la última ejecución están en `docs/pruebas/` y las capturas de pantalla en `docs/capturas/`. Para probar la API a mano hay una colección lista en `docs/pruebas/api-manual.http`.

Las pruebas también nos sirvieron para encontrar errores reales antes de entregar. El que más nos enseñó fue este: al cerrar sesión, la sesión seguía siendo válida durante unos segundos. Lo arreglamos, y ahora hay una prueba que lo comprueba.

## Cómo está organizado

```
public/                 Interfaz web (HTML, CSS y JavaScript, sin compilación)
  css/tokens.css        Guía de estilo: colores, tipografía y espacios
  css/app.css           Componentes y pantallas adaptables
  js/vistas/            Pantallas de acceso, pasajero, conductor y sindicato
src/
  server.js             Arranque: HTTP, WebSocket y simulador
  app.js                Aplicación Express y cabeceras de seguridad
  routes/               API REST (autenticación, trazados, operación y sindicato)
  services/             Lógica del negocio (turnos, pagos, flota en vivo y sesiones)
  middleware/           Autenticación, permisos por rol, validación y límites
  lib/                  Reglas puras (RUT, patentes, cupos, geometría, cifrado y TOTP)
  db/schema.sql         Modelo relacional del prototipo (SQLite)
  db/schema.postgres.sql  El mismo modelo para producción (PostgreSQL)
  db/nosql.js           Colecciones documentales (NeDB en el prototipo, MongoDB en producción)
  db/seed.js            Datos de demostración
tests/                  Pruebas unitarias, de integración, de rendimiento y E2E
docs/                   Evidencia de las pruebas y capturas
entregables/            Informe final en Word y PDF
```

## Las bases de datos (y por qué son dos)

Una plataforma así maneja dos tipos de información muy distintos, y cada uno pedía una herramienta diferente:

- **La plata necesita rigor.** Usuarios, trazados, vehículos, turnos, billeteras y pagos van en una base **relacional**, con claves foráneas, restricciones `CHECK` y `UNIQUE`, y transacciones ACID. Por ejemplo, la base no deja que un saldo quede negativo, aunque la aplicación se equivoque.
- **El GPS es mucho volumen y vive poco.** La telemetría, la auditoría, las opiniones y los avisos de parada van en una base **documental**, como documentos JSON flexibles que se borran solos cuando vencen.

Para el prototipo usamos motores **embebidos** (SQLite y NeDB), para que funcione en cualquier computador sin instalar servidores. El diseño es el mismo que iría a producción sobre **PostgreSQL y MongoDB**: `src/db/schema.postgres.sql` tiene el esquema equivalente, y NeDB usa la misma forma de consulta que MongoDB.

## Seguridad

Como la aplicación maneja plata y la ubicación de personas, la seguridad no podía quedar como un parche al final. Esto es lo que está implementado:

- Contraseñas guardadas con bcrypt (costo 12) y una política mínima de 10 caracteres con letras y números.
- Sesiones con un token JWT de 15 minutos y un token de renovación que rota en cada uso, guardado en una cookie `httpOnly` y `SameSite=Strict`. Al cerrar sesión o suspender una cuenta, se revoca de inmediato.
- Verificación en dos pasos (TOTP) obligatoria para el sindicato.
- Permisos por rol en cada ruta, con el mínimo privilegio necesario. Todo intento rechazado queda en la auditoría.
- Validación de todas las entradas con esquemas (Zod) y consultas SQL parametrizadas.
- RUT cifrado con AES-256-GCM y un índice ciego para poder buscarlo. Al pasajero ni siquiera se le pide.
- Máximo 5 intentos fallidos de inicio de sesión por minuto, además de un límite general para la API.
- Cabeceras de seguridad y una política de contenido (CSP) que no permite scripts ni estilos en línea.
- Privacidad del conductor: su ubicación solo se registra durante el turno y se borra sola cuando se cumple el plazo.

## Lo que todavía falta

Preferimos decirlo claro antes que dar a entender que el prototipo está listo para la calle:

- **Pasarela de pago:** por ahora, la recarga de saldo simula la aprobación. En producción se conectaría a un proveedor certificado PCI-DSS, y la plataforma nunca vería datos de tarjetas.
- **GPS real:** en la demostración, un simulador mueve los colectivos por su trazado. El envío del GPS del teléfono ya está programado (`POST /api/turno/ubicacion`) y se activa con el botón "GPS simulado" del conductor.
- **HTTPS (TLS 1.3):** en local corre sobre HTTP. En producción, el cifrado en tránsito lo pondría el balanceador de carga.
- **Escaneo con OWASP ZAP:** estaba en el plan y quedó para el piloto. Por ahora la seguridad está cubierta por las pruebas automáticas.
- **Aplicación nativa:** el prototipo es una aplicación web que se adapta al teléfono. La idea es construir la versión para tiendas con React Native sobre esta misma API.
- **Comandos de voz:** dependen del navegador (Chrome y Edge los permiten). Donde no están, la aplicación funciona igual con los botones.
- **Escala nacional:** las pruebas de carga miden un solo servidor. Escalar en la nube es algo que hay que validar en el piloto.

## Lo que nos llevamos

Más allá del código, este proyecto nos dejó una forma de trabajar: escuchar primero a quien va a usar lo que hacemos, probar todo lo que afirmamos y decir con honestidad lo que todavía no está listo. El siguiente paso es un piloto de cuatro semanas en un recorrido de Puente Alto, con conductores y pasajeros reales.
