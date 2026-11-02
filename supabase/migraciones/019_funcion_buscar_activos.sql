CREATE FUNCTION public.buscar_activos(texto text)
RETURNS SETOF public.activos
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
    SELECT * FROM public.activos
    WHERE codigo ILIKE '%' || texto || '%'
    OR direccion ILIKE '%' || texto || '%'
    OR municipio ILIKE '%' || texto || '%';

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