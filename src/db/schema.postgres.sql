-- =====================================================================
-- Plataforma Digital Conatacoch · Esquema para PRODUCCIÓN (PostgreSQL 15+)
--
-- Es el MISMO modelo de schema.sql (prototipo en SQLite): mismas tablas, claves,
-- relaciones y reglas. Solo cambian los tipos propios de cada motor:
--   INTEGER AUTOINCREMENT -> BIGINT GENERATED ALWAYS AS IDENTITY
--   TEXT (fechas ISO)     -> TIMESTAMPTZ
--   INTEGER 0/1           -> BOOLEAN
--   lat/lng REAL          -> DOUBLE PRECISION (o geography(Point) con PostGIS)
-- Este archivo documenta la migración; el prototipo no lo ejecuta.
-- =====================================================================

CREATE TYPE rol_usuario     AS ENUM ('admin', 'conductor', 'pasajero');
CREATE TYPE estado_usuario  AS ENUM ('pendiente', 'activo', 'suspendido');
CREATE TYPE estado_vehiculo AS ENUM ('pendiente', 'validado', 'suspendido');
CREATE TYPE tipo_movimiento AS ENUM ('recarga', 'pago', 'cobro');

CREATE TABLE usuarios (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre          VARCHAR(80)  NOT NULL CHECK (char_length(nombre) >= 2),
  email           CITEXT       NOT NULL UNIQUE,            -- requiere: CREATE EXTENSION citext
  telefono        VARCHAR(13),
  rut_cifrado     TEXT,                                    -- AES-256-GCM (cifrado en la aplicación)
  rut_indice      CHAR(64)     UNIQUE,                     -- índice ciego HMAC-SHA256
  rol             rol_usuario  NOT NULL,
  estado          estado_usuario NOT NULL DEFAULT 'activo',
  hash_contrasena TEXT         NOT NULL,                   -- bcrypt costo 12
  mfa_secreto     TEXT,
  creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (rol = 'pasajero' OR rut_indice IS NOT NULL)
);
CREATE INDEX idx_usuarios_rol_estado ON usuarios (rol, estado);

