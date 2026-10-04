# Guion de presentación — login-admin-app

Documento vivo. Cada vez que se cierra una pieza nueva del proyecto, se añade su sección aquí, explicada para poder defenderla en una presentación técnica (pensada originalmente para Rubén).

## 1. Introducción

**Qué es:** una aplicación web con login, base de datos y panel de administrador, sobre una temática ficticia de activos inmobiliarios (viviendas, fondos, suministros). Datos inventados, nada real de ningún empleador.

**Para qué:**
- Presentación técnica de entrevista: cada línea de código tiene que poder explicarse, no solo haberse escrito.
- Aprendizaje de fundamentos (bases de datos relacionales, SQL, HTML, CSS, JavaScript, autenticación) partiendo de poca experiencia previa en este terreno.

**Qué se puede hacer en la versión mínima:**
- Un usuario inicia sesión, busca y consulta datos, rellena formularios y crea registros nuevos, dentro de las secciones que tiene asignadas.
- Un administrador ve la actividad de cada usuario: quién hizo qué, cuándo, y sobre qué registro.
- Todo lo que hace cada usuario queda registrado de forma que no se puede falsear ni borrar, ni siquiera por el propio usuario.

**Stack técnico:**
- **Base de datos y autenticación:** [Supabase](https://supabase.com) — PostgreSQL gestionado, con login integrado y Row Level Security.
- **Frontend:** HTML, CSS y JavaScript "vanilla" (sin frameworks), para entender los fundamentos antes de usar herramientas que los abstraen.
- **Control de versiones:** Git y GitHub, con commits por pieza terminada, no por sesión de trabajo.

## 2. Diseño de la base de datos

Base de datos relacional (PostgreSQL vía Supabase): los datos viven en tablas, relacionadas entre sí mediante claves foráneas en vez de repetirse. Este diseño se hizo en papel, en detalle, antes de escribir una sola línea de SQL — queda documentado en `03 - Personal/Proyectos/Proyecto web con login/Proyecto web con login - diseño de la base de datos.md` de la bóveda de notas.

### 2.1. `fondos`

La entidad propietaria de los activos.

```sql
CREATE TABLE fondos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  cif TEXT NOT NULL UNIQUE,
  iban TEXT,
  creado_en TIMESTAMPTZ DEFAULT now()
);
```

- `nombre` y `cif` son obligatorios (`NOT NULL`) y no se pueden repetir (`UNIQUE`): un CIF identifica una entidad legal real, y un nombre repetido generaría confusión entre fondos.
- `iban` es opcional: no todos los fondos tienen por qué tener uno asignado en todo momento.
- `creado_en` lo rellena la propia base de datos (`DEFAULT now()`), nunca el usuario ni la aplicación — evita que alguien pueda falsear la fecha de creación de un registro.

### 2.2. `activos`

Las viviendas/inmuebles, cada uno perteneciente a un único fondo.

```sql
CREATE TABLE activos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  direccion TEXT NOT NULL,
  municipio TEXT,
  referencia_catastral TEXT UNIQUE,
  fondo_id BIGINT NOT NULL REFERENCES fondos(id),
  estado TEXT NOT NULL CHECK (estado IN ('COMPRA', 'EN OBRA', 'EN VENTA', 'VENDIDO')),
  fecha_compra DATE,
  fecha_venta DATE,
  creado_en TIMESTAMPTZ DEFAULT now()
);
```

- `fondo_id BIGINT NOT NULL REFERENCES fondos(id)` es la **clave foránea**: cada activo pertenece a un fondo que debe existir en la tabla `fondos`. Es la relación **uno a muchos** (un fondo, muchos activos) aplicada como regla de la propia base de datos, no solo como diseño.
- `estado TEXT NOT NULL CHECK (estado IN (...))` implementa una **lista cerrada**: el campo solo admite uno de los cuatro valores definidos. Intentar guardar cualquier otro valor es rechazado automáticamente.

### 2.3. `suministros`

Decisión de diseño: **una fila por suministro**, no una ficha por vivienda con columnas para cada tipo. Una vivienda con solo luz tiene 1 fila; con luz y gas, 2 filas.

```sql
CREATE TABLE suministros (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  activo_id BIGINT NOT NULL REFERENCES activos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('LUZ', 'GAS')),
  cups TEXT NOT NULL UNIQUE,
  potencia_contratada_kw NUMERIC,
  tipo_instalacion_gas TEXT,
  creado_en TIMESTAMPTZ DEFAULT now(),
  CHECK (tipo = 'LUZ' OR potencia_contratada_kw IS NULL),
  CHECK (tipo = 'GAS' OR tipo_instalacion_gas IS NULL),
  UNIQUE (activo_id, tipo)
);
```

- **Ventaja del modelo "una fila por suministro":** no hay columnas vacías para el tipo que no aplica, y añadir un tipo de suministro nuevo en el futuro (por ejemplo, internet) es añadir filas, no columnas a la tabla.
- Los dos `CHECK` sueltos al final son restricciones **entre columnas**, no sobre una sola. `CHECK (tipo = 'LUZ' OR potencia_contratada_kw IS NULL)` expresa la condición "si es de tipo GAS, entonces la potencia tiene que estar vacía" — en lógica, "si A entonces B" se escribe como "no A, o B", que es justo lo que hace el `OR`. Así se impide, por ejemplo, un suministro de gas con potencia contratada rellenada.
- `UNIQUE (activo_id, tipo)` es una restricción de **unicidad combinada**: un mismo activo no puede tener dos suministros del mismo tipo (no puede repetir LUZ, por ejemplo), pero sí puede tener uno de LUZ y otro de GAS.

### 2.4. `perfiles`

Los datos de la app para cada usuario, enlazados 1:1 con el sistema de login de Supabase.

```sql
CREATE TABLE perfiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('ADMIN', 'EDITOR', 'LECTOR')),
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ DEFAULT now()
);
```

- Las contraseñas **nunca** se guardan en tablas propias: las gestiona Supabase en su tabla interna `auth.users`, con el cifrado adecuado. `perfiles` solo añade los datos propios de la app (nombre, rol), usando el mismo `id` que genera el login (`UUID`).
- `UUID` (identificador largo, prácticamente irrepetible) en vez de un número correlativo: evita que alguien pueda adivinar ids de otros usuarios probando "si yo soy el 5, pruebo el 4 y el 6".
- Tres roles: **ADMIN** (acceso total, incluida la actividad de todos), **EDITOR** (consulta, busca, crea y modifica solo en sus secciones asignadas) y **LECTOR** (solo consulta en sus secciones, sin modificar).
- `activo BOOLEAN` permite desactivar un usuario sin borrarlo ni perder su historial de actividad.

### 2.5. `permisos_seccion`

Resuelve la relación **muchos a muchos** entre perfiles y secciones: un usuario puede tener acceso a varias secciones, y una sección puede estar asignada a varios usuarios.

```sql
CREATE TABLE permisos_seccion (
  perfil_id UUID NOT NULL REFERENCES perfiles(id),
  seccion TEXT NOT NULL CHECK (seccion IN ('FONDOS', 'ACTIVOS', 'SUMINISTROS')),
  asignado_en TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (perfil_id, seccion)
);
```

- `PRIMARY KEY (perfil_id, seccion)` es una **clave primaria compuesta**: no hace falta un `id` propio porque la combinación de las dos columnas ya identifica la fila de forma única (un perfil no puede tener la misma sección asignada dos veces).
- El rol ADMIN no necesita filas aquí: su rol ya le da acceso a todo, sin pasar por esta tabla.

### 2.6. `registro_actividad`

El log de auditoría: quién hizo qué, cuándo, sobre qué.

```sql
CREATE TABLE registro_actividad (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ocurrido_en TIMESTAMPTZ DEFAULT now(),
  perfil_id UUID NOT NULL REFERENCES perfiles(id),
  accion TEXT NOT NULL CHECK (accion IN ('LOGIN', 'LOGOUT', 'BUSQUEDA', 'CONSULTA', 'CREACION', 'MODIFICACION', 'BORRADO', 'ACCESO_DENEGADO')),
  seccion TEXT CHECK (seccion IN ('FONDOS', 'ACTIVOS', 'SUMINISTROS')),
  registro_id BIGINT,
  detalle JSONB
);
```

- **Append-only:** solo se añade, nunca se modifica ni se borra — ningún rol, ni siquiera ADMIN desde la aplicación, puede editar o eliminar una entrada ya escrita.
- **Los usuarios no escriben aquí directamente.** Si pudieran, podrían inventarse entradas falsas. Solo escriben los disparadores de la base de datos (altas, cambios, borrados) y las funciones de búsqueda/consulta — un punto clave a defender: las lecturas (búsquedas y consultas) no se registran solas con un disparador normal, así que pasan siempre por funciones específicas que devuelven el dato y lo apuntan a la vez.
- `detalle JSONB`: formato de texto estructurado que admite contenido distinto según la acción (términos de una búsqueda, valores antes/después de una modificación), sin necesitar una columna por cada posible dato.
- `seccion` puede quedar vacía (en acciones `LOGIN`/`LOGOUT`) a pesar de tener un `CHECK`: en SQL, una restricción `CHECK` no se aplica cuando el valor es `NULL`, solo quien pone un valor debe cumplir la lista cerrada.

### Mapa de relaciones

- `fondos` 1:N `activos`
- `activos` 1:N `suministros`
- `auth.users` 1:1 `perfiles`
- `perfiles` N:M secciones, a través de `permisos_seccion`
- `perfiles` 1:N `registro_actividad`

## 3. Row Level Security (RLS)

Row Level Security es una capa de reglas de PostgreSQL que filtra, fila a fila, qué puede leer o escribir cada petición, según quién la hace.

**Decisión de diseño:** las 6 tablas se crearon con RLS **activado desde el primer momento** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, ejecutado como parte del mismo script que las crea), no añadido después como parche.

