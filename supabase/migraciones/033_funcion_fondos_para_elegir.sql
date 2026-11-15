-- Lista auxiliar para el desplegable del formulario de activos. No se apunta en el registro, a propósito:
-- la modificación o creación del activo, con el fondo elegido, ya la apunta el disparador.
CREATE FUNCTION public.fondos_para_elegir()
RETURNS TABLE (id bigint, nombre text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT privado.puede_escribir('ACTIVOS') THEN
        RAISE EXCEPTION 'No tienes permiso para elegir fondos';
    END IF;

    RETURN QUERY
    SELECT f.id, f.nombre
    FROM public.fondos f
    ORDER BY f.nombre;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fondos_para_elegir() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fondos_para_elegir() TO authenticated;
