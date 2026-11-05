CREATE FUNCTION public.buscar_suministros(texto text)
RETURNS TABLE (id bigint, tipo text, cups text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    resultados integer;
BEGIN
    IF NOT privado.tiene_seccion('SUMINISTROS') THEN
        RAISE EXCEPTION 'No tienes permiso para buscar suministros';
    END IF;

    IF texto IS NULL OR trim(texto) = '' THEN
        RAISE EXCEPTION 'Escribe un texto para buscar';
    END IF;

    RETURN QUERY
    SELECT s.id, s.tipo, s.cups
    FROM public.suministros s
    WHERE s.cups ILIKE '%' || texto || '%'
    ORDER BY s.cups;

    GET DIAGNOSTICS resultados = ROW_COUNT;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (
        auth.uid(),
        'BUSQUEDA',
        'SUMINISTROS',
        jsonb_build_object('texto', texto, 'resultados', resultados)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_suministros(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buscar_suministros(text) TO authenticated;