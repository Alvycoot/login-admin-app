-- 1. crear_activo
--    Obligatorios primero (sin DEFAULT), opcionales después.
CREATE FUNCTION public.crear_activo(
    nuevo_codigo text,
    nueva_direccion text,
    nuevo_fondo_id bigint,
    nuevo_estado text,
    nuevo_municipio text DEFAULT NULL,
    nueva_referencia_catastral text DEFAULT NULL,
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
        RAISE EXCEPTION 'No tienes permiso para crear activos';
    END IF;

    IF trim(coalesce(nuevo_codigo, '')) = '' OR trim(coalesce(nueva_direccion, '')) = '' THEN
        RAISE EXCEPTION 'El código y la dirección son obligatorios';
    END IF;

    IF nuevo_estado IS NULL
       OR nuevo_estado NOT IN ('COMPRA', 'EN OBRA', 'EN VENTA', 'VENDIDO') THEN
        RAISE EXCEPTION 'Estado no válido';
    END IF;

    INSERT INTO public.activos
        (codigo, direccion, fondo_id, estado, municipio, referencia_catastral, fecha_compra, fecha_venta)
    VALUES
        (nuevo_codigo, nueva_direccion, nuevo_fondo_id, nuevo_estado, nuevo_municipio, nueva_referencia_catastral, nueva_fecha_compra, nueva_fecha_venta)
    RETURNING * INTO fila;

    RETURN NEXT fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_activo(text, text, bigint, text, text, text, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crear_activo(text, text, bigint, text, text, text, date, date) TO authenticated;

-- 2. crear_fondo
CREATE FUNCTION public.crear_fondo(
    nuevo_nombre text,
    nuevo_cif text,
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
        RAISE EXCEPTION 'No tienes permiso para crear fondos';
    END IF;

    IF trim(coalesce(nuevo_nombre, '')) = '' OR trim(coalesce(nuevo_cif, '')) = '' THEN
        RAISE EXCEPTION 'El nombre y el CIF son obligatorios';
    END IF;

    INSERT INTO public.fondos (nombre, cif, iban)
    VALUES (nuevo_nombre, nuevo_cif, nuevo_iban)
    RETURNING * INTO fila;

    RETURN NEXT fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_fondo(text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crear_fondo(text, text, text) TO authenticated;

-- 3. crear_suministro
--    Mismas reglas que la tabla (003): tipo LUZ o GAS, potencia solo en luz,
--    tipo de instalación solo en gas. Se comprueban antes del INSERT.
CREATE FUNCTION public.crear_suministro(
    nuevo_activo_id bigint,
    nuevo_tipo text,
    nuevo_cups text,
    nueva_potencia_contratada_kw numeric DEFAULT NULL,
    nuevo_tipo_instalacion_gas text DEFAULT NULL
)
RETURNS SETOF public.suministros
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    fila public.suministros;
BEGIN
    IF NOT privado.puede_escribir('SUMINISTROS') THEN
        RAISE EXCEPTION 'No tienes permiso para crear suministros';
    END IF;

    IF trim(coalesce(nuevo_cups, '')) = '' THEN
        RAISE EXCEPTION 'El CUPS es obligatorio';
    END IF;

    IF nuevo_tipo IS NULL OR nuevo_tipo NOT IN ('LUZ', 'GAS') THEN
        RAISE EXCEPTION 'Tipo no válido: tiene que ser LUZ o GAS';
    END IF;

    IF nuevo_tipo = 'GAS' AND nueva_potencia_contratada_kw IS NOT NULL THEN
        RAISE EXCEPTION 'La potencia contratada solo se aplica a suministros de luz';
    END IF;

    IF nuevo_tipo = 'LUZ' AND nuevo_tipo_instalacion_gas IS NOT NULL THEN
        RAISE EXCEPTION 'El tipo de instalación solo se aplica a suministros de gas';
    END IF;

    INSERT INTO public.suministros
        (activo_id, tipo, cups, potencia_contratada_kw, tipo_instalacion_gas)
    VALUES
        (nuevo_activo_id, nuevo_tipo, nuevo_cups, nueva_potencia_contratada_kw, nuevo_tipo_instalacion_gas)
    RETURNING * INTO fila;

    RETURN NEXT fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_suministro(bigint, text, text, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crear_suministro(bigint, text, text, numeric, text) TO authenticated;