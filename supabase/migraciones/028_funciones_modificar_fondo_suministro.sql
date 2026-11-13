-- 1. modificar_activo: valida el estado antes del UPDATE.
--    Antes, el error 23514 enseñaba la fila entera sin dejar rastro en el registro.
CREATE OR REPLACE FUNCTION public.modificar_activo(
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

    IF nuevo_estado IS NOT NULL
       AND nuevo_estado NOT IN ('COMPRA', 'EN OBRA', 'EN VENTA', 'VENDIDO') THEN
        RAISE EXCEPTION 'Estado no válido';
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

-- 2. modificar_fondo
CREATE FUNCTION public.modificar_fondo(
    fondo_id bigint,
    nuevo_nombre text DEFAULT NULL,
    nuevo_cif text DEFAULT NULL,
    nuevo_iban text DEFAULT NULL
)
RETURNS SETOF public.fondos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    fila public.fondos;
BEGIN
    IF NOT privado.puede_escribir('FONDOS') THEN
        RAISE EXCEPTION 'No tienes permiso para modificar fondos';
    END IF;

    UPDATE public.fondos f
    SET nombre = COALESCE(nuevo_nombre, f.nombre),
        cif = COALESCE(nuevo_cif, f.cif),
        iban = COALESCE(nuevo_iban, f.iban)
    WHERE f.id = fondo_id
    RETURNING f.* INTO fila;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El fondo no existe';
    END IF;

    RETURN NEXT fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.modificar_fondo(bigint, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.modificar_fondo(bigint, text, text, text) TO authenticated;

-- 3. modificar_suministro
--    El tipo (LUZ/GAS) y el activo no se modifican: cambiarlos sería otro suministro.
--    La potencia solo vale para luz y el tipo de instalación solo para gas;
--    se comprueba antes del UPDATE para que los CHECK de la tabla no enseñen la fila.
CREATE FUNCTION public.modificar_suministro(
    suministro_id bigint,
    nuevo_cups text DEFAULT NULL,
    nueva_potencia_contratada_kw numeric DEFAULT NULL,
    nuevo_tipo_instalacion_gas text DEFAULT NULL
)
RETURNS SETOF public.suministros
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    tipo_actual text;
    fila public.suministros;
BEGIN
    IF NOT privado.puede_escribir('SUMINISTROS') THEN
        RAISE EXCEPTION 'No tienes permiso para modificar suministros';
    END IF;

    SELECT s.tipo INTO tipo_actual
    FROM public.suministros s
    WHERE s.id = suministro_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El suministro no existe';
    END IF;

    IF tipo_actual = 'GAS' AND nueva_potencia_contratada_kw IS NOT NULL THEN
        RAISE EXCEPTION 'La potencia contratada solo se aplica a suministros de luz';
    END IF;

    IF tipo_actual = 'LUZ' AND nuevo_tipo_instalacion_gas IS NOT NULL THEN
        RAISE EXCEPTION 'El tipo de instalación solo se aplica a suministros de gas';
    END IF;

    UPDATE public.suministros s
    SET cups = COALESCE(nuevo_cups, s.cups),
        potencia_contratada_kw = COALESCE(nueva_potencia_contratada_kw, s.potencia_contratada_kw),
        tipo_instalacion_gas = COALESCE(nuevo_tipo_instalacion_gas, s.tipo_instalacion_gas)
    WHERE s.id = suministro_id
    RETURNING s.* INTO fila;

    RETURN NEXT fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.modificar_suministro(bigint, text, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.modificar_suministro(bigint, text, numeric, text) TO authenticated;