CREATE TABLE suministros (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  activo_id BIGINT NOT NULL REFERENCES activos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('LUZ', 'GAS')),
  cups TEXT NOT NULL UNIQUE,
  potencia_contratada_kw NUMERIC,
  tipo_instalacion_gas TEXT,
  creado_en TIMESTAMPTZ DEFAULT now(),
  CHECK (tipo = 'LUZ' OR potencia_contratada_kw IS NULL),
  CHECK (tipo = 'GAS' OR tipo_instalacion_gas IS NULL),
  UNIQUE (activo_id, tipo)
);

ALTER TABLE suministros ENABLE ROW LEVEL SECURITY;
