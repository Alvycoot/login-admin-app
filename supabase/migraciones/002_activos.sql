CREATE TABLE activos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  direccion TEXT NOT NULL,
  municipio TEXT,
  referencia_catastral TEXT UNIQUE,
  fondo_id BIGINT NOT NULL REFERENCES fondos(id),
  estado TEXT NOT NULL CHECK (estado IN ('COMPRA', 'EN OBRA', 'EN VENTA', 'VENDIDO')),
  fecha_compra DATE,
  fecha_venta DATE,
  creado_en TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE activos ENABLE ROW LEVEL SECURITY;
