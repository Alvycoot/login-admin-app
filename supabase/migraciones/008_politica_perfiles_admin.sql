CREATE SCHEMA IF NOT EXISTS privado;

GRANT USAGE ON SCHEMA privado TO authenticated;

CREATE FUNCTION privado.es_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.perfiles
    WHERE id = auth.uid() AND rol = 'ADMIN' AND activo
  );
$$;

CREATE POLICY "El admin lee todos los perfiles"
ON public.perfiles
FOR SELECT
TO authenticated
USING (privado.es_admin());