-- Línea de tiempo del registro de actividad para el panel del admin, con filtros y páginas.
-- Cada llamada queda apuntada como CONSULTA / ACTIVIDAD, con los filtros y la página en detalle.
-- Páginas por cursor: antes_de es el id de la última fila recibida (no "saltar N filas"),
-- porque cada llamada añade una fila al registro y desplazaría las páginas.
-- desde y hasta los calcula la página en la hora local; hasta no se incluye (la medianoche del día siguiente).
CREATE FUNCTION public.actividad_admin(
    filtro_usuario uuid DEFAULT NULL,
    filtro_accion text DEFAULT NULL,
    desde timestamptz DEFAULT NULL,
    hasta timestamptz DEFAULT NULL,
    ocultar_mis_consultas boolean DEFAULT true,
    antes_de bigint DEFAULT NULL,
    tamano integer DEFAULT 50
)
RETURNS TABLE (
    id bigint,
    ocurrido_en timestamptz,
    perfil_id uuid,
    nombre text,
    accion text,
    seccion text,
    registro_id bigint,
    registro_etiqueta text,
    detalle jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    yo uuid := auth.uid();
    resultados integer;
BEGIN
    IF NOT privado.es_admin() THEN
        RAISE EXCEPTION 'Solo el administrador puede ver la actividad';
    END IF;

    -- Las mismas acciones que admite el CHECK de la tabla (006)
    IF filtro_accion IS NOT NULL AND filtro_accion NOT IN
        ('LOGIN', 'LOGOUT', 'BUSQUEDA', 'CONSULTA', 'CREACION', 'MODIFICACION', 'BORRADO', 'ACCESO_DENEGADO') THEN
        RAISE EXCEPTION 'Acción no válida: %', filtro_accion;
    END IF;

    IF desde IS NOT NULL AND hasta IS NOT NULL AND desde >= hasta THEN
        RAISE EXCEPTION 'La fecha de inicio tiene que ser anterior a la de fin';
    END IF;

    IF tamano IS NULL OR tamano < 1 OR tamano > 200 THEN
        RAISE EXCEPTION 'El tamaño de página tiene que estar entre 1 y 200';
    END IF;

    RETURN QUERY
    SELECT
        r.id,
        r.ocurrido_en,
        r.perfil_id,
        p.nombre,
        r.accion,
        r.seccion,
        r.registro_id,
        -- registro_id solo se entiende junto a su sección: se traduce a algo legible
        CASE r.seccion
            WHEN 'ACTIVOS' THEN (SELECT a.codigo FROM public.activos a WHERE a.id = r.registro_id)
            WHEN 'FONDOS' THEN (SELECT f.nombre FROM public.fondos f WHERE f.id = r.registro_id)
            WHEN 'SUMINISTROS' THEN (
                SELECT s.tipo || ' · ' || a.codigo
                FROM public.suministros s
                JOIN public.activos a ON a.id = s.activo_id
                WHERE s.id = r.registro_id
            )
        END,
        r.detalle
    FROM public.registro_actividad r
    JOIN public.perfiles p ON p.id = r.perfil_id
    WHERE (filtro_usuario IS NULL OR r.perfil_id = filtro_usuario)
      AND (filtro_accion IS NULL OR r.accion = filtro_accion)
      AND (desde IS NULL OR r.ocurrido_en >= desde)
      AND (hasta IS NULL OR r.ocurrido_en < hasta)
      AND (antes_de IS NULL OR r.id < antes_de)
      -- IS NOT DISTINCT FROM y no "=": un LOGIN no tiene sección (NULL), y con "=" el NOT daría NULL y la fila desaparecería
      AND NOT (coalesce(ocultar_mis_consultas, true)
               AND r.perfil_id = yo
               AND r.seccion IS NOT DISTINCT FROM 'ACTIVIDAD')
    ORDER BY r.id DESC
    LIMIT tamano;

    GET DIAGNOSTICS resultados = ROW_COUNT;

    -- Se apunta después de leer, para que esta consulta no salga en su propia respuesta
    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (
        yo,
        'CONSULTA',
        'ACTIVIDAD',
        jsonb_strip_nulls(jsonb_build_object(
            'vista', 'actividad',
            'usuario', filtro_usuario,
            'accion', filtro_accion,
            'desde', desde,
            'hasta', hasta,
            'ocultar_mis_consultas', coalesce(ocultar_mis_consultas, true),
            'antes_de', antes_de,
            'tamano', tamano,
            'resultados', resultados
        ))
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.actividad_admin(uuid, text, timestamptz, timestamptz, boolean, bigint, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.actividad_admin(uuid, text, timestamptz, timestamptz, boolean, bigint, integer) TO authenticated;
