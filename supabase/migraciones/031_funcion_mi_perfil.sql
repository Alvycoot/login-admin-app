CREATE FUNCTION public.mi_perfil()
RETURNS TABLE (nombre text, rol text, secciones_lectura text[], secciones_escritura text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.nombre,
    p.rol,
    ARRAY(
      SELECT s.seccion
      FROM unnest(ARRAY['ACTIVOS', 'FONDOS', 'SUMINISTROS']) AS s(seccion)
      WHERE privado.tiene_seccion(s.seccion)
    ),
    ARRAY(
      SELECT s.seccion
      FROM unnest(ARRAY['ACTIVOS', 'FONDOS', 'SUMINISTROS']) AS s(seccion)
      WHERE privado.puede_escribir(s.seccion)
    )
  FROM public.perfiles p
  WHERE p.id = auth.uid()
    AND p.activo;
$$;

REVOKE EXECUTE ON FUNCTION public.mi_perfil() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mi_perfil() TO authenticated;
