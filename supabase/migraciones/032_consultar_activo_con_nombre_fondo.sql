BEGIN;

DROP FUNCTION public.consultar_activo(bigint);

CREATE FUNCTION public.consultar_activo(activo_id bigint)
RETURNS TABLE (
    id bigint,
    codigo text,
    direccion text,
    municipio text,
    referencia_catastral text,
    fondo_id bigint,
    fondo_nombre text,
    estado text,
    fecha_compra date,
    fecha_venta date,
    creado_en timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT privado.tiene_seccion('ACTIVOS') THEN
        RAISE EXCEPTION 'No tienes permiso para consultar activos';
    END IF;

    RETURN QUERY
    SELECT a.id, a.codigo, a.direccion, a.municipio, a.referencia_catastral,
           a.fondo_id, f.nombre, a.estado, a.fecha_compra, a.fecha_venta, a.creado_en
    FROM public.activos a
    JOIN public.fondos f ON f.id = a.fondo_id
    WHERE a.id = activo_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, registro_id)
    VALUES (
        auth.uid(),
        'CONSULTA',
        'ACTIVOS',
        activo_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consultar_activo(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultar_activo(bigint) TO authenticated;

COMMIT;
