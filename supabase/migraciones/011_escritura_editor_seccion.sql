CREATE FUNCTION privado.puede_escribir(seccion_pedida text)
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
        AND p.rol = 'EDITOR'
  );
$$;

CREATE POLICY "Creación de fondos por sección"
ON public.fondos
FOR INSERT
TO authenticated
WITH CHECK ((select privado.puede_escribir('FONDOS')));

CREATE POLICY "Modificación de fondos por sección"
ON public.fondos
FOR UPDATE
TO authenticated
USING ((select privado.puede_escribir('FONDOS')))
WITH CHECK ((select privado.puede_escribir('FONDOS')));

CREATE POLICY "Creación de activos por sección"
ON public.activos
FOR INSERT
TO authenticated
WITH CHECK ((select privado.puede_escribir('ACTIVOS')));

CREATE POLICY "Modificación de activos por sección"
ON public.activos
FOR UPDATE
TO authenticated
USING ((select privado.puede_escribir('ACTIVOS')))
WITH CHECK ((select privado.puede_escribir('ACTIVOS')));

CREATE POLICY "Creación de suministros por sección"
ON public.suministros
FOR INSERT
TO authenticated
WITH CHECK ((select privado.puede_escribir('SUMINISTROS')));

CREATE POLICY "Modificación de suministros por sección"
ON public.suministros
FOR UPDATE
TO authenticated
USING ((select privado.puede_escribir('SUMINISTROS')))
WITH CHECK ((select privado.puede_escribir('SUMINISTROS')));