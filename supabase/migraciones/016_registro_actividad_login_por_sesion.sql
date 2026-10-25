DROP TRIGGER apuntar_login ON auth.users;

CREATE FUNCTION privado.apuntar_inicio_sesion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id = NEW.user_id) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.registro_actividad (perfil_id, accion)
    VALUES (NEW.user_id, 'LOGIN');

    RETURN NEW;
END;
$$;

CREATE TRIGGER apuntar_inicio_sesion
AFTER INSERT ON auth.sessions
FOR EACH ROW
EXECUTE FUNCTION privado.apuntar_inicio_sesion();

DROP FUNCTION privado.apuntar_login();