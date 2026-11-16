-- Preparación del panel del admin.
-- 1. Una sección nueva, ACTIVIDAD, para apuntar cuándo el admin consulta el propio registro.
-- 2. Los índices por usuario y por fecha que el diseño en papel (24/09) ya preveía y nunca se crearon.
BEGIN;

ALTER TABLE public.registro_actividad
    DROP CONSTRAINT registro_actividad_seccion_check;

ALTER TABLE public.registro_actividad
    ADD CONSTRAINT registro_actividad_seccion_check
    CHECK (seccion IN ('FONDOS', 'ACTIVOS', 'SUMINISTROS', 'ACTIVIDAD'));

-- La actividad de un usuario, de la más reciente a la más antigua (filtro por usuario)
CREATE INDEX registro_actividad_perfil_fecha_idx
    ON public.registro_actividad (perfil_id, ocurrido_en DESC);

-- Toda la actividad por fecha (la línea de tiempo y el filtro por fechas)
CREATE INDEX registro_actividad_fecha_idx
    ON public.registro_actividad (ocurrido_en DESC);

COMMIT;
