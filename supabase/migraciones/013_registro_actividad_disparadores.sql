CREATE FUNCTION privado.apuntar_actividad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, registro_id)
    VALUES (
        auth.uid(),
        CASE TG_OP WHEN 'INSERT' THEN 'CREACION' ELSE 'MODIFICACION' END,
        TG_ARGV[0],
        NEW.id
    );

    RETURN NEW;
END;
$$;

CREATE TRIGGER apuntar_actividad_activos
AFTER INSERT OR UPDATE
ON public.activos
FOR EACH ROW
EXECUTE FUNCTION privado.apuntar_actividad('ACTIVOS');