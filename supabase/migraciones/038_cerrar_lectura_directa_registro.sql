-- Cierra la lectura directa del registro de actividad, como la 026 con las tablas.
-- Desde aquí, el admin solo lee el registro con actividad_admin y usuarios_admin, que dejan rastro.
-- Los disparadores y las ventanillas son SECURITY DEFINER y siguen escribiendo y leyendo sin esta política.
DROP POLICY "Solo el admin lee el registro de actividad" ON public.registro_actividad;
