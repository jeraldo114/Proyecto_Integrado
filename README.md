# Plataforma Digital Conatacoch

Aplicación web que muestra **en vivo dónde viene cada taxi colectivo, cuántos asientos trae y permite pagar sin efectivo**. Tiene tres vistas: pasajero, conductor y sindicato.

Proyecto Integrado · INACAP sede Puente Alto · sección 102-4A
Equipo: Matías Jeraldo, Francisco Soto, Eduardo Toro y Gustavo Rojas · Docente: Yaleni Gomez Peña

---

## Cómo ejecutarla

Necesitas [Node.js](https://nodejs.org) versión 22.13 o superior (probado con la 24). No hay que instalar ninguna base de datos: vienen incluidas.

```bash
npm install
```

```bash
npm start
```

Abre <http://localhost:3000>. En el primer arranque la aplicación crea sola sus bases de datos, sus claves secretas (`.env`) y los datos de demostración.

## Cuentas de demostración

Todas usan la misma contraseña: `Colectivo2026`

| Rol | Correo | Qué puede hacer |
| --- | --- | --- |
| Pasajero | `pasajero@demo.cl` | Ver el mapa en vivo, avisar que espera, pagar su pasaje, recargar saldo |
| Conductor | `conductor@demo.cl` | Iniciar y terminar turno, informar asientos libres, ver su recaudación |
| Sindicato | `admin@demo.cl` | Validar conductores y vehículos, administrar trazados, ver opiniones y auditoría |

El sindicato entra con **verificación en dos pasos**. Para obtener el código de 6 dígitos abre otra terminal y ejecuta:

```bash
npm run mfa
```

(El mismo comando muestra cómo agregar la cuenta a Google Authenticator o Microsoft Authenticator.)

Además circulan solos 7 colectivos de demostración para que el mapa tenga movimiento. Para volver a los datos iniciales, detén el servidor y ejecuta `npm run seed`.

> Las personas, RUT y patentes son ficticios. Los trazados usan calles reales de Puente Alto solo como ejemplo.

## Guion sugerido para la demostración (5 minutos)

Puedes abrir los tres roles a la vez en pestañas distintas del mismo navegador.

1. **Pasajero** (pestaña 1): entra, elige el trazado T-01 y muestra los colectivos moviéndose con su número de asientos.
2. **Conductor** (pestaña 2, idealmente con la ventana angosta como un teléfono): entra, toca **INICIAR TURNO** y luego el botón **2**. Vuelve a la pestaña del pasajero: el colectivo `HJ·KL·45` aparece con "2 asientos".
3. En el pasajero toca **Avisar que espero aquí**: en la pestaña del conductor aparece "Pasajeros esperando".
4. En el pasajero toca **Pagar** en el colectivo `HJ·KL·45`: al conductor le llega "Pago recibido" y sube su recaudación.
5. En el conductor toca **LLENO**: el colectivo desaparece de la lista del pasajero y queda gris en el mapa.
6. En el pasajero toca el mapa lejos de la ruta: la app avisa a cuántos metros está del recorrido y hacia dónde caminar.
7. **Sindicato** (pestaña 3): entra con el código de `npm run mfa`, muestra el resumen y valida el vehículo `AB·12·34` que está "Por validar".
8. En el conductor toca **Fin de turno**: el colectivo desaparece del mapa de inmediato (privacidad del conductor).

## Qué incluye

| Necesidad del negocio | Dónde se ve |
| --- | --- |
| N-01 Monitoreo GPS sobre trazado fijo | Mapa del pasajero, geocerca, control anti GPS falso |
| N-02 Gestión de cupos | Botones gigantes del conductor, cupos en vivo para el pasajero |
| N-03 Pago digital | Billetera, pago del pasaje, recaudación del conductor |
| Control del sindicato | Validación de RUT y patentes, estados, auditoría |

## Pruebas

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
| `npm test` | 55 pruebas unitarias + 121 de integración (API, bases de datos, seguridad, tiempo real) | Node Test Runner + Supertest |
| `npm run test:cobertura` | Lo mismo, con porcentaje de código cubierto | Cobertura nativa de Node |
| `npm run test:rendimiento` | 4 escenarios de carga, incluida la hora punta de 10.000 solicitudes simultáneas | autocannon |
| `npm run test:e2e` | Recorrido real en un navegador por los tres roles (necesita `npm start` corriendo) | Puppeteer + Chrome/Edge |

Los resultados de la última ejecución están en `docs/pruebas/` y las capturas de pantalla en `docs/capturas/`.
Para pruebas manuales de la API hay una colección lista en `docs/pruebas/api-manual.http`.

## Estructura del proyecto

```
public/                 Interfaz web (HTML, CSS y JavaScript sin compilación)
  css/tokens.css        Guía de estilo: colores, tipografía, espacios (única fuente)
  css/app.css           Componentes y pantallas adaptables
  js/vistas/            Pantallas de acceso, pasajero, conductor y sindicato
src/
  server.js             Arranque: HTTP + WebSocket + simulador
  app.js                Aplicación Express y cabeceras de seguridad
  routes/               API REST (auth, trazados, operación, sindicato)
  services/             Lógica de negocio (turnos, pagos, flota en vivo, sesiones)
  middleware/           Autenticación, autorización por rol, validación, límites
  lib/                  Reglas puras (RUT, patentes, cupos, geometría, cifrado, TOTP)
  db/schema.sql         Modelo relacional (prototipo, SQLite)
  db/schema.postgres.sql  El mismo modelo para producción (PostgreSQL)
  db/nosql.js           Colecciones documentales (prototipo NeDB, producción MongoDB)
  db/seed.js            Datos de demostración
tests/                  Pruebas unitarias, de integración, rendimiento y E2E
docs/                   Evidencia de pruebas y capturas
```

## Bases de datos

- **Estructurada (relacional):** usuarios, trazados, paraderos, vehículos, turnos, billeteras, pagos, movimientos y sesiones. Claves primarias y foráneas, restricciones `CHECK` y `UNIQUE`, transacciones ACID para los pagos.
- **No estructurada (documental):** telemetría GPS, auditoría, opiniones de usuarios y avisos de parada, como documentos JSON flexibles con vencimiento automático.

El prototipo usa motores **embebidos** (SQLite y NeDB) para que funcione en cualquier computador sin instalar servidores. El diseño es el mismo que se desplegará en producción sobre **PostgreSQL y MongoDB**: `src/db/schema.postgres.sql` contiene el esquema equivalente y NeDB usa la misma forma de consulta que MongoDB.

## Seguridad implementada

- Contraseñas con bcrypt (costo 12); política de 10+ caracteres con letras y números.
- Sesión con token JWT de 15 minutos + refresh token rotativo en cookie `httpOnly` y `SameSite=Strict`; revocación inmediata al cerrar sesión o suspender una cuenta.
- Verificación en dos pasos (TOTP) obligatoria para el sindicato.
- Autorización por rol en cada ruta (mínimo privilegio); todo intento denegado queda en la auditoría.
- Validación de todas las entradas con esquemas (Zod) y consultas SQL parametrizadas.
- RUT cifrado con AES-256-GCM e índice ciego para búsquedas; al pasajero no se le pide RUT.
- Límite de intentos de inicio de sesión (5 fallidos por minuto) y límite general de la API.
- Cabeceras de seguridad y política de contenido (CSP) sin scripts ni estilos en línea.
- Privacidad laboral: la ubicación solo se registra durante el turno y se borra sola al cumplir su plazo.

## Alcance del prototipo (lo que falta para producción)

- **Pasarela de pago:** la recarga de saldo simula la aprobación. En producción se integra un adquirente certificado PCI-DSS; la plataforma nunca ve datos de tarjetas.
- **GPS:** en la demostración un simulador mueve los vehículos por su trazado. El envío del GPS real del teléfono está implementado (`POST /api/turno/ubicacion`) y se activa desde el botón "GPS simulado" del conductor.
- **HTTPS/TLS 1.3:** en local corre sobre HTTP. En producción el cifrado en tránsito lo entrega el balanceador de carga.
- **Aplicación móvil nativa:** el prototipo es una aplicación web adaptable. La versión final para tiendas se construye con React Native sobre esta misma API.
- **Comandos de voz:** dependen del navegador (Chrome y Edge los permiten); donde no existen, la app funciona igual con los botones.
- **Escala nacional:** las pruebas de carga miden un solo servidor. El auto-escalado en la nube se valida en la etapa de piloto.
