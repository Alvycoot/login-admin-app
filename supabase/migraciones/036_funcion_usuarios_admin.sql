-- Lista de usuarios para el panel del admin. Cada consulta queda apuntada como CONSULTA / ACTIVIDAD:
-- la lista incluye datos de actividad de cada persona (último inicio de sesión, última actividad, acciones).
CREATE FUNCTION public.usuarios_admin()
RETURNS TABLE (
    id uuid,
    nombre text,
    email text,
    rol text,
    activo boolean,
    secciones_lectura text[],
    secciones_escritura text[],
    ultimo_inicio_sesion timestamptz,
    ultima_actividad timestamptz,
    acciones bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT privado.es_admin() THEN
        RAISE EXCEPTION 'Solo el administrador puede ver los usuarios';
    END IF;

    -- Las secciones repiten las reglas de privado.tiene_seccion y privado.puede_escribir (009 y 011),
    -- que solo sirven para el usuario que llama (auth.uid()). Si cambian esas reglas, hay que cambiar también estas.
    -- Aquí se enseñan las secciones asignadas aunque el usuario esté desactivado: el panel muestra su configuración.
    RETURN QUERY
    SELECT
        p.id,
        p.nombre,
        u.email::text,
        p.rol,
        p.activo,
        CASE WHEN p.rol = 'ADMIN' THEN ARRAY['ACTIVOS', 'FONDOS', 'SUMINISTROS']
             ELSE ARRAY(SELECT ps.seccion FROM public.permisos_seccion ps WHERE ps.perfil_id = p.id ORDER BY ps.seccion)
        END,
        CASE WHEN p.rol = 'ADMIN' THEN ARRAY['ACTIVOS', 'FONDOS', 'SUMINISTROS']
             WHEN p.rol = 'EDITOR' THEN ARRAY(SELECT ps.seccion FROM public.permisos_seccion ps WHERE ps.perfil_id = p.id ORDER BY ps.seccion)
             ELSE ARRAY[]::text[]
        END,
        (SELECT max(r.ocurrido_en) FROM public.registro_actividad r WHERE r.perfil_id = p.id AND r.accion = 'LOGIN'),
        (SELECT max(r.ocurrido_en) FROM public.registro_actividad r WHERE r.perfil_id = p.id),
        (SELECT count(*) FROM public.registro_actividad r WHERE r.perfil_id = p.id)
    FROM public.perfiles p
    JOIN auth.users u ON u.id = p.id
    ORDER BY p.nombre;

    -- Se apunta después de leer, para que esta misma consulta no cuente en la actividad del admin que se acaba de calcular
    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (auth.uid(), 'CONSULTA', 'ACTIVIDAD', jsonb_build_object('vista', 'usuarios'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.usuarios_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.usuarios_admin() TO authenticated;
