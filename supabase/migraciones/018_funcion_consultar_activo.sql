CREATE FUNCTION public.consultar_activo(activo_id bigint)
RETURNS SETOF public.activos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    fila public.activos;
BEGIN
    IF NOT privado.tiene_seccion('ACTIVOS') THEN
        RAISE EXCEPTION 'No tienes permiso para consultar activos';
    END IF;

    SELECT * INTO fila FROM public.activos WHERE id = activo_id;
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

    RETURN NEXT fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consultar_activo(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultar_activo(bigint) TO authenticated;