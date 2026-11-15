-- modificar_activo puede vaciar campos opcionales a propósito, con la lista campos_a_vaciar.
-- Un parámetro que no se manda sigue significando "no cambiar". Añadir un parámetro cambia la firma
-- de la función: con CREATE OR REPLACE quedarían dos funciones con el mismo nombre, así que se borra
-- y se crea de nuevo, dentro de una transacción.
BEGIN;

DROP FUNCTION public.modificar_activo(bigint, text, text, text, bigint, text, date, date);

CREATE FUNCTION public.modificar_activo(
    activo_id bigint,
    nueva_direccion text DEFAULT NULL,
    nuevo_municipio text DEFAULT NULL,
    nueva_referencia_catastral text DEFAULT NULL,
    nuevo_fondo_id bigint DEFAULT NULL,
    nuevo_estado text DEFAULT NULL,
    nueva_fecha_compra date DEFAULT NULL,
    nueva_fecha_venta date DEFAULT NULL,
    campos_a_vaciar text[] DEFAULT '{}'
)
RETURNS SETOF public.activos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    fila public.activos;
    campo text;
BEGIN
    IF NOT privado.puede_escribir('ACTIVOS') THEN
        RAISE EXCEPTION 'No tienes permiso para modificar activos';
    END IF;

    IF nuevo_estado IS NOT NULL
       AND nuevo_estado NOT IN ('COMPRA', 'EN OBRA', 'EN VENTA', 'VENDIDO') THEN
        RAISE EXCEPTION 'Estado no válido';
    END IF;

    campos_a_vaciar := COALESCE(campos_a_vaciar, '{}');

    -- Solo los campos opcionales: dirección, estado y fondo son obligatorios en la tabla
    FOREACH campo IN ARRAY campos_a_vaciar LOOP
        IF campo NOT IN ('municipio', 'referencia_catastral', 'fecha_compra', 'fecha_venta') THEN
            RAISE EXCEPTION 'No se puede vaciar el campo %', campo;
        END IF;
    END LOOP;

    IF ('municipio' = ANY(campos_a_vaciar) AND nuevo_municipio IS NOT NULL)
       OR ('referencia_catastral' = ANY(campos_a_vaciar) AND nueva_referencia_catastral IS NOT NULL)
       OR ('fecha_compra' = ANY(campos_a_vaciar) AND nueva_fecha_compra IS NOT NULL)
       OR ('fecha_venta' = ANY(campos_a_vaciar) AND nueva_fecha_venta IS NOT NULL) THEN
        RAISE EXCEPTION 'No se puede cambiar y vaciar a la vez el mismo campo';
    END IF;

    UPDATE public.activos a
    SET direccion = COALESCE(nueva_direccion, a.direccion),
        municipio = CASE WHEN 'municipio' = ANY(campos_a_vaciar) THEN NULL
                         ELSE COALESCE(nuevo_municipio, a.municipio) END,
        referencia_catastral = CASE WHEN 'referencia_catastral' = ANY(campos_a_vaciar) THEN NULL
                                    ELSE COALESCE(nueva_referencia_catastral, a.referencia_catastral) END,
        fondo_id = COALESCE(nuevo_fondo_id, a.fondo_id),
        estado = COALESCE(nuevo_estado, a.estado),
        fecha_compra = CASE WHEN 'fecha_compra' = ANY(campos_a_vaciar) THEN NULL
                            ELSE COALESCE(nueva_fecha_compra, a.fecha_compra) END,
        fecha_venta = CASE WHEN 'fecha_venta' = ANY(campos_a_vaciar) THEN NULL
                           ELSE COALESCE(nueva_fecha_venta, a.fecha_venta) END
    WHERE a.id = activo_id
    RETURNING a.* INTO fila;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El activo no existe';
    END IF;

    RETURN NEXT fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.modificar_activo(bigint, text, text, text, bigint, text, date, date, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.modificar_activo(bigint, text, text, text, bigint, text, date, date, text[]) TO authenticated;

COMMIT;
