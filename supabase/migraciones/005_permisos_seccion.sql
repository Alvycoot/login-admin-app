CREATE TABLE permisos_seccion (
  perfil_id UUID NOT NULL REFERENCES perfiles(id),
  seccion TEXT NOT NULL CHECK (seccion IN ('FONDOS', 'ACTIVOS', 'SUMINISTROS')),
  asignado_en TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (perfil_id, seccion)
);

ALTER TABLE permisos_seccion ENABLE ROW LEVEL SECURITY;
