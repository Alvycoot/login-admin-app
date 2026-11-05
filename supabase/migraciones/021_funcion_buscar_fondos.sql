CREATE FUNCTION public.buscar_fondos(texto text)
RETURNS SETOF public.fondos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    resultados integer;
BEGIN
    IF NOT privado.tiene_seccion('FONDOS') THEN
        RAISE EXCEPTION 'No tienes permiso para buscar fondos';
    END IF;

    IF texto IS NULL OR trim(texto) = '' THEN
        RAISE EXCEPTION 'Escribe un texto para buscar';
    END IF;

    RETURN QUERY
        SELECT * FROM public.fondos
    WHERE nombre ILIKE '%' || texto || '%'
    OR cif ILIKE '%' || texto || '%'
    ORDER BY nombre;

    GET DIAGNOSTICS resultados = ROW_COUNT;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (
        auth.uid(),
        'BUSQUEDA',
        'FONDOS',
        jsonb_build_object('texto', texto, 'resultados', resultados)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_fondos(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buscar_fondos(text) TO authenticated;