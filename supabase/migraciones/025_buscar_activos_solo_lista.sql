DROP FUNCTION public.buscar_activos(text);

CREATE FUNCTION public.buscar_activos(texto text)
RETURNS TABLE (id bigint, codigo text, direccion text, municipio text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    resultados integer;
BEGIN
    IF NOT privado.tiene_seccion('ACTIVOS') THEN
        RAISE EXCEPTION 'No tienes permiso para buscar activos';
    END IF;

    IF texto IS NULL OR trim(texto) = '' THEN
        RAISE EXCEPTION 'Escribe un texto para buscar';
    END IF;

    RETURN QUERY
    SELECT a.id, a.codigo, a.direccion, a.municipio
    FROM public.activos a
    WHERE a.codigo ILIKE '%' || texto || '%'
    OR a.direccion ILIKE '%' || texto || '%'
    OR a.municipio ILIKE '%' || texto || '%'
    ORDER BY a.codigo;

    GET DIAGNOSTICS resultados = ROW_COUNT;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (
        auth.uid(),
        'BUSQUEDA',
        'ACTIVOS',
        jsonb_build_object('texto', texto, 'resultados', resultados)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_activos(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buscar_activos(text) TO authenticated;