**Consecuencia inmediata:** activar RLS sin definir ninguna política todavía no abre la tabla, la **cierra por completo** a cualquier cliente que use las claves públicas (las que usará la propia aplicación web). Es la postura de seguridad "denegado por defecto": mientras no exista una política explícita que lo permita, nadie externo puede leer ni escribir nada. El SQL Editor de Supabase, al trabajar con privilegios de administrador, sigue teniendo acceso completo — por eso se pudieron crear y probar las tablas con normalidad.

**Pendiente:** las políticas concretas (quién puede leer/escribir qué, según el rol de `perfiles` y las secciones de `permisos_seccion`) se añadirán cuando se construya el login y la lógica de permisos — es el siguiente hito de seguridad del proyecto.

## 4. El login — HTML y CSS

### 4.1. Estructura HTML (`login.html`)

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Iniciar sesión</title>
  <link rel="stylesheet" href="estilos-formal.css">
</head>
<body>
  <div class="tarjeta-login">
    <h1>Iniciar sesión</h1>

    <form>
      <label for="email">Correo electrónico</label>
      <input type="email" id="email" name="email" required>

      <label for="password">Contraseña</label>
      <input type="password" id="password" name="password" required>

      <button type="submit">Entrar</button>
    </form>
  </div>
</body>
</html>
```

- `type="email"` y `type="password"` activan validación y comportamiento nativos del navegador sin escribir JavaScript: el primero comprueba que el texto tenga forma de correo, el segundo oculta automáticamente lo que se escribe.
- `required` impide enviar el formulario con campos vacíos — otra validación gratuita del navegador.
- `for="email"` en el `<label>` enlazado con `id="email"` en el `<input>` correspondiente: necesario para accesibilidad y para que un clic en la etiqueta lleve el foco al campo.
- **Comportamiento por defecto sin JavaScript** (comprobado): al enviar el formulario, el navegador recarga la página y añade los datos a la URL (`?email=...&password=...`), visibles en texto plano. Esto se corrige en la fase de JavaScript, interceptando el envío antes de que el navegador haga esto por su cuenta y mandando los datos a Supabase de forma segura.

### 4.2. Dos versiones de estilo en paralelo

Mismo HTML, dos hojas de estilo distintas — para comparar antes de decidir cuál usar en la presentación final, con el mismo criterio que se usó para los diagramas del modelo de datos.

**`estilos-formal.css`** — sobria: fondo oscuro liso, tarjeta centrada con `Flexbox`, esquinas redondeadas, tipografía de sistema.

**`login-cyberpunk.html` + `estilos-cyberpunk.css`** — reutiliza la paleta y tipografías ya validadas en el diagrama "edición Rubén": fondo con rejilla sutil, tipografías `Chakra Petch` y `Share Tech Mono` (Google Fonts), resplandores en cian vía `box-shadow`, esquina angular en el botón vía `clip-path`, variables CSS (`:root { --cyan: ...; }`) para reutilizar los colores en todo el archivo.

Ambas comparten los mismos fundamentos de CSS: modelo de caja (`padding`/`margin`/`border`), `Flexbox` para centrar y organizar en columna, y pseudo-selectores (`:focus`, `:hover`) para dar retroalimentación visual al usuario.

---

*Próxima sección pendiente: JavaScript y conexión con la autenticación de Supabase.*
