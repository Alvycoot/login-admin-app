CREATE FUNCTION privado.apuntar_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id = NEW.id) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.registro_actividad (perfil_id, accion)
    VALUES (NEW.id, 'LOGIN');

    RETURN NEW;
END;
$$;

CREATE TRIGGER apuntar_login
AFTER UPDATE OF last_sign_in_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION privado.apuntar_login();