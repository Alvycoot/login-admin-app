CREATE TRIGGER apuntar_actividad_suministros
AFTER INSERT OR UPDATE
ON public.suministros
FOR EACH ROW
EXECUTE FUNCTION privado.apuntar_actividad('SUMINISTROS');

CREATE TRIGGER apuntar_actividad_fondos
AFTER INSERT OR UPDATE
ON public.fondos
FOR EACH ROW
EXECUTE FUNCTION privado.apuntar_actividad('FONDOS');