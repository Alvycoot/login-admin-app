CREATE FUNCTION privado.tiene_seccion(seccion_pedida text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT privado.es_admin() OR EXISTS (
    SELECT 1
    FROM public.permisos_seccion AS ps
    JOIN public.perfiles AS p ON p.id = ps.perfil_id
    WHERE ps.perfil_id = auth.uid()
        AND ps.seccion = seccion_pedida
        AND p.activo
  );
$$;

CREATE POLICY "Lectura de fondos por sección"
ON public.fondos
FOR SELECT
TO authenticated
USING ((select privado.tiene_seccion('FONDOS')));