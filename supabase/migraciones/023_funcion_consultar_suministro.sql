CREATE FUNCTION public.consultar_suministro(suministro_id bigint)
RETURNS SETOF public.suministros
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    fila public.suministros;
BEGIN
    IF NOT privado.tiene_seccion('SUMINISTROS') THEN
        RAISE EXCEPTION 'No tienes permiso para consultar suministros';
    END IF;

    SELECT * INTO fila FROM public.suministros WHERE id = suministro_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, registro_id)
    VALUES (
        auth.uid(),
        'CONSULTA',
        'SUMINISTROS',
        suministro_id
    );

    RETURN NEXT fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consultar_suministro(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultar_suministro(bigint) TO authenticated;