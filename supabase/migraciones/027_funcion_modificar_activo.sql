CREATE FUNCTION public.modificar_activo(
    activo_id bigint,
    nueva_direccion text DEFAULT NULL,
    nuevo_municipio text DEFAULT NULL,
    nueva_referencia_catastral text DEFAULT NULL,
    nuevo_fondo_id bigint DEFAULT NULL,
    nuevo_estado text DEFAULT NULL,
    nueva_fecha_compra date DEFAULT NULL,
    nueva_fecha_venta date DEFAULT NULL
)
RETURNS SETOF public.activos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    fila public.activos;
BEGIN
    IF NOT privado.puede_escribir('ACTIVOS') THEN
        RAISE EXCEPTION 'No tienes permiso para modificar activos';
    END IF;

    UPDATE public.activos a
    SET direccion = COALESCE(nueva_direccion, a.direccion),
        municipio = COALESCE(nuevo_municipio, a.municipio),
        referencia_catastral = COALESCE(nueva_referencia_catastral, a.referencia_catastral),
        fondo_id = COALESCE(nuevo_fondo_id, a.fondo_id),
        estado = COALESCE(nuevo_estado, a.estado),
        fecha_compra = COALESCE(nueva_fecha_compra, a.fecha_compra),
        fecha_venta = COALESCE(nueva_fecha_venta, a.fecha_venta)
    
    WHERE a.id = activo_id
    RETURNING a.* INTO fila;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El activo no existe';
    END IF;

    RETURN NEXT fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.modificar_activo(bigint, text, text, text, bigint, text, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.modificar_activo(bigint, text, text, text, bigint, text, date, date) TO authenticated;