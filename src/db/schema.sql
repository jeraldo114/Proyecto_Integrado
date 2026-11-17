-- =====================================================================
-- Plataforma Digital Conatacoch · Base de datos ESTRUCTURADA (relacional)
-- Motor del prototipo: SQLite (incluido en Node.js). Producción: PostgreSQL
-- (ver schema.postgres.sql, mismo modelo). Fuente de verdad administrativa
-- y financiera: usuarios, flota, trazados, turnos y pagos (ACID).
-- =====================================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre          TEXT    NOT NULL CHECK (length(nombre) BETWEEN 2 AND 80),
  email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  telefono        TEXT,
  -- RUT: dato personal. Se guarda cifrado (AES-256-GCM) y con un índice ciego
  -- (HMAC-SHA256) que permite buscar y exigir unicidad sin exponerlo.
  rut_cifrado     TEXT,
  rut_indice      TEXT    UNIQUE,
  rol             TEXT    NOT NULL CHECK (rol IN ('admin', 'conductor', 'pasajero')),
  estado          TEXT    NOT NULL DEFAULT 'activo' CHECK (estado IN ('pendiente', 'activo', 'suspendido')),
  hash_contrasena TEXT    NOT NULL,
  mfa_secreto     TEXT,   -- secreto TOTP cifrado; obligatorio para administradores
  creado_en       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actualizado_en  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Conductores y administradores deben estar identificados con RUT.
  CHECK (rol = 'pasajero' OR rut_indice IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_usuarios_rol_estado ON usuarios (rol, estado);

CREATE TABLE IF NOT EXISTS trazados (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo     TEXT    NOT NULL UNIQUE,
  nombre     TEXT    NOT NULL,
  comuna     TEXT    NOT NULL,
  color      TEXT    NOT NULL DEFAULT '#E6A700' CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  tarifa     INTEGER NOT NULL CHECK (tarifa BETWEEN 100 AND 10000),  -- pesos chilenos, sin decimales
  largo_m    INTEGER NOT NULL DEFAULT 0 CHECK (largo_m >= 0),
  activo     INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Polilínea oficial del trazado (recorrido fijo autorizado).
CREATE TABLE IF NOT EXISTS puntos_trazado (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trazado_id INTEGER NOT NULL REFERENCES trazados (id) ON DELETE CASCADE,
  orden      INTEGER NOT NULL CHECK (orden >= 0),
  lat        REAL    NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        REAL    NOT NULL CHECK (lng BETWEEN -180 AND 180),
  UNIQUE (trazado_id, orden)
);

CREATE TABLE IF NOT EXISTS paraderos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trazado_id INTEGER NOT NULL REFERENCES trazados (id) ON DELETE CASCADE,
  orden      INTEGER NOT NULL CHECK (orden >= 0),
  nombre     TEXT    NOT NULL,
  lat        REAL    NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        REAL    NOT NULL CHECK (lng BETWEEN -180 AND 180),
  progreso_m INTEGER NOT NULL DEFAULT 0 CHECK (progreso_m >= 0),  -- metros desde el inicio del trazado
  UNIQUE (trazado_id, orden)
);

CREATE TABLE IF NOT EXISTS vehiculos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  patente          TEXT    NOT NULL UNIQUE CHECK (length(patente) = 6),
  marca            TEXT    NOT NULL,
  modelo           TEXT    NOT NULL,
  anio             INTEGER NOT NULL CHECK (anio BETWEEN 1990 AND 2100),
  capacidad_maxima INTEGER NOT NULL DEFAULT 4 CHECK (capacidad_maxima BETWEEN 1 AND 6),
  trazado_id       INTEGER NOT NULL REFERENCES trazados (id) ON DELETE RESTRICT,
  -- Un conductor conduce a lo más un vehículo asignado (UNIQUE admite varios NULL).
  conductor_id     INTEGER UNIQUE REFERENCES usuarios (id) ON DELETE SET NULL,
  estado           TEXT    NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'validado', 'suspendido')),
  creado_en        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_vehiculos_trazado ON vehiculos (trazado_id, estado);

