CREATE POLICY "Solo el admin lee el registro de actividad"
ON public.registro_actividad
FOR SELECT
TO authenticated
USING ((select privado.es_admin()));