CREATE TABLE trazados (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo    VARCHAR(6)  NOT NULL UNIQUE,
  nombre    VARCHAR(80) NOT NULL,
  comuna    VARCHAR(40) NOT NULL,
  color     CHAR(7)     NOT NULL DEFAULT '#E6A700' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  tarifa    INTEGER     NOT NULL CHECK (tarifa BETWEEN 100 AND 10000),
  largo_m   INTEGER     NOT NULL DEFAULT 0 CHECK (largo_m >= 0),
  activo    BOOLEAN     NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE puntos_trazado (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trazado_id BIGINT  NOT NULL REFERENCES trazados (id) ON DELETE CASCADE,
  orden      INTEGER NOT NULL CHECK (orden >= 0),
  lat        DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  UNIQUE (trazado_id, orden)
);

CREATE TABLE paraderos (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trazado_id BIGINT  NOT NULL REFERENCES trazados (id) ON DELETE CASCADE,
  orden      INTEGER NOT NULL CHECK (orden >= 0),
  nombre     VARCHAR(60) NOT NULL,
  lat        DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  progreso_m INTEGER NOT NULL DEFAULT 0 CHECK (progreso_m >= 0),
  UNIQUE (trazado_id, orden)
);

CREATE TABLE vehiculos (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patente          CHAR(6)     NOT NULL UNIQUE,
  marca            VARCHAR(30) NOT NULL,
  modelo           VARCHAR(30) NOT NULL,
  anio             SMALLINT    NOT NULL CHECK (anio BETWEEN 1990 AND 2100),
  capacidad_maxima SMALLINT    NOT NULL DEFAULT 4 CHECK (capacidad_maxima BETWEEN 1 AND 6),
  trazado_id       BIGINT      NOT NULL REFERENCES trazados (id) ON DELETE RESTRICT,
  conductor_id     BIGINT      UNIQUE REFERENCES usuarios (id) ON DELETE SET NULL,
  estado           estado_vehiculo NOT NULL DEFAULT 'pendiente',
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vehiculos_trazado ON vehiculos (trazado_id, estado);

CREATE TABLE turnos (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id       BIGINT   NOT NULL REFERENCES vehiculos (id) ON DELETE RESTRICT,
  conductor_id      BIGINT   NOT NULL REFERENCES usuarios (id)  ON DELETE RESTRICT,
  trazado_id        BIGINT   NOT NULL REFERENCES trazados (id)  ON DELETE RESTRICT,
  cupos_disponibles SMALLINT NOT NULL CHECK (cupos_disponibles >= 0),
  inicio            TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin               TIMESTAMPTZ,
  CHECK (fin IS NULL OR fin >= inicio)
);
CREATE UNIQUE INDEX uq_turno_abierto_vehiculo  ON turnos (vehiculo_id)  WHERE fin IS NULL;
CREATE UNIQUE INDEX uq_turno_abierto_conductor ON turnos (conductor_id) WHERE fin IS NULL;
CREATE INDEX idx_turnos_conductor ON turnos (conductor_id, inicio);

CREATE TABLE billeteras (
  usuario_id     BIGINT  PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  saldo          INTEGER NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pagos (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo       UUID    NOT NULL UNIQUE,                    -- llave de idempotencia
  pasajero_id  BIGINT  NOT NULL REFERENCES usuarios (id)  ON DELETE RESTRICT,
  conductor_id BIGINT  NOT NULL REFERENCES usuarios (id)  ON DELETE RESTRICT,
  vehiculo_id  BIGINT  NOT NULL REFERENCES vehiculos (id) ON DELETE RESTRICT,
  trazado_id   BIGINT  NOT NULL REFERENCES trazados (id)  ON DELETE RESTRICT,
  turno_id     BIGINT  NOT NULL REFERENCES turnos (id)    ON DELETE RESTRICT,
  monto        INTEGER NOT NULL CHECK (monto > 0),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (pasajero_id <> conductor_id)
);
CREATE INDEX idx_pagos_pasajero  ON pagos (pasajero_id, creado_en);
CREATE INDEX idx_pagos_conductor ON pagos (conductor_id, creado_en);

CREATE TABLE movimientos (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id       BIGINT  NOT NULL REFERENCES billeteras (usuario_id) ON DELETE CASCADE,
  tipo             tipo_movimiento NOT NULL,
  monto            INTEGER NOT NULL CHECK (monto <> 0),
  saldo_resultante INTEGER NOT NULL CHECK (saldo_resultante >= 0),
  pago_id          BIGINT  REFERENCES pagos (id) ON DELETE RESTRICT,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((tipo = 'recarga' AND pago_id IS NULL AND monto > 0)
      OR (tipo = 'pago'    AND pago_id IS NOT NULL AND monto < 0)
      OR (tipo = 'cobro'   AND pago_id IS NOT NULL AND monto > 0))
);
CREATE INDEX idx_movimientos_usuario ON movimientos (usuario_id, creado_en);

CREATE TABLE refresh_tokens (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id  BIGINT   NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  expira_en   TIMESTAMPTZ NOT NULL,
  rotado_en   TIMESTAMPTZ,
  revocado_en TIMESTAMPTZ,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_usuario ON refresh_tokens (usuario_id);

-- ---------------------------------------------------------------------
-- Base NO ESTRUCTURADA en producción (MongoDB). Equivalencia con NeDB:
--   db.telemetria_gps.createIndex({ ubicacion: "2dsphere" })            // búsqueda $geoNear
--   db.telemetria_gps.createIndex({ ts: 1 }, { expireAfterSeconds: 86400 })
--   db.alertas_parada.createIndex({ ts: 1 }, { expireAfterSeconds: 600 })
--   db.auditoria.createIndex({ ts: -1 })
--   db.retroalimentacion.createIndex({ ts: -1 })
-- ---------------------------------------------------------------------
