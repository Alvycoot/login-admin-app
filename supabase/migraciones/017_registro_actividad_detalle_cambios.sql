CREATE OR REPLACE FUNCTION privado.apuntar_actividad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    cambios jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT jsonb_object_agg(
            despues.key,
            jsonb_build_object('antes', antes.value, 'despues', despues.value)
        )
        INTO cambios
        FROM jsonb_each(to_jsonb(NEW)) AS despues
        JOIN jsonb_each(to_jsonb(OLD)) AS antes ON antes.key = despues.key
        WHERE antes.value IS DISTINCT FROM despues.value;
        
        IF cambios IS NULL THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, registro_id, detalle)
    VALUES (
        auth.uid(),
        CASE TG_OP WHEN 'INSERT' THEN 'CREACION' ELSE 'MODIFICACION' END,
        TG_ARGV[0],
        NEW.id,
        cambios
    );

    RETURN NEW;
END;
$$;