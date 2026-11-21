-- Segundo cierre de las tablas de negocio y de permisos, como la 039 hizo con el registro de actividad.
-- Supabase concede por defecto permisos de tabla a anon y authenticated; hasta ahora, la única barrera era RLS
-- (sin políticas de lectura ni escritura en fondos, activos y suministros desde la 026 y la 030).
-- La página no lee ninguna tabla directamente: todo pasa por las ventanillas, que son SECURITY DEFINER
-- y corren como su propietario, igual que los disparadores y privado.es_admin / tiene_seccion / puede_escribir.
-- Las políticas de lectura de perfiles (007 y 008) quedan sin uso: sin permiso de tabla, nunca llegan a evaluarse.
-- service_role (el panel de Supabase y el servidor) no se toca.
BEGIN;

REVOKE ALL ON TABLE public.fondos           FROM anon, authenticated;
REVOKE ALL ON TABLE public.activos          FROM anon, authenticated;
REVOKE ALL ON TABLE public.suministros      FROM anon, authenticated;
REVOKE ALL ON TABLE public.perfiles         FROM anon, authenticated;
REVOKE ALL ON TABLE public.permisos_seccion FROM anon, authenticated;

COMMIT;
