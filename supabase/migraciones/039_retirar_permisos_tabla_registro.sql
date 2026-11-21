-- Segundo cierre del registro de actividad, además de RLS sin políticas (038).
-- Supabase concede por defecto permisos de tabla a anon y authenticated; hasta ahora, la única barrera era RLS.
-- Sin estos permisos, aunque alguien desactivara RLS o creara una política por error, el registro seguiría cerrado.
-- Los disparadores (apuntar_actividad, apuntar_inicio_sesion) y las ventanillas (usuarios_admin, actividad_admin)
-- son SECURITY DEFINER: corren como su propietario, no como el usuario, así que siguen escribiendo y leyendo.
-- service_role (el panel de Supabase y el servidor) no se toca.
REVOKE ALL ON TABLE public.registro_actividad FROM anon, authenticated;