-- Turno de trabajo: delimita cuándo el conductor transmite su ubicación.
CREATE TABLE IF NOT EXISTS turnos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  vehiculo_id       INTEGER NOT NULL REFERENCES vehiculos (id) ON DELETE RESTRICT,
  conductor_id      INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE RESTRICT,
  trazado_id        INTEGER NOT NULL REFERENCES trazados (id) ON DELETE RESTRICT,
  cupos_disponibles INTEGER NOT NULL CHECK (cupos_disponibles >= 0),
  inicio            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  fin               TEXT,
  CHECK (fin IS NULL OR fin >= inicio)
);
-- Regla de negocio: un vehículo y un conductor solo pueden tener UN turno abierto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_turno_abierto_vehiculo  ON turnos (vehiculo_id)  WHERE fin IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_turno_abierto_conductor ON turnos (conductor_id) WHERE fin IS NULL;
CREATE INDEX IF NOT EXISTS idx_turnos_conductor ON turnos (conductor_id, inicio);

CREATE TABLE IF NOT EXISTS billeteras (
  usuario_id     INTEGER PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  saldo          INTEGER NOT NULL DEFAULT 0 CHECK (saldo >= 0),  -- nunca puede quedar negativo
  actualizado_en TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS pagos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Llave de idempotencia enviada por la app: un reintento no cobra dos veces.
  codigo       TEXT    NOT NULL UNIQUE,
  pasajero_id  INTEGER NOT NULL REFERENCES usuarios (id)  ON DELETE RESTRICT,
  conductor_id INTEGER NOT NULL REFERENCES usuarios (id)  ON DELETE RESTRICT,
  vehiculo_id  INTEGER NOT NULL REFERENCES vehiculos (id) ON DELETE RESTRICT,
  trazado_id   INTEGER NOT NULL REFERENCES trazados (id)  ON DELETE RESTRICT,
  turno_id     INTEGER NOT NULL REFERENCES turnos (id)    ON DELETE RESTRICT,
  monto        INTEGER NOT NULL CHECK (monto > 0),
  creado_en    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (pasajero_id <> conductor_id)
);
CREATE INDEX IF NOT EXISTS idx_pagos_pasajero  ON pagos (pasajero_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_pagos_conductor ON pagos (conductor_id, creado_en);

-- Libro de movimientos: cada cambio de saldo queda registrado (auditable).
CREATE TABLE IF NOT EXISTS movimientos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id       INTEGER NOT NULL REFERENCES billeteras (usuario_id) ON DELETE CASCADE,
  tipo             TEXT    NOT NULL CHECK (tipo IN ('recarga', 'pago', 'cobro')),
  monto            INTEGER NOT NULL CHECK (monto <> 0),  -- negativo = sale dinero
  saldo_resultante INTEGER NOT NULL CHECK (saldo_resultante >= 0),
  pago_id          INTEGER REFERENCES pagos (id) ON DELETE RESTRICT,
  creado_en        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((tipo = 'recarga' AND pago_id IS NULL AND monto > 0)
      OR (tipo = 'pago'    AND pago_id IS NOT NULL AND monto < 0)
      OR (tipo = 'cobro'   AND pago_id IS NOT NULL AND monto > 0))
);
CREATE INDEX IF NOT EXISTS idx_movimientos_usuario ON movimientos (usuario_id, creado_en);

-- Sesiones: refresh tokens guardados como hash, con rotación y revocación.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  expira_en   TEXT    NOT NULL,
  rotado_en   TEXT,   -- ya se canjeó por uno nuevo (uso normal)
  revocado_en TEXT,   -- se anuló: cierre de sesión, suspensión o sospecha de robo
  creado_en   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_usuario ON refresh_tokens (usuario_id);
