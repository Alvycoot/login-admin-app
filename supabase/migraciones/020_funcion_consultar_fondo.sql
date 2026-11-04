CREATE FUNCTION public.consultar_fondo(fondo_id bigint)
RETURNS SETOF public.fondos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    fila public.fondos;
BEGIN
    IF NOT privado.tiene_seccion('FONDOS') THEN
        RAISE EXCEPTION 'No tienes permiso para consultar fondos';
    END IF;

    SELECT * INTO fila FROM public.fondos WHERE id = fondo_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, registro_id)
    VALUES (
        auth.uid(),
        'CONSULTA',
        'FONDOS',
        fondo_id
    );

    RETURN NEXT fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consultar_fondo(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultar_fondo(bigint) TO authenticated;