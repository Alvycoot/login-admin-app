CREATE POLICY "Lectura de activos por sección"
ON public.activos
FOR SELECT
TO authenticated
USING ((select privado.tiene_seccion('ACTIVOS')));

CREATE POLICY "Lectura de suministros por sección"
ON public.suministros
FOR SELECT
TO authenticated
USING ((select privado.tiene_seccion('SUMINISTROS')));