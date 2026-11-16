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

**Políticas:** la primera (cada usuario lee solo su propio perfil) está en la sección 6; la del administrador (lee todos los perfiles), en la sección 7. El resto (quién puede leer/escribir qué, según el rol de `perfiles` y las secciones de `permisos_seccion`) se irá añadiendo de la misma forma: abriendo en cada caso solo lo imprescindible.

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

### 4.3. Versión elegida

Se continúa con la versión **formal** (`login.html` + `estilos-formal.css`). La cyberpunk se conserva en el repositorio sin modificar: cuando la formal esté completa, se rehará la alternativa sobre ella para comparar ambos resultados.

## 5. El login — JavaScript y conexión con Supabase Auth

El formulario pasa de no hacer nada a autenticar usuarios reales contra Supabase. Se construyó en cinco pasos pequeños, cada uno probado en el navegador antes de pasar al siguiente.

### 5.1. Carga de scripts (`login.html`)

```html
    </form>
    <p id="mensaje"></p>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.min.js"></script>
  <script src="config.js"></script>
  <script src="login.js"></script>
</body>
```

- Los scripts van **al final del `body`**: el navegador lee el HTML de arriba abajo, y el JavaScript necesita que el formulario ya exista para poder localizarlo.
- El **orden importa**: primero la librería de Supabase (crea el objeto global `supabase`), después la configuración (define la URL y la clave) y por último el código propio, que usa ambos.
- La librería se carga desde un CDN (jsDelivr) con la **versión exacta fijada** (`2.117.3`), no con `@2`. Así el código que recibe la página no cambia sin una decisión explícita: una actualización del proveedor no puede alterar el comportamiento del login por sorpresa.
- El formulario recibe `id="form-login"` y se añade un párrafo vacío `<p id="mensaje">` para mostrar el resultado al usuario.

### 5.2. Configuración fuera del repositorio

```js
// config.ejemplo.js — lo que se sube a GitHub
const SUPABASE_URL = "PEGA_AQUI_TU_URL";
const SUPABASE_KEY = "PEGA_AQUI_TU_CLAVE_PUBLICA";
```

- Los datos reales viven en `config.js`, que está en `.gitignore` y **nunca se sube**. En el repositorio solo hay `config.ejemplo.js`, con la misma forma y los huecos vacíos, para que quien descargue el proyecto sepa qué necesita.
- `config.js` se añadió a `.gitignore` **antes** de crear el archivo, y se comprobó con `git check-ignore` y `git status` que Git no lo ve.
- La clave usada es la **publishable**, pensada para ir en el navegador: es visible para cualquiera que abra la página, y lo que protege los datos es Row Level Security (sección 3). La clave **secret / service_role** salta el RLS y da acceso total: nunca debe ir en código de cliente.
- Si es pública, ¿por qué no subirla? Porque es un hábito profesional mantener la configuración de cada entorno fuera del código, y porque así el repositorio no queda atado a un proyecto concreto de Supabase.
- **Trampa encontrada:** `SUPABASE_URL` debe ser la URL **base** del proyecto (`https://<id>.supabase.co`). La que muestra la página *Data API* del panel termina en `/rest/v1/`; si se usa esa, la librería la duplica en todas sus rutas (`.../rest/v1/auth/v1`) y el login falla. Se detectó inspeccionando el cliente en la consola.

### 5.3. El código (`login.js`)

*(Estado al cerrar esta pieza. En la sección 6.4 la rama de éxito se amplía para leer el perfil del usuario.)*

```js
const clienteSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
console.log("Cliente de Supabase creado");

const formulario = document.getElementById("form-login");
const campoEmail = document.getElementById("email");
const campoPassword = document.getElementById("password");
const mensaje = document.getElementById("mensaje");

formulario.addEventListener("submit", async function (evento){
    evento.preventDefault();
    const email = campoEmail.value;
    const password = campoPassword.value;

    const {data, error} = await clienteSupabase.auth.signInWithPassword({
        email: email,
        password: password,
    });

    if (error) {
        console.log("Error al iniciar sesión:", error.message);
        mensaje.textContent = "Correo o contraseña incorrectos.";
        mensaje.className = "mensaje-error";
    } else {
        console.log("Sesión iniciada como:", data.user.email);
        mensaje.textContent = "Has iniciado sesión como " + data.user.email;
        mensaje.className = "mensaje-exito";
    }
});
```

**Paso 1: interceptar el envío.** `addEventListener("submit", ...)` ejecuta la función cuando se envía el formulario, y `evento.preventDefault()` cancela el comportamiento por defecto del navegador. Esto corrige el problema detectado en la sección 4.1: la contraseña ya no aparece en la URL.

**Paso 2: leer los campos.** Los elementos se localizan **una vez**, al cargar la página, porque no cambian. Su contenido (`.value`) se lee **dentro** de la función, en el momento del envío: si se leyera fuera, se leería al cargar, con los campos vacíos.

**Paso 3: crear el cliente.** `supabase.createClient(URL, clave)` crea el objeto a través del cual la página habla con el proyecto. La variable se llama `clienteSupabase`, no `supabase`, porque ese nombre ya lo ocupa la librería.

**Paso 4: autenticar.** `signInWithPassword` envía las credenciales al servicio de autenticación de Supabase, que compara la contraseña con la versión cifrada que guarda en `auth.users`. La página nunca ve ni almacena contraseñas.
- `async` / `await`: la respuesta llega por la red y tarda; `await` hace que el código espere a tenerla antes de seguir, y `async` marca la función que contiene esas esperas.
- `const {data, error} = ...` extrae las dos partes de la respuesta: `error` (motivo del fallo, o `null`) y `data` (usuario y sesión, si todo fue bien).

**Paso 5: responder al usuario.**
- Se usa `textContent`, **no `innerHTML`**. `innerHTML` interpreta etiquetas HTML; si algún día se muestra algo escrito por el usuario, eso permitiría inyectar código en la página (ataque **XSS**). `textContent` lo muestra siempre como texto plano.
- El mensaje de error es **genérico**: no distingue entre "el correo no existe" y "la contraseña es incorrecta". Si lo hiciera, un atacante podría averiguar qué correos están registrados probándolos uno a uno (enumeración de usuarios).
- El color lo decide el CSS, no el JavaScript: el código solo asigna una clase (`mensaje-error` / `mensaje-exito`) con `className`, que además sustituye la anterior, de modo que nunca quedan las dos a la vez. Cada archivo tiene su responsabilidad: el CSS cómo se ve, el JavaScript qué pasa.
- En la consola solo se registra la longitud de la contraseña durante las pruebas, nunca su valor; en la versión final no se registra en absoluto.

### 5.4. Cómo se probó

- **Usuario de prueba:** creado en el panel de Supabase (*Authentication → Users*), con un correo ficticio y confirmado automáticamente. Al ser datos de prueba, el RGPD todavía no aplica.
- **Contraseña incorrecta:** aparece "Correo o contraseña incorrectos." en rojo. En la consola, el navegador registra `POST .../auth/v1/token?grant_type=password 400 (Bad Request)`: es la petición de login rechazada por el servidor, es decir, el comportamiento esperado, no un fallo del código.
- **Contraseña correcta:** aparece "Has iniciado sesión como …" en verde.
- Ambas pruebas son igual de importantes: un login debe dejar pasar a quien corresponde y rechazar a quien no.

## 6. Primera política de RLS — cada usuario lee solo su propio perfil

Hasta aquí, las tablas estaban cerradas por completo (sección 3) y el login funcionaba (sección 5), pero un usuario con sesión no podía leer nada. Esta pieza abre la primera rendija, y la más pequeña posible: que cada usuario pueda **leer su propia fila de `perfiles`** y ninguna otra.

### 6.1. Cómo sabe la base de datos quién pregunta

- Tras un login correcto, Supabase entrega al navegador un **token de sesión** (JWT) que contiene el id del usuario y está **firmado** por Supabase. Cualquier modificación invalida la firma, así que no puede falsificarse ni editarse para suplantar a otro usuario.
- La librería guarda ese token y lo adjunta **automáticamente** a cada petición.
- En la base de datos, la función **`auth.uid()`** devuelve el id del usuario de la petición en curso, extraído de ese token ya verificado. Sin sesión, devuelve `NULL`.
- La decisión se toma **en la base de datos**, no en la página: el JavaScript del navegador puede ser manipulado por cualquiera, el token firmado no.

Aquí se aprovecha una decisión del diseño (sección 2.4): `perfiles.id` es **el mismo UUID** que `auth.users.id`. La fila de perfil de cada usuario lleva exactamente su identificador, así que la regla se puede expresar como una simple comparación.

### 6.2. La política

Archivo `supabase/migraciones/007_politica_perfiles_lectura.sql`:

```sql
CREATE POLICY "Cada usuario lee su propio perfil"
ON perfiles
FOR SELECT
TO authenticated
USING (id = auth.uid());
```

- **`CREATE POLICY "..."`** — el nombre es descriptivo, para personas (es el que aparece en el panel). Comillas dobles porque es un nombre con espacios; en SQL las simples son para valores.
- **`ON perfiles`** — tabla a la que se aplica.
- **`FOR SELECT`** — solo lectura. Crear, modificar o borrar perfiles sigue cerrado: se abre únicamente lo imprescindible.
- **`TO authenticated`** — solo para peticiones con un token válido. Supabase distingue `anon` (sin sesión) y `authenticated`. Es una doble barrera: sin sesión la política ni se evalúa, y aunque se evaluara, `auth.uid()` sería `NULL` y no pasaría.
- **`USING (id = auth.uid())`** — la condición que se comprueba **en cada fila**: solo es visible si su `id` coincide con el del usuario que pregunta. Las filas que no la cumplen no producen un error: para esa petición, simplemente no existen.
- **Por qué no basta con `TO authenticated`:** sin el `USING`, cualquier usuario con sesión vería *todos* los perfiles. El `USING` es lo que convierte "tener sesión" en "ver solo lo tuyo", y protege también frente a un usuario legítimo con malas intenciones, no solo frente a alguien de fuera.

Se escribió primero en el archivo de migración, se revisó, y después se ejecutó en el SQL Editor de Supabase, igual que las tablas.

### 6.3. Datos de prueba

Dos usuarios ficticios creados en *Authentication → Users*, con su fila en `perfiles` insertada a mano desde el SQL Editor:

| Usuario | Nombre en `perfiles` | Rol |
|---|---|---|
| `admin.prueba@ejemplo.com` | Admin de prueba | ADMIN |
| `lector.prueba@ejemplo.com` | Lector de prueba | LECTOR |

Estas inserciones son **datos de prueba**, no estructura, así que no se guardan como migración. Las migraciones solo contienen lo necesario para reconstruir la base de datos desde cero (tablas, políticas, funciones).

### 6.4. La prueba desde la página (`login.js`)

*(Estado al cerrar esta pieza. En la sección 7.5 la consulta pasa a filtrar por el usuario que ha entrado.)*

Tras un login correcto, la página pide el perfil y saluda al usuario por su nombre:

```js
    } else {
        console.log("Sesión iniciada como:", data.user.email);

        const { data: perfiles, error: errorPerfil } = await clienteSupabase
            .from("perfiles")
            .select("*");

        console.log("Perfiles visibles:", perfiles);

        if (errorPerfil || perfiles.length === 0) {
            mensaje.textContent = "Sesión iniciada, pero no se encontró tu perfil.";
            mensaje.className = "mensaje-error";
        } else {
            mensaje.textContent = "Bienvenido, " + perfiles[0].nombre;
            mensaje.className = "mensaje-exito";
        }
    }
```

- **Se piden todos los perfiles, sin filtrar, a propósito.** Si el JavaScript filtrara por el id del usuario, no se sabría si protege la política o el propio código. Pidiendo todo, si llega solo la fila propia, queda demostrado que quien filtra es la base de datos.
- `{ data: perfiles, error: errorPerfil }` extrae la respuesta con otros nombres, porque `data` y `error` ya existen en ese bloque (son los del login).
- El nombre llega de la base de datos y se muestra con `textContent`: aunque alguien guardara código como nombre, se mostraría como texto y nunca se ejecutaría.

### 6.5. Cómo se probó

**Primer intento — no demostraba nada.** Con un solo perfil en la tabla, la página recibía 1 fila. Pero "todos los perfiles" y "solo el mío" eran lo mismo: el resultado habría sido idéntico sin ninguna política. Por eso se creó un segundo usuario antes de dar la prueba por buena.

**Prueba válida, con dos perfiles en la tabla:**

| Quién pide (`select("*")`) | Qué recibe |
|---|---|
| Admin con sesión | 1 fila: la suya |
| Lector con sesión | 1 fila: la suya (otro id) |
| Sin sesión | 0 filas |

- El mismo código, haciendo la misma petición, recibe respuestas distintas según quién la hace.
- **Sin sesión**, la prueba se hizo como lo haría un atacante: desde la consola del navegador, cerrando la sesión (`await clienteSupabase.auth.signOut()`) y pidiendo a mano todos los perfiles. Respuesta: `data: []`, `error: null`, `status: 200`. No hay mensaje de "acceso denegado": el atacante ni siquiera puede distinguir si la tabla está vacía o protegida.
- El SQL Editor del panel trabaja con privilegios de administrador y **se salta el RLS**: por eso allí se ven las dos filas, y por eso la prueba real tiene que hacerse desde la página.

### 6.6. Pregunta previsible: "¿Y el administrador no ve todos los perfiles?"

Con esta política sola, no, y es intencionado. Esta política solo establece "cada uno ve lo suyo". El acceso ampliado del administrador es **otra política, explícita**, basada en el rol guardado en `perfiles` (sección 7). El enfoque es: primero cerrar todo, después abrir lo mínimo para cualquier usuario, y por último conceder los accesos extra de cada rol uno a uno, cada uno con su regla visible.

## 7. Política del administrador — lee todos los perfiles

Primer acceso extra por rol: el usuario con rol `ADMIN` puede leer **todos** los perfiles, no solo el suyo.

### 7.1. Las políticas se suman

Si una tabla tiene varias políticas `SELECT`, una fila es visible cuando **cualquiera** de ellas la permite (un "O" lógico):

```
fila visible  =  "es mía" (sección 6)   O   "soy admin" (esta sección)
```

Por eso la política de la sección 6 no se toca: se añade una segunda. Y la nueva condición no depende de la fila que se mira, sino de **quién pregunta**: si es admin, se cumple para todas las filas.

### 7.2. ¿Cómo se sabe que quien pregunta es admin de verdad?

La pregunta de seguridad previa a escribir nada. La respuesta es una cadena de confianza con dos eslabones:

1. **Quién es** → `auth.uid()`, sacado del token firmado (sección 6.1). No se puede falsificar.
2. **Qué rol tiene** → la columna `rol` de `perfiles`, consultada **dentro de la base de datos**. El navegador nunca dice "soy admin": solo aporta su identidad firmada, y el rol lo decide la tabla.

**Dónde estaría el ataque de verdad:** en quién puede **escribir** el rol. Si un usuario pudiera editar su propia fila de `perfiles`, podría cambiarse a `ADMIN` desde la consola (**escalada de privilegios**). Lo mismo si el rol se guardara en los metadatos de usuario de Supabase (`user_metadata`), que el propio usuario puede modificar. Hoy `perfiles` no tiene ninguna política de `INSERT` ni `UPDATE`, así que nadie puede cambiar un rol desde la aplicación. **Regla para el futuro:** si se permite editar el perfil propio, nunca podrá incluir `rol` ni `activo`.

### 7.3. La trampa: recursión infinita

La forma directa de escribir la condición sería:

```sql
USING (
  EXISTS (
    SELECT 1
    FROM perfiles
    WHERE id = auth.uid() AND rol = 'ADMIN'
  )
)
```

- `EXISTS (...)` devuelve verdadero si la subconsulta encuentra alguna fila; `SELECT 1` indica que no importan las columnas, solo si existe.
- Lógicamente es correcta, pero **no funciona**: es una política sobre `perfiles` que, para evaluarse, lee `perfiles`. Esa lectura también pasa por el RLS, que vuelve a evaluar la política, que vuelve a leer `perfiles`... PostgreSQL lo detecta y corta con `infinite recursion detected in policy for relation "perfiles"`.
- Y falla **la consulta entera**, no solo la parte del admin: nadie, ni siquiera el lector con su propia política, podría leer `perfiles`.

Se detectó antes de ejecutar, razonándolo, no por el error.

### 7.4. La solución: una función `SECURITY DEFINER`

Archivo `supabase/migraciones/008_politica_perfiles_admin.sql`:

```sql
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
```

- **`SECURITY DEFINER`** — la función se ejecuta con los permisos de quien la creó, no con los del usuario que pregunta, así que su lectura interna de `perfiles` **no pasa por el RLS**. Se rompe el bucle. Es como el portero de un edificio que consulta la lista de vecinos en su garita: no se pide permiso a sí mismo para mirarla.
- Al ser una herramienta potente, se blinda:
  - **Solo devuelve verdadero o falso** sobre quien pregunta. No expone datos de nadie.
  - **`SET search_path = ''`** y nombres completos (`public.perfiles`, `auth.uid()`): la función no busca tablas por nombre suelto, así que nadie puede colarle una tabla falsa con el mismo nombre.
  - **Esquema propio, `privado`**, que no está entre los que Supabase publica en su API: no se puede llamar directamente desde el navegador.
- **`GRANT USAGE ON SCHEMA privado TO authenticated`** — la política se evalúa con los permisos de quien pregunta, que necesita poder "entrar" en el esquema para llamar a la función. Sin esta línea, toda lectura de `perfiles` daría `permission denied for schema privado`. No publica el esquema en la API: eso depende de otro ajuste de Supabase ("Exposed schemas").
- **`STABLE`** — indica a PostgreSQL que, dentro de una misma consulta, la función devuelve siempre lo mismo, lo que le permite optimizar.
- **`AND activo`** — un administrador desactivado pierde sus permisos. `activo` es `BOOLEAN`, así que puede ir sola como condición (equivale a `activo = true`); `rol`, que es texto, necesita la comparación.
- `privado.es_admin()` queda disponible para cualquier política futura que dependa del rol de admin.

### 7.5. El saludo de `login.js`, corregido

Con la política nueva, el admin recibe varios perfiles, y el saludo usaba `perfiles[0].nombre`: "el primero de la lista". Sin un `ORDER BY`, la base de datos no garantiza el orden, así que el primero podía no ser el suyo. En la prueba salió bien, pero por suerte.

La consulta pasa a pedir solo el perfil del usuario que ha entrado:

```js
        const { data: perfiles, error: errorPerfil } = await clienteSupabase
            .from("perfiles")
            .select("*")
            .eq("id", data.user.id);
```

- `.eq("columna", valor)` es el `WHERE columna = valor` de SQL escrito desde JavaScript (*equal*, "igual").
- `data.user.id` es el id del usuario devuelto por el login: el equivalente en el navegador de `auth.uid()` en la base de datos, y el mismo UUID que su fila en `perfiles`.
- **El filtro no es la seguridad, es la intención.** La protección sigue estando en el RLS: si alguien quitara el `.eq` desde la consola, seguiría viendo solo lo que su política le permite. El filtro solo dice qué fila quiere la página para el saludo.
- Las pruebas de la política (7.6) se hicieron **antes** de añadir el filtro, con la consulta sin filtrar, por el mismo motivo que en la sección 6.4: para que lo que se viera fuera obra de la base de datos.

### 7.6. Cómo se probó

Con la consulta sin filtrar (`select("*")`):

| Quién pide | Qué recibe | Por qué |
|---|---|---|
| Admin con sesión | 2 filas: todos los perfiles | `es_admin()` devuelve verdadero |
| Lector con sesión | 1 fila: la suya | `es_admin()` es falso; solo le vale la política de la sección 6 |
| Sin sesión | 0 filas (`data: []`, `error: null`, `status: 200`) | `TO authenticated`: ninguna política se evalúa |

Después, con el filtro `.eq`: el admin recibe 1 fila, la suya, y el saludo es "Bienvenido, Admin de prueba".

## 8. Acceso por sección — lectura de fondos

Hasta aquí las reglas respondían a "¿es tu perfil?" (sección 6) y "¿eres admin?" (sección 7). Esta pieza introduce una tercera pregunta: **"¿tienes asignada esta sección?"**. La respuesta vive en `permisos_seccion` (sección 2), la tabla intermedia de la relación muchos a muchos entre perfiles y secciones. Se empieza por `fondos`; `activos` y `suministros` seguirán el mismo patrón.

### 8.1. Por qué otra función `SECURITY DEFINER`

La forma directa sería que la política de `fondos` consultara `permisos_seccion`. No funciona, pero por un motivo distinto al de la sección 7.3: `permisos_seccion` tiene RLS activado **sin ninguna política**, así que, para un usuario normal, esa tabla está vacía. La consulta interna no encontraría nunca su permiso y nadie, salvo el admin, vería un solo fondo.

La solución es la misma herramienta que en la sección 7.4: una función `SECURITY DEFINER` en el esquema `privado`, que consulta la tabla con los permisos de quien la creó y solo devuelve verdadero o falso. `permisos_seccion` sigue cerrada a la lectura directa: nadie puede ver qué permisos tienen los demás.

### 8.2. La migración

Archivo `supabase/migraciones/009_politica_fondos_seccion.sql`:

```sql
CREATE FUNCTION privado.tiene_seccion(seccion_pedida text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT privado.es_admin() OR EXISTS (
    SELECT 1
    FROM public.permisos_seccion AS ps
    JOIN public.perfiles AS p ON p.id = ps.perfil_id
    WHERE ps.perfil_id = auth.uid()
        AND ps.seccion = seccion_pedida
        AND p.activo
  );
$$;

CREATE POLICY "Lectura de fondos por sección"
ON public.fondos
FOR SELECT
TO authenticated
USING ((select privado.tiene_seccion('FONDOS')));
```

**La función:**
- **`(seccion_pedida text)`** — un **parámetro**: el dato que recibe la función al llamarla. Una sola función sirve para las tres secciones; cada política le dice cuál comprobar (`'FONDOS'`, `'ACTIVOS'`, `'SUMINISTROS'`), en vez de escribir tres funciones casi idénticas.
- **Por qué no se llama `seccion`:** es el nombre de la columna de `permisos_seccion`. Con `ps.seccion = seccion`, Postgres tendría dos cosas con el mismo nombre y la comparación sería ambigua. Un nombre distinto elimina la duda.
- **`privado.es_admin() OR EXISTS (...)`** — reutiliza la función de la sección 7: el admin entra en todas las secciones **sin necesitar filas** en `permisos_seccion`. Si no es admin, se mira si existe su permiso.
- **`JOIN public.perfiles AS p ON p.id = ps.perfil_id`** — une cada permiso con el perfil al que pertenece, como un BUSCARV entre dos hojas. Hace falta porque el permiso está en una tabla y el estado `activo`, en otra.
- **`AS ps` / `AS p`** — **alias**: apodos cortos para no repetir el nombre completo de cada tabla.
- **`AND p.activo`** — un usuario desactivado pierde el acceso aunque conserve sus permisos, igual que un admin desactivado en la sección 7.
- El resto de la cabecera (`STABLE`, `SECURITY DEFINER`, `search_path = ''`, nombres completos) se explica en la sección 7.4. No se repite el `CREATE SCHEMA` ni el `GRANT USAGE`: ya existen desde la migración 008.

**La política:**
- **`'FONDOS'`** — en mayúsculas y entre comillas simples, exactamente como lo admite la regla `CHECK` de `permisos_seccion`. Con `'fondos'` no coincidiría con ninguna fila.
- **`((select ...))`** — recomendación de rendimiento de Supabase. Sin el `select`, PostgreSQL puede ejecutar la función **una vez por cada fila** de la tabla; envuelta en un `select`, la ejecuta **una sola vez por consulta** y reutiliza el resultado. Como la respuesta depende de quién pregunta y no de la fila, el resultado es el mismo y el coste baja. Los dos pares de paréntesis tienen funciones distintas: el de fuera lo exige `USING`, el de dentro envuelve el `select`.

### 8.3. Datos de prueba

Insertados a mano desde el SQL Editor (no son migración, ver sección 6.3):

- Un **tercer usuario ficticio**, `editor.prueba@ejemplo.com`, creado en *Authentication → Users* con su fila en `perfiles` (nombre "Editor de prueba", rol `EDITOR`).
- **Tres fondos ficticios.**
- **Permisos**, cada uno pensado para demostrar algo:

| Usuario | Permisos | Qué demuestra |
|---|---|---|
| admin | ninguno | Entra por su rol, sin permisos asignados |
| lector | `FONDOS` | Quien tiene la sección, la ve |
| editor | `ACTIVOS` | Tener *otra* sección no da acceso a esta: la función mira la sección concreta, no "algún permiso" |

En lugar de copiar a mano el UUID de cada usuario, los `INSERT` lo obtienen con una **subconsulta** por correo:

```sql
INSERT INTO permisos_seccion (perfil_id, seccion)
VALUES
  ((SELECT id FROM auth.users WHERE email = 'lector.prueba@ejemplo.com'), 'FONDOS'),
  ((SELECT id FROM auth.users WHERE email = 'editor.prueba@ejemplo.com'), 'ACTIVOS');
```

La subconsulta va entre sus propios paréntesis, dentro de los de la fila: así PostgreSQL sabe dónde termina y dónde empieza el siguiente valor.

### 8.4. Cómo se probó

Desde la consola del navegador, iniciando sesión con cada usuario en el formulario y pidiendo todos los fondos sin filtrar:

```js
await clienteSupabase.from("fondos").select("*")
```

| Quién pide | Qué recibe | Por qué |
|---|---|---|
| Admin | 3 fondos | `es_admin()` es verdadero |
| Lector | 3 fondos | Tiene el permiso `FONDOS` |
| Editor | 0 (`data: []`) | Solo tiene `ACTIVOS` |
| Sin sesión (tras `signOut()`) | 0 (`data: []`) | `TO authenticated`: ninguna política se evalúa |

En los cuatro casos, `error: null` y `status: 200`. Igual que en la sección 6.5, quien no tiene acceso no recibe un "prohibido": para él, la tabla simplemente está vacía.

## 9. Acceso por sección — activos y suministros

Segunda pieza del acceso por sección: aplicar a `activos` y `suministros` la misma regla que a `fondos` (sección 8).

### 9.1. La migración: solo políticas

Archivo `supabase/migraciones/010_politica_activos_suministros_seccion.sql`:

```sql
CREATE POLICY "Lectura de activos por sección"
ON public.activos
FOR SELECT
TO authenticated
USING ((select privado.tiene_seccion('ACTIVOS')));

CREATE POLICY "Lectura de suministros por sección"
ON public.suministros
FOR SELECT
TO authenticated
USING ((select privado.tiene_seccion('SUMINISTROS')));
```

- **No hay función nueva.** `privado.tiene_seccion` ya existe desde la migración 009, y como recibe la sección como parámetro, sirve tal cual: cada política solo cambia el valor que le pasa. Volver a escribir `CREATE FUNCTION` habría fallado con `function ... already exists`. Es la ventaja de parametrizar: la lógica se escribe una vez y se reutiliza.
- Cada política cambia tres cosas respecto a la de `fondos`: el nombre, la tabla del `ON` y la sección.

### 9.2. La trampa: copiar y no cambiar la tabla

La migración se escribió copiando la política de `fondos`, y en la primera versión ambas políticas se quedaron con `ON public.fondos`. Se detectó en la revisión, antes de ejecutar.

Lo peligroso es que **no habría dado ningún error**: crear más políticas sobre `fondos` es válido. Pero, como las políticas se suman (sección 7.1), el resultado habría sido:

```
ver fondos  =  tiene FONDOS   O   tiene ACTIVOS   O   tiene SUMINISTROS
```

Cualquier usuario con cualquier sección habría visto los fondos, y `activos` y `suministros` habrían seguido cerradas. Un agujero silencioso: solo lo habrían delatado las pruebas con varios usuarios (el editor, que solo tiene `ACTIVOS`, habría pasado de ver 0 fondos a ver 3). **Al copiar una política, lo primero que se revisa es la tabla del `ON`.**

### 9.3. Datos de prueba

Insertados a mano desde el SQL Editor:

- **Tres activos ficticios** (`ACT-001` a `ACT-003`), uno por fondo. `fondo_id` va sin comillas, porque es un número.
- **Cuatro suministros:** `ACT-001` con luz y gas, los otros dos solo con luz, como en el diseño (sección 2).
- **Un permiso nuevo:** `SUMINISTROS` para el lector. Sin él, ningún usuario normal tenía esa sección y no se podía probar el caso "sí la ve".

```sql
INSERT INTO suministros (activo_id, tipo, cups, potencia_contratada_kw, tipo_instalacion_gas)
VALUES
  ((SELECT id FROM activos WHERE codigo = 'ACT-001'), 'LUZ', 'ES0021000000000001AA', 7.5, NULL),
  ((SELECT id FROM activos WHERE codigo = 'ACT-001'), 'GAS', 'ES0217000000000001BB', NULL, 'INDIVIDUAL'),
  ((SELECT id FROM activos WHERE codigo = 'ACT-002'), 'LUZ', 'ES0021000000000001CC', 7, NULL),
  ((SELECT id FROM activos WHERE codigo = 'ACT-003'), 'LUZ', 'ES0021000000000001DD', 6.5, NULL);
```

- **`activo_id` por subconsulta sobre `codigo`**, en lugar de suponer qué id le tocó a cada activo.
- **`NULL`** — "vacío". En un `INSERT` de varias filas, todas dan valor a todas las columnas de la lista; el dato que no corresponde se rellena con `NULL`. Las restricciones `CHECK` de la tabla lo exigen: un suministro de luz no puede tener tipo de instalación de gas, ni uno de gas potencia.
- **Decimales con punto** (`7.5`): en SQL la coma separa valores, así que `7,5` serían dos valores.
- **Comillas simples para datos, dobles para nombres.** El primer intento usó `"INDIVIDUAL"` y PostgreSQL respondió `column "INDIVIDUAL" does not exist`: con comillas dobles (o sin comillas), una palabra se interpreta como el nombre de una columna. Los textos van entre comillas simples; los números, `NULL` y los nombres de columnas, sin ellas.
- Cuando una instrucción falla, PostgreSQL la rechaza entera: no quedan filas a medias y se puede corregir y repetir.

### 9.4. Cómo se probó

Con tres tablas y cuatro casos, la consulta se hizo con un bucle en la consola, que pide las tres tablas y muestra cuántas filas llegan de cada una:

```js
for (const t of ["fondos", "activos", "suministros"]) { const r = await clienteSupabase.from(t).select("*"); console.log(t, r.data.length, r.error); }
```

| Quién pide | Permisos | fondos | activos | suministros |
|---|---|---|---|---|
| Admin | ninguno | 3 | 3 | 4 |
| Lector | FONDOS, SUMINISTROS | 3 | 0 | 4 |
| Editor | ACTIVOS | 0 | 3 | 0 |
| Sin sesión | — | 0 | 0 | 0 |

Las 12 consultas devolvieron `error: null`. Cada tabla responde solo a su sección, de forma independiente.

**Sobre la consola:** el navegador muestra un aviso de que hay estafadores que piden a la gente pegar código ahí, porque ese código actúa con su sesión. Es la razón de fondo de todo el proyecto: la página no es una barrera de seguridad, cualquiera puede ejecutar lo que quiera desde la consola. La barrera es el RLS, que solo deja ver lo que el usuario tiene permitido, venga la petición de donde venga.

### 9.5. Pregunta previsible: "¿El lector ve suministros sin ver los activos?"

Sí, y es intencionado. El permiso es **por sección** (a qué partes de la aplicación entra cada usuario), no por la relación entre los datos. El lector ve los suministros con su `activo_id`, pero no la dirección del activo, porque no tiene la sección `ACTIVOS`.

Restringir qué filas ve cada usuario según los datos (por ejemplo, solo los activos de ciertos fondos, o solo los suministros de los activos que puede ver) es el **permiso por datos**, que se dejó deliberadamente como ampliación al cerrar el alcance de la versión mínima (sección 2).

## 10. Escritura del EDITOR

Hasta aquí todas las políticas eran de lectura (`SELECT`). Esta pieza abre la escritura según el diseño de roles (sección 2):

- **EDITOR** — crea y modifica, pero solo en las secciones que tiene asignadas.
- **ADMIN** — crea y modifica en todas.
- **LECTOR** — nunca escribe.
- **Borrar** (`DELETE`) no se abre a nadie desde la aplicación: sin política, queda denegado para todos.

### 10.1. Por qué no sirve `tiene_seccion` para escribir

`privado.tiene_seccion` (sección 8) solo comprueba si el usuario **tiene la sección**, no qué rol tiene. Para leer es correcto, pero el lector tiene secciones asignadas: si las políticas de escritura usaran esa función, el lector podría crear y modificar fondos. Hace falta una función hermana que, además, exija el rol `EDITOR`.

### 10.2. Las migraciones ya ejecutadas no se editan

La función nueva no se añade al archivo 009: va en una migración nueva. Cada migración es un apunte en un registro de cambios ya aplicados, en orden. Editar una ya ejecutada no cambiaría la base de datos (ese archivo ya corrió), solo el texto del repositorio, y el repositorio dejaría de contar lo que de verdad pasó: reconstruir la base de datos desde cero daría un resultado distinto al real. **Lo que ya se ejecutó no se toca; cualquier cambio va en un archivo nuevo.**

### 10.3. La migración

Archivo `supabase/migraciones/011_escritura_editor_seccion.sql`:

```sql
CREATE FUNCTION privado.puede_escribir(seccion_pedida text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT privado.es_admin() OR EXISTS (
    SELECT 1
    FROM public.permisos_seccion AS ps
    JOIN public.perfiles AS p ON p.id = ps.perfil_id
    WHERE ps.perfil_id = auth.uid()
        AND ps.seccion = seccion_pedida
        AND p.activo
        AND p.rol = 'EDITOR'
  );
$$;

CREATE POLICY "Creación de fondos por sección"
ON public.fondos
FOR INSERT
TO authenticated
WITH CHECK ((select privado.puede_escribir('FONDOS')));

CREATE POLICY "Modificación de fondos por sección"
ON public.fondos
FOR UPDATE
TO authenticated
USING ((select privado.puede_escribir('FONDOS')))
WITH CHECK ((select privado.puede_escribir('FONDOS')));

-- Las mismas dos políticas para activos ('ACTIVOS') y suministros ('SUMINISTROS').
```

- **`AND p.rol = 'EDITOR'`** — la única diferencia con `tiene_seccion`. `rol` es texto, así que necesita la comparación; `activo` es `BOOLEAN` y puede ir sola (sección 7.4). El admin sigue entrando por `es_admin()`, sin necesitar el rol EDITOR ni permisos asignados.

### 10.4. `USING` frente a `WITH CHECK`

Al escribir aparecen dos preguntas distintas:

- **`USING`** — *qué filas existentes puedes tocar*. Es lo que llevaban todas las políticas de lectura.
- **`WITH CHECK`** — *cómo pueden quedar las filas después de tu cambio*. Se comprueba sobre la fila nueva o modificada.

Cada operación usa lo que necesita:

| Operación | Fila antes | Fila después | Lleva |
|---|---|---|---|
| `INSERT` | no existe | la nueva | solo `WITH CHECK` |
| `UPDATE` | la existente | la modificada | `USING` y `WITH CHECK` |

Aquí las dos condiciones son iguales, porque el permiso es por sección y no depende del contenido de la fila. Con permisos por datos (ampliación) se separarían: por ejemplo, `USING` "es un activo de mis fondos" y `WITH CHECK` "y sigue siéndolo después del cambio", para que nadie mueva un activo a un fondo ajeno.

### 10.5. Otra vez la trampa del `ON`

Las cuatro políticas de `activos` y `suministros` se escribieron copiando las de `fondos` y, como en la sección 9.2, se quedaron con `ON public.fondos`. Se detectó en la revisión. Esta vez el efecto habría sido peor: el editor, con solo `ACTIVOS`, habría podido **crear y modificar fondos**.

Al copiar, la atención va a lo que cambia (nombre y sección) y salta lo que parece igual. La solución no es "fijarse más", sino una comprobación mecánica: **buscar `ON public.` con Ctrl+F en el editor y contar** que salen dos de cada tabla.

### 10.6. Cómo se probó

Desde la consola, con las órdenes de escritura de la librería:

```js
await clienteSupabase.from("activos").insert({ codigo: "ACT-004", direccion: "Calle del Editor 1", municipio: "Madrid", fondo_id: 1, estado: "COMPRA" })
await clienteSupabase.from("activos").update({ estado: "EN VENTA" }).eq("codigo", "ACT-001").select()
```

- **`{ columna: valor, ... }`** es un *objeto* de JavaScript: el equivalente a la lista de columnas y `VALUES` de SQL, con cada nombre junto a su valor.
- **Comillas:** en JavaScript los textos pueden ir entre comillas dobles. En SQL, no: allí las dobles son para nombres (sección 9.3). Cada lenguaje tiene sus reglas.
- **`.select()` al final del `update`** devuelve las filas que se modificaron de verdad. Es la forma de ver si un `UPDATE` hizo algo.

| Quién | Orden | Resultado |
|---|---|---|
| Editor (ACTIVOS) | Crear activo | `201` (creado) |
| Editor | Modificar ACT-001 | 1 fila modificada |
| Editor | Crear fondo | `403` denegado |
| Lector (FONDOS, SUMINISTROS) | Crear fondo | `403` denegado |
| Lector | Modificar fondo 1 | 0 filas, `error: null` |
| Admin | Crear fondo | `201` |
| Sin sesión | Crear fondo | `401` denegado |

**Las dos pruebas del lector son las decisivas:** tiene la sección `FONDOS` y ve los fondos, pero no puede ni crearlos ni modificarlos. Demuestran que el rol se comprueba de verdad.

**Cómo se ve un "no" en cada caso:**
- Un **`INSERT` denegado da error**: la fila nueva no pasa el `WITH CHECK`.
- Un **`UPDATE` denegado no da error**: el `USING` hace que, para ese usuario, no haya ninguna fila que modificar, así que no cambia nada y la respuesta es correcta, con 0 filas. Por eso hace falta el `.select()` para comprobarlo.
- **`401` frente a `403`**: 401 (*Unauthorized*) significa "no sé quién eres": no hay sesión. 403 (*Forbidden*) significa "sé quién eres, pero no puedes": hay sesión, pero no permiso.

## 11. Registro de actividad — solo el ADMIN lee

`registro_actividad` es el diario de la aplicación: quién crea o modifica qué, quién entra y quién intenta entrar donde no debe. Para ser fiable tiene que cumplir tres reglas:

1. **Solo el ADMIN lo lee.**
2. **Nadie escribe en él directamente.** Si un usuario pudiera insertar, podría inventarse entradas; solo escribirán disparadores y funciones propias (próxima sección).
3. **Solo se añade (append-only):** ni `UPDATE` ni `DELETE`.

### 11.1. Dos de las tres reglas ya se cumplen solas

La tabla se creó con RLS activado y sin políticas (migración 006), y RLS sin políticas lo cierra todo. Mientras no se cree ninguna política de `INSERT`, `UPDATE` o `DELETE`, nadie puede escribir, modificar ni borrar desde la aplicación. Solo hay que **abrir la lectura al admin**; lo demás se queda cerrado a propósito.

### 11.2. La migración

Archivo `supabase/migraciones/012_registro_actividad_lectura_admin.sql`:

```sql
CREATE POLICY "Solo el admin lee el registro de actividad"
ON public.registro_actividad
FOR SELECT
TO authenticated
USING ((select privado.es_admin()));
```

- **Solo una política, sin funciones nuevas:** `privado.es_admin()` existe desde la migración 008. El primer borrador copió la 008 entera (esquema, función y política), y habría fallado: el esquema ya existía, la función también (`function already exists`), y la política apuntaba a `perfiles` con un nombre ya usado.
- **Los paréntesis del `USING`:** son dos capas. Los de fuera son del `USING`; los de dentro, de la subconsulta `(select ...)`, que es el truco de rendimiento de la sección 8. Una función sin `select` no necesita los suyos: `USING ((select privado.es_admin()))`.
- **El `ON`, otra vez:** el primer borrador decía `ON public.perfiles`. Es la tercera vez que se cuela la tabla de la plantilla copiada (secciones 9.2 y 10.5).

### 11.3. Datos de prueba y la llave maestra

La tabla estaba vacía, y con 0 filas no se distingue "la política funciona" de "no hay nada". Se insertaron dos filas desde el SQL Editor (el editor crea un activo, el lector consulta fondos), buscando cada `perfil_id` por rol con una subconsulta, porque `perfiles` no guarda el correo:

```sql
INSERT INTO public.registro_actividad (perfil_id, accion, seccion, registro_id, detalle)
VALUES
  ((SELECT id FROM public.perfiles WHERE rol = 'EDITOR' LIMIT 1),
   'CREACION', 'ACTIVOS', 4, '{"nota": "fila de prueba"}'),
  ((SELECT id FROM public.perfiles WHERE rol = 'LECTOR' LIMIT 1),
   'CONSULTA', 'FONDOS', NULL, '{"nota": "fila de prueba"}');
```

- **`id` y `ocurrido_en` no se escriben:** los rellenan `GENERATED ALWAYS AS IDENTITY` y `DEFAULT now()`. La hora se guarda en UTC (`+00`), y cada cliente la convierte a la suya.
- **`detalle` es `JSONB`:** un cajón flexible para información extra sin crear columnas.
- **El SQL Editor responde "Success. No rows returned" también a un `INSERT`:** se refiere a que no devuelve filas que mostrar, no a que no haya insertado. El `INSERT` se ejecutó dos veces por eso, y los duplicados se borraron con `DELETE ... WHERE id IN (3, 4)`. Para saber qué pasó, se comprueba con un `SELECT`.

**¿Por qué el SQL Editor puede insertar (y borrar) si no hay políticas?** Porque entra como `postgres`, el dueño de la base de datos, y RLS no se aplica al dueño. Las políticas son las tarjetas de acceso de los empleados; el SQL Editor es la llave maestra. Por eso los datos de prueba se meten desde ahí, y por eso **las pruebas de verdad se hacen desde la página**, con la sesión de cada usuario. En una empresa real, el acceso al SQL Editor lo tendrían muy pocas personas: el append-only protege el registro de los usuarios de la aplicación, no del dueño.

### 11.4. Cómo se probó

```js
await clienteSupabase.from("registro_actividad").select("*")
```

| Quién | Esperado | Resultado |
|---|---|---|
| Admin | 2 | 2 |
| Editor | 0 | 0 |
| Lector | 0 | 0 |
| Sin sesión | 0 | 0 |

Todas con `error: null` y `status: 200`: una lectura denegada no da error, solo filtra filas (sección 8).

**La trampa de la sesión guardada:** la primera prueba "sin sesión" devolvió 2 filas. No era un agujero: Supabase guarda la sesión en el navegador (`localStorage`), y recargar la página vacía el formulario pero **no cierra la sesión**. Se comprobó quién tenía la sesión y se cerró de verdad antes de repetir:

```js
(await clienteSupabase.auth.getSession()).data.session?.user.email   // 'admin.prueba@ejemplo.com'
await clienteSupabase.auth.signOut()
```

Tras el `signOut()`, 0 filas. **Para probar "sin sesión", `signOut()`; recargar no basta.**

## 12. Registro de actividad — los disparadores

La sección 11 abrió la lectura al admin, pero el registro no se rellenaba solo. Esta pieza hace que cada creación o modificación de un fondo, activo o suministro se apunte automáticamente, sin que la página tenga que hacer nada.

### 12.1. Qué es un disparador

Un **disparador** (*trigger*) es una orden que la base de datos ejecuta sola cuando pasa algo en una tabla, como un sensor de movimiento. Tiene dos partes:

1. **Una función:** qué hacer (insertar una fila en el registro).
2. **El disparador:** cuándo hacerlo (después de cada `INSERT` o `UPDATE` en una tabla).

**La clave de seguridad:** el usuario que crea un activo no tiene permiso para escribir en el registro (no hay políticas de `INSERT`, sección 11.1). La función es `SECURITY DEFINER`: se ejecuta con los permisos de su dueño, así que el sistema escribe en nombre del usuario, y solo lo que la función decide. Resultado: nadie puede manipular el registro, pero se rellena solo.

### 12.2. La función

Archivo `supabase/migraciones/013_registro_actividad_disparadores.sql`:

```sql
CREATE FUNCTION privado.apuntar_actividad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, registro_id)
    VALUES (
        auth.uid(),
        CASE TG_OP WHEN 'INSERT' THEN 'CREACION' ELSE 'MODIFICACION' END,
        TG_ARGV[0],
        NEW.id
    );

    RETURN NEW;
END;
$$;
```

- **`RETURNS trigger`:** un tipo especial; solo la puede llamar un disparador.
- **`LANGUAGE plpgsql`:** las funciones anteriores eran una sola consulta (`sql`). Esta hace varias cosas en orden (comprobar, insertar, devolver), así que usa `plpgsql`, el "SQL con pasos", con el cuerpo entre `BEGIN` y `END;`.
- **`NEW`:** la fila tal como queda después del cambio. `NEW.id` es el `id` de la fila creada o modificada.
- **`TG_OP`:** la operación que activó el disparador (`'INSERT'` o `'UPDATE'`). El `CASE` la traduce a las palabras del registro.
- **`TG_ARGV[0]`, la sección como parámetro:** en lugar de una función por tabla, una sola que recibe la sección de cada disparador. Los argumentos de un disparador no se declaran en los paréntesis de la función: llegan por `TG_ARGV`.
- **`RETURN NEW;`:** un disparador debe devolver algo; en uno que va "después", el valor no cuenta, pero la costumbre es devolver `NEW`.

**La trampa prevista: el `IF` inicial.** `perfil_id` es `NOT NULL`. Desde el SQL Editor no hay usuario con sesión y `auth.uid()` es `NULL`: el `INSERT` en el registro fallaría y, como un error deshace todo, también se desharía el cambio en la tabla. El dueño no podría tocar nada desde el SQL Editor. El `IF` deja pasar el cambio sin apuntarlo: lo que hace el dueño con la llave maestra no es actividad de la aplicación.

**Fallos del primer borrador, todos de escritura:** `auth.id()` en lugar de `auth.uid()`; el nombre de la columna (`perfil_id`) dentro de `VALUES`, cuando ahí va el valor (la primera lista son las etiquetas del formulario y `VALUES` lo que se escribe en cada casilla); dos comas que faltaban entre valores; y `TG_ARV` en lugar de `TG_ARGV` (*ARGument Vector*).

### 12.3. El disparador

```sql
CREATE TRIGGER apuntar_actividad_activos
AFTER INSERT OR UPDATE
ON public.activos
FOR EACH ROW
EXECUTE FUNCTION privado.apuntar_actividad('ACTIVOS');
```

- **`AFTER`:** después del cambio, cuando `NEW.id` ya existe.
- **`FOR EACH ROW`:** una vez por cada fila cambiada. Si un `UPDATE` no toca ninguna fila (por ejemplo, porque RLS la oculta), no se dispara.
- **`('ACTIVOS')`:** el valor que llega a `TG_ARGV[0]`. Tiene que coincidir con el `CHECK` de la columna `seccion` (migración 006).

Dos fallos del primer borrador, ambos instructivos:

- **`AFTER 'CREACION' OR 'MODIFICACION'`:** mezclaba dos idiomas. `'CREACION'` es un dato propio (texto entre comillas que se guarda en `accion`); `AFTER` pide operaciones del lenguaje SQL: `INSERT`, `UPDATE`, sin comillas. La traducción de uno a otro la hace el `CASE` de la función.
- **`ON public.registro_actividad`:** el `ON` dice qué tabla se vigila. Un disparador sobre `registro_actividad` que inserta en `registro_actividad` se activaría con su propia inserción, una y otra vez, hasta que Postgres lo cortara con `stack depth limit exceeded`. **Un disparador nunca debe vigilar la tabla en la que escribe.**

### 12.4. Las otras dos tablas: una migración nueva

La 013 ya se había ejecutado, así que los disparadores de `fondos` y `suministros` no se añaden a ella (sección 10.2): van en `014_registro_actividad_disparadores_fondos_suministros.sql`, que solo lleva dos `CREATE TRIGGER`. La función se reutiliza tal cual gracias a `TG_ARGV`:

```sql
CREATE TRIGGER apuntar_actividad_suministros
AFTER INSERT OR UPDATE
ON public.suministros
FOR EACH ROW
EXECUTE FUNCTION privado.apuntar_actividad('SUMINISTROS');

CREATE TRIGGER apuntar_actividad_fondos
AFTER INSERT OR UPDATE
ON public.fondos
FOR EACH ROW
EXECUTE FUNCTION privado.apuntar_actividad('FONDOS');
```

Al copiar un disparador hay tres sitios que cambiar: el nombre, la tabla del `ON` y la sección.

### 12.5. Cómo se probó

Primero, un cambio desde el SQL Editor (`UPDATE public.fondos SET iban = 'ES00 PRUEBA EDITOR SQL' WHERE id = 2;`). Después, desde la consola: el editor crea ACT-005 y modifica ACT-001; el lector intenta modificar ACT-002 (0 filas); el admin modifica el fondo 1, da de alta la luz de ACT-005 y cambia la potencia del suministro de luz de ACT-002. El registro se revisó con:

```js
console.table((await clienteSupabase.from("registro_actividad").select("*")).data)
```

`console.table` dibuja la lista de filas como una tabla, una columna por campo.

| id | Quién | accion | seccion | registro_id |
|---|---|---|---|---|
| 5 | Editor | CREACION | ACTIVOS | 5 (ACT-005) |
| 6 | Editor | MODIFICACION | ACTIVOS | 1 (ACT-001) |
| 7 | Admin | MODIFICACION | FONDOS | 1 |
| 8 | Admin | CREACION | SUMINISTROS | 5 (luz de ACT-005) |
| 9 | Admin | MODIFICACION | SUMINISTROS | 3 (luz de ACT-002) |

- **El editor no puede leer ni escribir el registro, pero sus acciones quedan apuntadas** con su `perfil_id`.
- **El `update` denegado del lector no dejó rastro:** tocó 0 filas, así que el disparador no tuvo con qué dispararse. (Apuntar los intentos denegados, `ACCESO_DENEGADO`, queda para una pieza posterior.)
- **El cambio del SQL Editor se hizo pero no se apuntó:** se comprobó con `select("id, nombre, iban")` que el fondo 2 tenía el IBAN nuevo, y no hay ninguna fila suya en el registro.

### 12.6. Lo que cuentan los `id`

- **Los `id` del registro saltan del 2 al 5:** el 3 y el 4 eran duplicados de prueba borrados con la llave maestra. `IDENTITY` nunca reutiliza un número, así que **un hueco en el registro delata un borrado**.
- **Del 6 al 7 no hay hueco:** si el disparador hubiera intentado apuntar el cambio del SQL Editor y hubiera fallado, habría gastado un número. Salió por el `IF` antes de intentarlo.
- **"FONDO DEL ADMIN" tiene el `id` 6, no el 4:** los intentos de crear fondos denegados del editor y el lector (sección 10.6) gastaron números. `IDENTITY` reparte el número antes de comprobar los permisos; si la fila se rechaza, el número se pierde.
- **Sin `ORDER BY` no hay orden garantizado:** la consulta de fondos devolvió 3, 6, 2, 1; las filas modificadas se fueron al final.

## 13. Registro de actividad — los inicios de sesión

Los disparadores de la sección 12 vigilan cambios en tablas. Entrar en la aplicación no cambia ninguna tabla nuestra, así que `LOGIN`, `LOGOUT` y `ACCESO_DENEGADO` necesitaban otro camino.

### 13.1. La decisión: qué apuntar y desde dónde

La opción sencilla era una función a la que llamara la página al entrar. Pero la página no es una barrera (sección 9.4): un usuario podría entrar sin que su página avisara, o llamar a la función para apuntar entradas falsas. Un registro que depende de que el usuario colabore es "de buena fe".

Se eligió un término medio:

- **`LOGIN`:** desde la propia base de datos, con un disparador sobre las tablas de Supabase Auth. Es lo importante de auditar, y así es fiable.
- **`LOGOUT`:** queda como ampliación. La gente cierra la pestaña sin salir, así que un `LOGOUT` no prueba nada.
- **`ACCESO_DENEGADO`:** queda como ampliación. RLS no da error al denegar una lectura (sección 8): filtra filas, así que no hay nada que capturar sin complicar mucho el sistema.

Supabase restringió en abril de 2025 lo que se puede crear dentro del esquema `auth` (tablas y funciones no), pero mantiene permitidos los disparadores sobre sus tablas. Las funciones siguen en nuestro esquema `privado`.

### 13.2. Primer intento (migración 015): `last_sign_in_at`

`auth.users` tiene una columna, `last_sign_in_at`, que Supabase actualiza en cada inicio de sesión. El disparador vigilaba solo esa columna:

```sql
CREATE TRIGGER apuntar_login
AFTER UPDATE OF last_sign_in_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION privado.apuntar_login();
```

`UPDATE OF columna` hace que salte solo cuando cambia esa columna. La función, `privado.apuntar_login()`, tenía dos diferencias con la de la sección 12:

- **`NEW.id` en lugar de `auth.uid()`:** `last_sign_in_at` no lo cambia el usuario, sino el servicio de Auth mientras procesa el login, cuando todavía no hay sesión. `auth.uid()` sería `NULL`. El usuario que entra es la propia fila que cambia.
- **`IF NOT EXISTS` perfil:** un usuario de `auth.users` puede no tener fila en `perfiles`. El `INSERT` en el registro fallaría (`perfil_id` es una referencia a `perfiles`), el error desharía también la actualización de `auth.users` y **el login fallaría** ("Database error granting user"). Si no hay perfil, se deja pasar sin apuntar.

Los fallos del primer borrador fueron otra vez de idioma: el `CHECK` entero de la tabla dentro de `VALUES` (ese `CHECK` es el menú de valores permitidos, pero en cada fila va uno solo), `auth.users(id)` para referirse al usuario (dentro de un disparador, la fila es `NEW`) y la tabla del registro en el `UPDATE OF` (ahí va una columna de la tabla vigilada).

### 13.3. El fallo: las renovaciones también contaban

La prueba con los tres usuarios dio un `LOGIN` de más: el del admin, 7 segundos antes que el del lector. La pista estaba en cómo se hizo la prueba: se recargó la página con Ctrl+F5.

- **Hipótesis:** la sesión del admin seguía guardada en el navegador (sección 11.4), con el pase caducado. Al cargar, la librería la renovó sola. Si la renovación toca `last_sign_in_at`, el disparador la apunta como `LOGIN`.
- **Comprobación:** con el admin, se forzó una renovación (`await clienteSupabase.auth.refreshSession()`) y apareció otro `LOGIN`. Confirmado, aunque los foros decían lo contrario: **la prueba manda sobre lo que pone en internet**.

El efecto habría sido grave: una pestaña abierta renueva su pase cada hora, así que cada usuario habría generado un `LOGIN` falso por hora. El registro habría contado renovaciones, no entradas.

### 13.4. La corrección (migración 016): una sesión nueva = un login

Supabase guarda cada sesión en `auth.sessions`: al entrar se crea una fila nueva; al renovar el pase, la sesión es la misma y no se crea ninguna. La pregunta correcta no es "¿ha cambiado `last_sign_in_at`?", sino "¿ha nacido una sesión?":

```sql
DROP TRIGGER apuntar_login ON auth.users;

CREATE FUNCTION privado.apuntar_inicio_sesion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id = NEW.user_id) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.registro_actividad (perfil_id, accion)
    VALUES (NEW.user_id, 'LOGIN');

    RETURN NEW;
END;
$$;

CREATE TRIGGER apuntar_inicio_sesion
AFTER INSERT ON auth.sessions
FOR EACH ROW
EXECUTE FUNCTION privado.apuntar_inicio_sesion();

DROP FUNCTION privado.apuntar_login();
```

- **`NEW.user_id`:** en `auth.sessions` cada fila es una sesión, así que `NEW.id` es el id de la sesión. El usuario está en `user_id`. **El `ON` dice de qué tabla viene `NEW`**, y la función y el disparador tienen que hablar de la misma tabla.
- **La plantilla del disparador:** `AFTER <operación de SQL> ON <esquema.tabla>`. En la operación solo caben palabras del SQL (`INSERT`, `UPDATE`, `DELETE`), nunca etiquetas propias como `LOGIN`. En la tabla solo cabe un nombre de tabla, nunca un dato como `NEW.user_id`.
- **El orden de los `DROP`:** la función vieja solo se puede borrar después de quitar el disparador que la usa (`cannot drop function ... because other objects depend on it`).
- **La 015 no se edita:** ya se había ejecutado (sección 10.2). La corrección va en una migración nueva.
- **El aviso del SQL Editor:** ante un `DROP` o un `DELETE`, Supabase avisa con "Potential issue detected". Hay que revisar que cada uno sea intencionado: aquí solo se borraba código (un disparador y una función), ningún dato.
- **Marcha atrás preparada:** como el disparador está dentro del proceso de login, antes de ejecutarlo se tuvo a mano `DROP TRIGGER apuntar_inicio_sesion ON auth.sessions;` por si algún login fallaba.

### 13.5. Cómo se probó

Se recargó con Ctrl+F5 (con el pase del admin caducado desde hacía casi dos horas, el mismo escenario que creó el primer `LOGIN` falso), se entró con lector, editor y admin, y con el admin se forzó un `refreshSession()`:

| Qué | Resultado |
|---|---|
| Ctrl+F5 con sesión guardada caducada | nada apuntado |
| Login del lector | `LOGIN` |
| Login del editor | `LOGIN` |
| Login del admin | `LOGIN` |
| `refreshSession()` | nada apuntado |
| Contraseña equivocada (probado con la 015) | nada apuntado: Supabase responde `400` y no toca nada |

### 13.6. Qué hacer con los `LOGIN` falsos

La 015 dejó dos `LOGIN` falsos en el registro. Había tres opciones: borrarlos (deja un hueco en los `id`, que delata el borrado), dejarlos tal cual (el registro mentiría) o **dejarlos y anotarlos**. Se eligió la tercera, que es lo que se hace en auditoría: no se borra el error, se corrige dejando constancia. Desde el SQL Editor:

```sql
UPDATE public.registro_actividad
SET detalle = '{"nota": "LOGIN falso: renovación del pase, disparador 015 retirado"}'
WHERE id IN (10, 14) AND accion = 'LOGIN';
```

- **`AND accion = 'LOGIN'`:** un seguro de más. Al modificar datos a mano, el `WHERE` lleva una condición que proteja de equivocarse de fila.
- **Es una excepción consciente al append-only:** la regla protege el registro de los usuarios de la aplicación. Esta corrección la hace el dueño con la llave maestra, y no queda apuntada en el registro. Por eso la nota explica qué pasó.
- Se comprobó con un `SELECT ... ORDER BY id`: la nota solo está en esas dos filas. Si se quiere un orden, hay que pedirlo (sección 12.6).

## 14. Registro de actividad — el valor anterior y el nuevo

Con la sección 12, el registro decía "el editor modificó el activo 1", pero no qué cambió. Un auditor necesita saber también qué había antes y qué hay ahora. Esta pieza rellena la columna `detalle` (un `JSONB` creado en la migración 006 y sin usar hasta ahora) con el antes y el después de cada columna modificada:

```json
{"estado": {"antes": "EN OBRA", "despues": "EN VENTA"}}
```

### 14.1. Sustituir una función que ya existe

La función `privado.apuntar_actividad()` de la 013 ya se había ejecutado, así que no se edita ese archivo (sección 10.2). La migración `017_registro_actividad_detalle_cambios.sql` la vuelve a escribir con **`CREATE OR REPLACE FUNCTION`**: sustituye el cuerpo y mantiene el nombre. Sin el `OR REPLACE`, Postgres respondería que la función ya existe.

Los tres disparadores (secciones 12.3 y 12.4) no se tocan: llaman a la función por su nombre y, en cuanto se ejecuta la 017, usan la versión nueva.

### 14.2. La función nueva

```sql
CREATE OR REPLACE FUNCTION privado.apuntar_actividad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    cambios jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT jsonb_object_agg(
            despues.key,
            jsonb_build_object('antes', antes.value, 'despues', despues.value)
        )
        INTO cambios
        FROM jsonb_each(to_jsonb(NEW)) AS despues
        JOIN jsonb_each(to_jsonb(OLD)) AS antes ON antes.key = despues.key
        WHERE antes.value IS DISTINCT FROM despues.value;

        IF cambios IS NULL THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, registro_id, detalle)
    VALUES (
        auth.uid(),
        CASE TG_OP WHEN 'INSERT' THEN 'CREACION' ELSE 'MODIFICACION' END,
        TG_ARGV[0],
        NEW.id,
        cambios
    );

    RETURN NEW;
END;
$$;
```

- **`DECLARE cambios jsonb;`:** en `plpgsql`, las variables se declaran en un bloque `DECLARE` justo antes del `BEGIN`, con la forma `nombre tipo;`. Una variable sin asignar vale `NULL`.
- **`OLD` y `NEW`:** `NEW` es la fila tal como queda y `OLD` como estaba antes. `OLD` solo tiene sentido en un `UPDATE` (en un `INSERT` no hay "antes"), por eso el cálculo va dentro de `IF TG_OP = 'UPDATE'`.
- **`to_jsonb(OLD)`:** convierte la fila entera en un JSON (`{"id": 1, "codigo": "ACT-001", "estado": "EN OBRA", ...}`). Gracias a eso **la misma función sirve para las tres tablas sin nombrar ninguna columna**: si mañana se añade una columna a `activos`, sus cambios se apuntan sin tocar nada.
- **`jsonb_each(...)`:** separa ese JSON en filas de dos columnas, `key` (el nombre de la columna) y `value` (su valor). Convierte una fila en una "tablita" que se puede consultar.
- **El `JOIN` por `key`:** pone lado a lado el antes y el después de cada columna.
- **`WHERE ... IS DISTINCT FROM ...`:** deja solo las columnas que cambiaron. Se usa en lugar de `<>` por los `NULL`: `NULL <> '2026-01-15'` no da verdadero, da `NULL`, y el `WHERE` descartaría la fila. Un dato que se rellena por primera vez (o que se borra) se perdería sin avisar. `IS DISTINCT FROM` trata `NULL` como un valor más.
- **`jsonb_build_object('antes', ..., 'despues', ...)`:** fabrica el par de cada columna.
- **`jsonb_object_agg(clave, valor)`:** junta todas las filas que quedan en un único JSON. **`INTO cambios`** guarda el resultado en la variable.
- **`detalle` en el `INSERT`:** columnas y valores van emparejados por posición, así que `detalle` va al final de la lista de columnas y `cambios` al final de `VALUES`. En una creación, `cambios` nunca se asignó y `detalle` queda `NULL`: la fila nueva entera ya está en su tabla.

### 14.3. La decisión: un guardado sin cambios no se apunta

Un `UPDATE` puede escribir en una fila exactamente lo que ya tenía (por ejemplo, alguien pulsa "Guardar" sin tocar nada). Postgres lo cuenta como modificación y el disparador salta. Se decidió **no apuntarlo**: una modificación que no modifica nada solo mete ruido en el registro, y "solo se apuntan cambios reales" es una regla fácil de defender.

La comprobación aprovecha un detalle de `jsonb_object_agg`: **si no le llega ninguna fila, no devuelve un JSON vacío (`{}`), sino `NULL`**. Por eso la pregunta es `IF cambios IS NULL`: si ninguna columna pasó el `WHERE`, la función sale sin insertar.

### 14.4. Fallos del primer borrador

- **`cambios, jsonb;`:** la coma sobraba. Con ella, Postgres lee dos nombres en vez de un nombre y su tipo.
- **`IF TG_OP = ' UPDATE'`, con un espacio dentro de las comillas:** el más peligroso, porque **no da error**. `' UPDATE'` nunca es igual a `'UPDATE'`, así que el bloque no se habría ejecutado jamás y todo se habría apuntado como antes, sin `detalle`. Solo una prueba lo habría destapado.
- **Las cláusulas en orden inverso** (`FROM` → `JOIN` → `WHERE` → `SELECT` → `INTO`): SQL exige `SELECT` → `INTO` → `FROM` → `JOIN` → `WHERE`.
- **Faltaban el `;` de la consulta y el `END IF;` del `IF TG_OP`:** cada `IF` necesita su `END IF;`, y el `IF cambios IS NULL` va dentro del otro, porque solo tiene sentido después de calcular los cambios. Sangrarlo cuatro espacios más deja ver qué está dentro de qué.

### 14.5. Cómo se probó

Con el editor, desde la consola: cambio del estado de ACT-001 (de EN OBRA a EN VENTA); cambio de dos columnas a la vez (`municipio` y `fecha_compra`); alta de ACT-006. Después, con el admin: el mismo `update` del estado otra vez, sin cambios (respuesta `200` con 1 fila: el `UPDATE` ocurrió). El registro se leyó con:

```js
const { data: filas } = await clienteSupabase.from("registro_actividad").select("*").gt("id", 17).order("id")
filas.forEach(f => console.log(f.id, f.accion, JSON.stringify(f.detalle)))
```

`console.table` corta las columnas largas, así que para ver el `detalle` entero se escribe una línea por fila. `JSON.stringify` convierte el objeto en texto legible (y pinta un `NULL` como `'null'`).

| id | Quién | accion | detalle |
|---|---|---|---|
| 18 | Editor | LOGIN | — |
| 19 | Editor | MODIFICACION | `{"estado":{"antes":"EN OBRA","despues":"EN VENTA"}}` |
| 20 | Editor | MODIFICACION | `{"municipio":{"antes":"Madrid","despues":"Getafe"},"fecha_compra":{"antes":null,"despues":"2026-01-15"}}` |
| 21 | Editor | CREACION | — (ACT-006, `registro_id` 6) |
| 22 | Admin | LOGIN | — |

- **Solo aparecen las columnas que cambiaron:** ni `codigo`, ni `direccion`, ni `creado_en`.
- **`fecha_compra` pasó de `null` a una fecha y se apuntó:** es el caso que un `<>` habría perdido.
- **El guardado sin cambios del admin no dejó rastro:** no hay fila 23.

---

## 15. Registro de actividad — las lecturas mediante funciones

Los disparadores saltan con `INSERT`, `UPDATE` y `DELETE`, pero **en Postgres no existen disparadores de `SELECT`**. Hasta aquí, el registro sabía quién cambió qué, pero no quién miró qué. En una gestora de fondos, saber quién ha visto los datos de un fondo es justo lo que pide un auditor.

### 15.1. La idea: una ventanilla

En lugar de que la página lea las tablas directamente, pide los datos a una **función de la base de datos**, como quien pide en una ventanilla. La función comprueba el permiso, apunta la lectura en `registro_actividad` y devuelve los datos. En la página cambia la forma de pedir:

```js
// Antes: lectura directa de la tabla
await clienteSupabase.from("activos").select("*").eq("id", 1)
// Ahora: a través de la función
await clienteSupabase.rpc("consultar_activo", { activo_id: 1 })
```

`rpc` (*Remote Procedure Call*) significa "ejecuta esta función de la base de datos y dame su resultado".

Se registran dos acciones: **`CONSULTA`** (abrir un registro concreto, con su `registro_id`) y **`BUSQUEDA`** (buscar con un texto, una sola fila por búsqueda, con lo buscado en `detalle`).

### 15.2. La decisión: ventanilla única

Si las políticas de lectura de las secciones 8 y 9 siguen abiertas, cualquiera puede abrir la consola del navegador y leer con `from().select()` sin pasar por la función. El registro de lecturas sería "de buena fe", el mismo problema que se descartó con el `LOGIN` en la sección 13.

Se eligió la **ventanilla única**: cuando estén todas las funciones de lectura, **se retiran las políticas de `SELECT`** y todo pasa por funciones. Como son `SECURITY DEFINER`, pueden leer las tablas aunque RLS las cierre, y por eso la comprobación de permisos se hace dentro de cada función.

La consecuencia: un `UPDATE` que filtra por una columna (`.eq(...)`) o que devuelve filas también necesita la política de lectura. Al retirarla, las escrituras también tendrán que pasar por funciones. El orden es: `consultar_activo` → `buscar_activos` → las mismas para fondos y suministros → cerrar la lectura directa → funciones de escritura. A cambio, el registro no se puede saltar, y la página tiene un catálogo claro de operaciones, que es como se diseña una API.

### 15.3. La primera función: `consultar_activo`

Migración `018_funcion_consultar_activo.sql`:

```sql
CREATE FUNCTION public.consultar_activo(activo_id bigint)
RETURNS SETOF public.activos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    fila public.activos;
BEGIN
    IF NOT privado.tiene_seccion('ACTIVOS') THEN
        RAISE EXCEPTION 'No tienes permiso para consultar activos';
    END IF;

    SELECT * INTO fila FROM public.activos WHERE id = activo_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, registro_id)
    VALUES (
        auth.uid(),
        'CONSULTA',
        'ACTIVOS',
        activo_id
    );

    RETURN NEXT fila;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consultar_activo(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultar_activo(bigint) TO authenticated;
```

- **En `public` y no en `privado`:** `rpc` solo puede llamar a funciones del esquema `public`. Las funciones auxiliares (`tiene_seccion`, `es_admin`) siguen en `privado`, fuera del alcance de la página.
- **`RETURNS SETOF public.activos`:** devuelve un conjunto de filas con la forma de la tabla. La página recibe una lista, igual que con `.select()`: con una fila si el activo existe y vacía si no.
- **`fila public.activos;`:** una variable con la forma de una fila de `activos`, donde se guarda el activo mientras se apunta la consulta. El tipo se escribe solo al declararla; después se usa solo por su nombre.
- **`RAISE EXCEPTION`:** corta la función con un error y deshace todo lo que haya hecho. Sin sesión, `auth.uid()` es nulo y `tiene_seccion` da falso, así que no hace falta una comprobación aparte. Por eso el `INSERT` nunca recibe un `perfil_id` nulo.
- **`SELECT * INTO fila`:** dentro de una función no hay pantalla donde mostrar el resultado; `INTO` lo guarda en la variable. En el `WHERE`, `id` es la columna de la tabla y `activo_id` el número que manda la página.
- **`FOUND`:** después de un `SELECT ... INTO`, Postgres lo pone a verdadero o falso según haya encontrado algo. Si el activo no existe, la función sale **sin apuntar nada**, para no llenar el registro de consultas a ids inexistentes.
- **`RETURN NEXT fila`:** en una función `SETOF`, añade la fila al resultado. Un `RETURN` a secas termina sin añadir nada.
- **`REVOKE` / `GRANT`:** en Supabase, cualquier función de `public` la puede llamar todo el mundo, también sin sesión (el rol `anon`). Aunque la comprobación interna ya lo frenaría, se cierra la puerta desde fuera: solo los usuarios con sesión (`authenticated`) pueden ejecutarla.

### 15.4. Fallos del primer borrador

- **`IF NOT EXISTS THEN`:** `EXISTS` es lo que usa `tiene_seccion` por dentro y siempre necesita una consulta detrás (`EXISTS (SELECT ...)`). Desde fuera basta con llamar a la función, que ya devuelve verdadero o falso.
- **`INTO fila public.activos` y `RETURN NEXT fila public.activos`:** repetían el tipo detrás de la variable.
- **`FROM search_path = ''`:** el `search_path` es un ajuste de la cabecera, no una tabla. Detrás de `FROM` va `public.activos`.
- **`WHERE activo_id = 1`:** confundía la columna (`id`) con el parámetro (`activo_id`), y el `1` fijo habría devuelto siempre el mismo activo.
- **En el `VALUES`:** `perfil_id` (el nombre de la columna) en lugar de su valor, `auth.uid()`; restos del `CASE` de la 017 detrás de `'CONSULTA'`; y la función llamándose a sí misma (`public.consultar_activo(...)`) en lugar del parámetro, lo que habría provocado un bucle sin fin.

### 15.5. Cómo se probó

Desde la consola de `login.html`, con cada usuario de prueba:

| # | Usuario | Petición | Resultado |
|---|---|---|---|
| 1 | Editor (con ACTIVOS) | `activo_id: 1` | 1 fila (ACT-001), `200` |
| 2 | Admin | `activo_id: 999` | `[]`, sin error, `200` |
| 3 | Lector (sin ACTIVOS) | `activo_id: 1` | `400`, código `P0001`, "No tienes permiso para consultar activos" |
| 4 | Admin | `activo_id: 1` | 1 fila (ACT-001), `200` |
| 5 | Admin | lee el registro (`.eq("accion", "CONSULTA")`) | 2 filas de hoy, de perfiles distintos (editor y admin), con `registro_id` 1. Ninguna del lector ni del 999 |
| 6 | Sin sesión (tras `signOut()`) | `activo_id: 1` | `401`, código `42501`, "permission denied for function consultar_activo" |

- **El intento fallido del lector no dejó rastro:** el `RAISE EXCEPTION` deshizo la función entera.
- **Dos capas distintas:** al lector lo frena la comprobación de dentro de la función (`P0001`, mensaje propio); al usuario sin sesión lo frena el `REVOKE` antes de entrar (`42501`, mensaje de Postgres).
- **La política de lectura de la sección 9 sigue abierta** hasta que estén todas las funciones de lectura (sección 15.2).

---

## 16. Registro de actividad — las búsquedas

La segunda ventanilla: la página manda un texto y recibe todos los activos que lo contengan. En el registro queda **una sola fila `BUSQUEDA` por búsqueda**, con lo que se buscó y cuántos resultados salieron:

```js
await clienteSupabase.rpc("buscar_activos", { texto: "Getafe" })
```

```json
{"texto": "Getafe", "resultados": 2}
```

### 16.1. Tres decisiones de diseño

1. **Se busca en `codigo`, `direccion` y `municipio`.** Así "ACT-001", "Ucrania" y "Getafe" encuentran lo esperado.
2. **Las búsquedas sin resultados también se apuntan.** Es al revés que en `consultar_activo`, donde un id inexistente no se apunta, y es a propósito: pedir el activo 999 no dice nada, pero que alguien busque un texto y no encuentre nada sigue diciendo qué intentaba encontrar.
3. **Un texto vacío da error.** Si no, `ILIKE '%%'` encajaría con todos los activos y la búsqueda se convertiría en "dame todo". Si la página necesita un listado completo, será una función aparte, con su propio nombre y su propio registro.

Cada decisión tiene su precio, y se dejó anotado:

- **La búsqueda:** `ILIKE` no ignora las tildes ("Malaga" no encuentra "Málaga"; se resolvería con la extensión `unaccent`). Los textos cortos encajan con mucho ("1"). `%` y `_` funcionan como comodines, así que buscar "%" lo devuelve todo. La referencia catastral queda fuera. Y un `ILIKE '%…%'` no usa índices normales, lo que no importa con este volumen (con decenas de miles de filas, la extensión `pg_trgm`).
- **Apuntar las búsquedas vacías:** el registro crece más. **Consecuencia para la página: buscar al pulsar el botón o Enter, no a cada tecla**, o cada letra de "Getafe" dejaría su fila. El texto buscado queda guardado aunque sea sensible, aunque el registro solo lo lee el admin.
- **El texto vacío:** solo frena "", no "a" ni "%". La defensa real contra alguien que intente sacarlo todo es que **cada búsqueda queda apuntada con su número de resultados**: una búsqueda con 300 resultados salta a la vista.

Mejoras posibles, en una migración futura: escapar `%` y `_`, `unaccent`, una longitud mínima y ordenar los resultados (sección 16.5).

### 16.2. La función

Migración `019_funcion_buscar_activos.sql`:

```sql
CREATE FUNCTION public.buscar_activos(texto text)
RETURNS SETOF public.activos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    resultados integer;
BEGIN
    IF NOT privado.tiene_seccion('ACTIVOS') THEN
        RAISE EXCEPTION 'No tienes permiso para buscar activos';
    END IF;

    IF texto IS NULL OR trim(texto) = '' THEN
        RAISE EXCEPTION 'Escribe un texto para buscar';
    END IF;

    RETURN QUERY
    SELECT * FROM public.activos
    WHERE codigo ILIKE '%' || texto || '%'
    OR direccion ILIKE '%' || texto || '%'
    OR municipio ILIKE '%' || texto || '%';

    GET DIAGNOSTICS resultados = ROW_COUNT;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (
        auth.uid(),
        'BUSQUEDA',
        'ACTIVOS',
        jsonb_build_object('texto', texto, 'resultados', resultados)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_activos(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buscar_activos(text) TO authenticated;
```

Lo que comparte con `consultar_activo` (sección 15.3): la cabecera, la comprobación del permiso y el `REVOKE` / `GRANT`. Lo nuevo:

- **`resultados integer;`:** aquí no hace falta guardar un activo, sino un número, el de resultados.
- **`texto IS NULL OR trim(texto) = ''`:** dos formas de llegar vacío, que no llegue nada o que llegue en blanco. `trim` quita los espacios de los extremos, así que "   " también se rechaza.
- **`ILIKE`:** compara con un patrón en el que `%` significa "cualquier cosa, o nada", así que `'%Getafe%'` es "que contenga Getafe". La `I` es de *insensitive*: no distingue mayúsculas.
- **`'%' || texto || '%'`:** `||` pega textos, y fabrica el patrón a partir de lo que escribió el usuario. Postgres pega antes de comparar, así que no hacen falta paréntesis.
- **`RETURN QUERY`:** añade al resultado todas las filas de la consulta de golpe (`RETURN NEXT` añadía una). **A pesar del nombre, no termina la función**: sigue con la línea siguiente, y el resultado se entrega al llegar al `END`. Por eso al final no hace falta ningún `RETURN`.
- **`GET DIAGNOSTICS resultados = ROW_COUNT`:** lee cuántas filas tocó la última consulta. Va justo después del `RETURN QUERY`: si el `INSERT` fuera antes, `ROW_COUNT` diría 1, la fila del registro.
- **`jsonb_build_object('texto', texto, 'resultados', resultados)`:** funciona por parejas de etiqueta y valor. `'texto'` con comillas es la etiqueta fija; `texto` sin comillas es el valor, lo que se buscó.
- **Sin `registro_id`:** una búsqueda no es sobre un activo concreto, así que la columna no está en la lista y queda nula.

### 16.3. Fallos del primer borrador

- **`IF NOT texto IS NULL OR ...`:** el más peligroso, porque **no da error**. El `NOT` venía copiado de la comprobación del permiso, pero ahí la pregunta es "¿tiene permiso?" (error si no) y aquí es "¿está vacío?" (error si sí). Con el `NOT` se habrían rechazado todas las búsquedas normales. Truco: leer la condición en voz alta.
- **`nombre tipo;`:** el molde de la declaración, copiado literal.
- **`rim(texto)`** por `trim(texto)`, y un resto de `('ACTIVOS')` pegado detrás.
- **`registro_id` en vez de `detalle`** en la lista de columnas del `INSERT`: el JSON habría ido a parar a una columna numérica. Tampoco habría dado error al crear la función, porque **`plpgsql` no comprueba si cada valor encaja en su columna hasta que la función se ejecuta**. Un "Success" al crearla solo dice que está bien escrita.

### 16.4. Cómo se probó

| # | Usuario | `texto` | Resultado |
|---|---|---|---|
| 1 | Editor | `"getafe"` | 1 fila (ACT-001, municipio "Getafe"): no distingue mayúsculas |
| 2 | Editor | `"ACT"` | 6 filas (ACT-001 a ACT-006) |
| 3 | Editor | `"zzz"` | `[]`, sin error |
| 4 | Editor | `" "` | `400`, `P0001`, "Escribe un texto para buscar" |
| 5 | Lector (sin ACTIVOS) | `"getafe"` | `400`, `P0001`, "No tienes permiso para buscar activos" |
| 6 | Admin | lee el registro | 3 filas `BUSQUEDA` del editor (abajo) |
| 7 | Sin sesión | `"getafe"` | `401`, `42501`, "permission denied for function buscar_activos" |

```js
const { data: filas } = await clienteSupabase.from("registro_actividad").select("*").eq("accion", "BUSQUEDA")
filas.forEach(f => console.log(f.id, f.perfil_id, JSON.stringify(f.detalle)))
```

| id | detalle |
|---|---|
| 29 | `{"texto":"getafe","resultados":1}` |
| 30 | `{"texto":"ACT","resultados":6}` |
| 31 | `{"texto":"zzz","resultados":0}` |

- **Los números coinciden** con lo que devolvió cada búsqueda, y la búsqueda sin resultados quedó apuntada con 0.
- **Las pruebas 4 y 5 no dejaron rastro:** el `RAISE EXCEPTION` deshizo la función.
- **ACT-006, con el municipio vacío (`NULL`), salió en la búsqueda de "ACT":** una columna nula no rompe el `OR`, simplemente no encaja.

### 16.5. Un hallazgo de las pruebas: el orden

En la búsqueda de "ACT", **ACT-001 salió el último**. Sin `ORDER BY`, Postgres devuelve las filas en el orden que le conviene, que depende de dónde las guarda: ACT-001 es el activo más modificado, y cada `UPDATE` escribe una versión nueva de la fila más adelante. No es un fallo, pero ordenar los resultados (por ejemplo, `ORDER BY codigo`) queda como mejora. Como la `019` ya está ejecutada, irá en una migración nueva, igual que la 017 sustituyó a la 013 (sección 14.1).

---

## 17. Registro de actividad — las consultas de fondos

La primera ventanilla de la segunda sección. Migración `020_funcion_consultar_fondo.sql`: la misma función que `consultar_activo` (sección 15.3), adaptada a `fondos`:

```js
await clienteSupabase.rpc("consultar_fondo", { fondo_id: 1 })
```

En los datos de un fondo viene el **IBAN**. Era el ejemplo de partida de la sección 15: saber quién ha visto el IBAN de un fondo es lo que pide un auditor. Con esta función, **cada consulta hecha por la ventanilla queda apuntada**. La lectura directa de `fondos` (sección 8) sigue abierta hasta que estén todas las funciones de lectura (sección 15.2): mientras tanto, un `from("fondos").select()` desde la consola todavía lee el IBAN sin dejar rastro.

### 17.1. Lo que cambia respecto a `consultar_activo`

- El nombre de la función y su parámetro: `consultar_fondo(fondo_id bigint)`.
- La forma de la fila: `RETURNS SETOF public.fondos` y `fila public.fondos;`.
- La sección: `tiene_seccion('FONDOS')` y `'FONDOS'` en el registro, con su mensaje propio ("No tienes permiso para consultar fondos").
- El `REVOKE` / `GRANT` apunta a `public.consultar_fondo(bigint)`.

Todo lo demás se queda igual: la comprobación, el `FOUND`, el `INSERT` de `CONSULTA` y el `RETURN NEXT`. Es la ventaja de que todas las ventanillas sigan el mismo molde: **una función nueva se adapta en minutos y se revisa sabiendo dónde mirar**.

### 17.2. Fallos del primer borrador

La función se adaptó a partir de la `018` sin esqueleto. Hubo tres fallos, todos de renombrado:

- **El parámetro seguía llamándose `activo_id`.**
- **`public.fondo`**, sin la *s* de la tabla.
- **`fondo_id_id`:** al aceptar una sugerencia del autocompletado de VS Code con Enter, se duplicó la terminación de la palabra.

Trucos para las próximas: al terminar, **buscar con Ctrl+F la palabra vieja** (`activo`) para comprobar que no queda ningún resto, y **mirar qué propone el autocompletado antes de pulsar Enter**.

### 17.3. Cómo se probó

**Los papeles se invierten respecto a activos:** el lector tiene la sección FONDOS y el editor no.

| # | Usuario | Petición | Resultado |
|---|---|---|---|
| 1 | Lector (con FONDOS) | `fondo_id: 1` | 1 fila (BODEGA DE ALS SL, con su IBAN), `200` |
| 2 | Lector | `fondo_id: 999` | `[]`, sin error, `200` |
| 3 | Editor (sin FONDOS) | `fondo_id: 1` | `400`, `P0001`, "No tienes permiso para consultar fondos" |
| 4 | Admin | `fondo_id: 1` | 1 fila, `200` |
| 5 | Admin | lee el registro (abajo) | 4 filas: 1 de prueba antigua, 2 del lector y 1 del admin (sección 17.4) |
| 6 | Sin sesión (tras `signOut()`) | `fondo_id: 1` | `401`, `42501`, "permission denied for function consultar_fondo" |

```js
const { data: filas } = await clienteSupabase.from("registro_actividad").select("*").eq("accion", "CONSULTA").eq("seccion", "FONDOS")
filas.forEach(f => console.log(f.id, f.perfil_id, f.registro_id))
```

Se filtra también por sección para que no se mezclen las consultas de activos de la sección 15.

### 17.4. Un hallazgo de las pruebas: leer el registro como un auditor

Se esperaban 2 filas (lector y admin) y salieron 4:

| id | Quién | `registro_id` | Qué es |
|---|---|---|---|
| 2 | Lector | `null` | La fila de prueba de la sección 11.3, insertada desde el SQL Editor (`{"nota": "fila de prueba"}`). |
| 35 | Lector | 1 | Consulta del fondo 1 |
| 37 | Lector | 1 | Otra consulta del fondo 1 |
| 40 | Admin | 1 | Consulta del fondo 1 |

Para saber qué pasó entre la 35 y la 37, se leyeron todas las filas desde la 32:

```js
const { data: filas } = await clienteSupabase.from("registro_actividad").select("*").gte("id", 32).order("id")
filas.forEach(f => console.log(f.id, f.accion, f.seccion, f.perfil_id, f.registro_id))
```

**El lector inició sesión dos veces (filas 34 y 36) y consultó el fondo en cada una**: la prueba se repitió sin querer. La función no apunta una consulta por sesión, sino **una por cada llamada**. Si el lector hubiera consultado dos veces en la misma sesión, también habría dos filas. Es lo correcto: cada vez que alguien ve el IBAN, queda apuntado.

- **El intento denegado del editor no dejó rastro**, como en las secciones 15 y 16. Apuntar los accesos denegados (`ACCESO_DENEGADO`) sigue como ampliación.
- **La consulta del fondo 999 tampoco se apuntó** (sección 15.3).

**Una carencia que salió a la luz: el registro guarda ids, no personas.** Aquí se supo quién era cada `perfil_id` porque se sabía en qué orden habían entrado los usuarios de prueba. Un auditor no tiene esa información. Tendría que cruzar cada `perfil_id` con `perfiles`, que el admin sí puede leer (sección 7). Queda como mejora una función o vista para el admin que devuelva el registro con el usuario y su rol ya traducidos.

### 17.5. Pregunta previsible: "¿Por qué un lector ve el IBAN?"

Porque el permiso es por sección, no por columna (como en la sección 9.5): quien tiene FONDOS ve el fondo entero. Ocultar columnas sensibles según el rol sería una ampliación. Lo que sí se consigue ya es que cada consulta por la ventanilla quede apuntada.

---

## 18. Registro de actividad — las búsquedas de fondos

La segunda ventanilla de fondos. Se hizo en dos migraciones:

- **`021_funcion_buscar_fondos.sql`:** la misma función que `buscar_activos` (sección 16.2), adaptada a `fondos`.
- **`022_buscar_fondos_sin_iban.sql`:** corrige un punto débil de la anterior que apareció al revisarla antes del commit (sección 18.5).

```js
await clienteSupabase.rpc("buscar_fondos", { texto: "bodega" })
```

### 18.1. Dos decisiones de diseño

Las tres decisiones de la sección 16.1 se mantienen: se apuntan también las búsquedas sin resultados y un texto vacío da error. Lo que cambia:

1. **Se busca en `nombre` y `cif`. El IBAN se deja fuera a propósito, por dos motivos:**
   - **Seguridad:** si se pudiera buscar por el IBAN, bastaría con ir probando trozos ("ES00", "ES001"…) y mirar cuándo aparece el fondo para reconstruirlo sin haberlo consultado nunca.
   - **Uso real:** buscar por IBAN no es intuitivo. Quien tiene el IBAN ya sabe qué fondo busca. En una empresa, quien lo haría es un departamento concreto, como Facturación. Por eso, si algún día hace falta, irá en una función aparte (por ejemplo, `buscar_fondo_por_iban`) con dos condiciones: un permiso propio para ese departamento y coincidencia exacta del IBAN completo (`=`, no `ILIKE`), para que no se pueda reconstruir a trozos. Hoy el modelo solo tiene roles y secciones, no departamentos, así que queda como ampliación.
2. **Los resultados salen ordenados por nombre (`ORDER BY nombre`) desde el principio.** Es la mejora que se anotó en la sección 16.5. En `buscar_activos` sigue pendiente de una migración nueva.

### 18.2. La función (`021`)

```sql
CREATE FUNCTION public.buscar_fondos(texto text)
RETURNS SETOF public.fondos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    resultados integer;
BEGIN
    IF NOT privado.tiene_seccion('FONDOS') THEN
        RAISE EXCEPTION 'No tienes permiso para buscar fondos';
    END IF;

    IF texto IS NULL OR trim(texto) = '' THEN
        RAISE EXCEPTION 'Escribe un texto para buscar';
    END IF;

    RETURN QUERY
        SELECT * FROM public.fondos
    WHERE nombre ILIKE '%' || texto || '%'
    OR cif ILIKE '%' || texto || '%'
    ORDER BY nombre;

    GET DIAGNOSTICS resultados = ROW_COUNT;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (
        auth.uid(),
        'BUSQUEDA',
        'FONDOS',
        jsonb_build_object('texto', texto, 'resultados', resultados)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_fondos(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buscar_fondos(text) TO authenticated;
```

Respecto a `buscar_activos` cambian el nombre, la tabla (`public.fondos`), la sección (`'FONDOS'`, con su mensaje propio), las columnas del `WHERE` y el `ORDER BY`. El resto se queda igual.

- **El `ORDER BY` va al final de la consulta, después del `WHERE` y antes del `;`.** En SQL las cláusulas tienen un orden fijo: `SELECT … FROM … WHERE … ORDER BY …`.
- **`GET DIAGNOSTICS` sigue contando bien con el `ORDER BY`:** ordenar no cambia cuántas filas hay, solo en qué orden salen.

### 18.3. Fallos del primer borrador

La función se adaptó a partir de la `019` sin esqueleto. Hubo dos fallos, los dos en la consulta:

- **El `ORDER BY` iba antes del `SELECT`.** Es el orden fijo de las cláusulas de la sección 18.2.
- **Faltaba el `;` al final de la consulta.** Una parte de la culpa fue de la explicación ("el `ORDER BY` va justo antes del `;`"): se entendió que el `ORDER BY` sustituía al punto y coma.

### 18.4. Cómo se probó la `021`

**Igual que en la sección 17:** el lector tiene FONDOS y el editor no.

| # | Usuario | `texto` | Resultado |
|---|---|---|---|
| 1 | Lector (con FONDOS) | `"bodega"` | 1 fila (BODEGA DE ALS SL): busca en el nombre |
| 2 | Lector | `"b0000001"` | 1 fila: busca en el CIF y no distingue mayúsculas |
| 3 | Lector | `"SL"` | 4 filas, en orden alfabético por nombre |
| 4 | Lector | `"ES00"` | `[]`, `200`: el IBAN no se busca |
| 5 | Lector | `" "` | `400`, `P0001`, "Escribe un texto para buscar" |
| 6 | Editor (sin FONDOS) | — | `400`, `P0001`, "No tienes permiso para buscar fondos" |
| 7 | Admin | `"bodega"` | 1 fila |
| 8 | Admin | lee el registro (abajo) | 5 filas `BUSQUEDA` de fondos |
| 9 | Sin sesión | — | `401`, "permission denied for function buscar_fondos" |

```js
const { data: filas } = await clienteSupabase.from("registro_actividad").select("*").eq("accion", "BUSQUEDA").eq("seccion", "FONDOS").order("id")
filas.forEach(f => console.log(f.id, f.perfil_id, JSON.stringify(f.detalle)))
```

| id | Quién | detalle |
|---|---|---|
| 43 | Lector | `{"texto":"bodega","resultados":1}` |
| 44 | Lector | `{"texto":"b0000001","resultados":1}` |
| 45 | Lector | `{"texto":"SL","resultados":4}` |
| 48 | Admin | `{"texto":"bodega","resultados":1}` |
| 50 | Lector | `{"texto":"ES00","resultados":0}` |

- **Los números coinciden** con lo que devolvió cada búsqueda.
- **La búsqueda de "ES00" quedó apuntada con 0 resultados.** No encontró nada, pero el intento queda a la vista. Si alguien intentara reconstruir un IBAN a trozos, sus búsquedas quedarían apuntadas aunque fallaran.
- **Las pruebas 5 y 6 no dejaron rastro:** el `RAISE EXCEPTION` deshizo la función, como en la sección 16.4.
- **La fila 50 va después de la 48 porque las pruebas 4 y 5 se repitieron otro día:** la primera vez, las comillas se escribieron dos veces (`""ES00""`), así que el navegador dio un `SyntaxError` y la petición nunca llegó a enviarse.
- **La prueba 4 era válida:** el IBAN de prueba del fondo 1 es `ES00 PRUEBA ADMIN` (comprobado con `consultar_fondo` en la sección 18.6), y "ES00" no aparece en ningún nombre ni CIF.

### 18.5. Un hallazgo antes del commit: la puerta lateral del IBAN

Al revisar la `021` antes de subirla apareció un agujero. **La búsqueda devolvía la fila entera de cada fondo, con su IBAN, y el registro solo guardaba el texto y el número de resultados**: `{"texto":"SL","resultados":4}` dice que alguien vio 4 fondos, pero no cuáles. Buscar "SL" enseñaba 4 IBAN, y buscar "%" (sección 16.1) los enseñaba todos, sin que ninguno quedara apuntado con su fondo.

Eso contradice lo que se consiguió en la sección 17: que cada vez que alguien ve un IBAN, quede apuntado con el id del fondo. Dejar el IBAN fuera de la *búsqueda* (sección 18.1) no servía de mucho si el *resultado* lo entregaba entero.

**La solución es el patrón "lista y ficha":**

- **La búsqueda es la lista:** devuelve solo lo justo para reconocer cada fondo (`id`, `nombre` y `cif`).
- **La consulta es la ficha:** para ver el fondo entero, IBAN incluido, hay que abrirlo con `consultar_fondo`, que apunta el id.

Así **la única forma de ver un IBAN es la ventanilla que lo apunta**.

Se descartó la alternativa de guardar en `detalle` la lista de ids devueltos. Habría dejado constancia, pero cada búsqueda seguiría enseñando IBAN y el registro crecería con cada búsqueda amplia.

Migración `022_buscar_fondos_sin_iban.sql`:

```sql
DROP FUNCTION public.buscar_fondos(text);

CREATE FUNCTION public.buscar_fondos(texto text)
RETURNS TABLE (id bigint, nombre text, cif text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    resultados integer;
BEGIN
    IF NOT privado.tiene_seccion('FONDOS') THEN
        RAISE EXCEPTION 'No tienes permiso para buscar fondos';
    END IF;

    IF texto IS NULL OR trim(texto) = '' THEN
        RAISE EXCEPTION 'Escribe un texto para buscar';
    END IF;

    RETURN QUERY
    SELECT f.id, f.nombre, f.cif
    FROM public.fondos f
    WHERE f.nombre ILIKE '%' || texto || '%'
    OR f.cif ILIKE '%' || texto || '%'
    ORDER BY f.nombre;

    GET DIAGNOSTICS resultados = ROW_COUNT;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (
        auth.uid(),
        'BUSQUEDA',
        'FONDOS',
        jsonb_build_object('texto', texto, 'resultados', resultados)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_fondos(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buscar_fondos(text) TO authenticated;
```

Lo nuevo respecto a la `021`:

- **`DROP FUNCTION` antes del `CREATE`:** `CREATE OR REPLACE` no permite cambiar lo que devuelve una función, así que hay que borrarla y crearla de nuevo. En el `DROP` basta con el tipo del parámetro, `(text)`. El SQL Editor avisa con "Potential issue detected", y aquí es intencionado.
- **`RETURNS TABLE (id bigint, nombre text, cif text)`:** en vez de "filas con la forma de `fondos`", la función anuncia exactamente qué columnas devuelve. Los tipos tienen que coincidir con los de la tabla (migración `001`); si no, falla al ejecutarse (`42804`).
- **`SELECT f.id, f.nombre, f.cif`:** ya no vale `*`, que traería también el IBAN y `creado_en`. **El `SELECT` dice qué se enseña; el `WHERE`, dónde se busca.**
- **El alias `f`:** las columnas de `RETURNS TABLE` pasan a ser también variables dentro de la función. Si se escribe `nombre` sin más, Postgres no sabe si es la columna de la tabla o la variable, y da `42702` ("column reference is ambiguous"). `FROM public.fondos f` le pone un apodo a la tabla, y `f.nombre` dice de cuál se trata.
- **El `REVOKE` y el `GRANT` se repiten:** los permisos van pegados a la función, y el `DROP` se los lleva con ella.

Fallos del primer borrador de la `022`:

- **El `DROP` y el `CREATE` estaban fundidos en una sola orden:** faltaban el `;` y el `CREATE FUNCTION`.
- **`FROM (FROM public.fondos f)`, sin `SELECT`.**
- **Las tres columnas iban en el `WHERE` en lugar del `SELECT`**, con `f.id ILIKE …`. La función se habría creado sin queja y habría fallado en la primera búsqueda: `id` es un número, e `ILIKE` solo compara textos ("operator does not exist: bigint ~~* text"). Además, habría cambiado la regla, porque buscar por id no estaba decidido.

### 18.6. Cómo se probó la `022`

Antes de las pruebas, el lector abrió el fondo 1 con `consultar_fondo` para ver su IBAN: `ES00 PRUEBA ADMIN`.

| # | Usuario | `texto` | Resultado |
|---|---|---|---|
| 1 | Lector | `"bodega"` | 1 fila: `{id: 1, nombre: 'BODEGA DE ALS SL', cif: 'B0000001'}`. **Solo tres columnas, sin `iban` ni `creado_en`** |
| 2 | Lector | `"b0000001"` | 1 fila |
| 3 | Lector | `"SL"` | 4 filas, en orden: BODEGA DE ALS SL, CRISTALES DIEGO SL, FONDO DEL ADMIN SL, RUBENFNANOMACHINE SL |
| 4 | Lector | `"ES00 PRUEBA ADMIN"` | `[]`, `200`: el IBAN completo no encuentra nada |
| 5 | Lector | `" "` | `400`, `P0001`, "Escribe un texto para buscar" |
| 6 | Lector | `"%"` | Los 4 fondos, **sin IBAN**: el comodín sigue funcionando, pero la puerta lateral está cerrada |
| 7 | Editor (sin FONDOS) | `"bodega"` | `400`, `P0001`, "No tienes permiso para buscar fondos" |
| 8 | Admin | `"bodega"` | 1 fila, también con tres columnas |
| 9 | Admin | lee el registro (abajo) | 6 filas nuevas |
| 10 | Sin sesión (tras `signOut()`) | `"bodega"` | `401`, `42501`, "permission denied for function buscar_fondos" |

```js
const { data: filas } = await clienteSupabase.from("registro_actividad").select("*").eq("accion", "BUSQUEDA").eq("seccion", "FONDOS").gt("id", 50).order("id")
filas.forEach(f => console.log(f.id, f.perfil_id, JSON.stringify(f.detalle)))
```

El `.gt("id", 50)` deja fuera las filas de la `021`.

| id | Quién | detalle |
|---|---|---|
| 54 | Lector | `{"texto":"bodega","resultados":1}` |
| 55 | Lector | `{"texto":"b0000001","resultados":1}` |
| 56 | Lector | `{"texto":"SL","resultados":4}` |
| 57 | Lector | `{"texto":"ES00 PRUEBA ADMIN","resultados":0}` |
| 58 | Lector | `{"texto":"%","resultados":4}` |
| 61 | Admin | `{"texto":"bodega","resultados":1}` |

- **El registro funciona igual que con la `021`:** cambiar lo que devuelve la función no ha tocado lo que apunta.
- **Las pruebas 5 y 7 no dejaron rastro**, como siempre que salta un `RAISE EXCEPTION`.
- **Por qué se buscó el IBAN completo y no un trozo:** "ADMIN" está en el IBAN de prueba y también en el nombre "FONDO DEL ADMIN SL". Buscar "ADMIN" habría devuelto el fondo 6 por su nombre, y habría parecido que la búsqueda miraba el IBAN. **Un trozo de prueba tiene que estar en la columna que se quiere comprobar y en ninguna otra.**

### 18.7. Lo que queda abierto

- **El texto buscado se guarda tal cual.** La fila 57 lo demuestra: el IBAN escrito en el buscador ha quedado en el registro, aunque la búsqueda no encontró nada. Solo lo lee el admin, pero es un dato sensible guardado por un descuido del usuario.
- **`%` y `_` siguen funcionando como comodines** (sección 16.1). Con la `022` la búsqueda "%" ya solo enseña nombres y CIF, pero escaparlos sigue pendiente.
- **`buscar_activos` sigue devolviendo la fila entera.** Hay que decidir si los activos tienen algún dato que merezca el mismo trato que el IBAN.

### 18.8. Pregunta previsible: "¿Por qué una función por tabla y no una búsqueda genérica?"

Una función genérica tendría que recibir el nombre de la tabla como texto y montar la consulta con él (SQL dinámico), que es justo la puerta a la inyección de SQL. Además, cada tabla busca en sus propias columnas, tiene su propio permiso y decide qué enseña: la `022` no tendría sentido en una función común. Repetir el molde es a propósito (sección 17.1): cada ventanilla se lee entera sin saltar a otro sitio.

---

## 19. Registro de actividad — las consultas de suministros

La primera ventanilla de la tercera sección. Migración `023_funcion_consultar_suministro.sql`: la misma función que `consultar_fondo` (sección 17), adaptada a `suministros`:

```js
await clienteSupabase.rpc("consultar_suministro", { suministro_id: 1 })
```

Como en fondos, **la lectura directa de `suministros` (sección 9) sigue abierta** hasta que estén todas las funciones de lectura. Antes de las pruebas, el lector listó los 5 suministros con sus CUPS mediante `from("suministros").select("id, tipo, cups")`, y esa lectura no dejó rastro en el registro.

### 19.1. Lo que cambia respecto a `consultar_fondo`

- El nombre de la función y su parámetro: `consultar_suministro(suministro_id bigint)`.
- La forma de la fila: `RETURNS SETOF public.suministros` y `fila public.suministros;`.
- La sección: `tiene_seccion('SUMINISTROS')` y `'SUMINISTROS'` en el registro, con su mensaje propio ("No tienes permiso para consultar suministros").
- El `WHERE`: `WHERE id = suministro_id`.
- El `REVOKE` / `GRANT` apunta a `public.consultar_suministro(bigint)`.

**El nombre del parámetro no es un detalle.** La tabla `suministros` tiene una columna `activo_id`, que es el activo al que pertenece cada suministro. Si el parámetro se hubiera llamado así, como en `consultar_activo` (sección 15.3), `WHERE id = activo_id` sería ambiguo: Postgres no sabría si es la columna o el parámetro, y daría `42702`, el mismo error que se evitó con el alias en la sección 18.5. Por eso esta función se adaptó a partir de `consultar_fondo` y no de `consultar_activo`.

Es **la primera ventanilla que salió sin fallos en el primer borrador.**

### 19.2. Cómo se probó

**Los papeles son como en fondos:** el lector tiene la sección SUMINISTROS y el editor no.

| # | Usuario | Petición | Resultado |
|---|---|---|---|
| 1 | Lector (con SUMINISTROS) | `suministro_id: 1` | 1 fila (LUZ, CUPS `ES0021000000000001AA`, activo 1), `200` |
| 2 | Lector | `suministro_id: 999` | `[]`, sin error, `200` |
| 3 | Editor (sin SUMINISTROS) | `suministro_id: 999` | `400`, `P0001`, "No tienes permiso para consultar suministros" |
| 4 | Admin | `suministro_id: 1` | 1 fila, `200` |
| 5 | Admin | lee el registro (abajo) | 2 filas `CONSULTA`/`SUMINISTROS` |
| 6 | Sin sesión (tras `signOut()`) | `suministro_id: 999` | `401`, `42501`, "permission denied for function consultar_suministro" |

**Las pruebas 3 y 6 se hicieron con el id 999, y valen igual.** El editor se queda en la comprobación del permiso, que va antes de buscar el suministro. Sin sesión ni siquiera se llega a ejecutar la función, porque lo frena el `REVOKE`. En ninguno de los dos casos importa qué id se pida.

```js
const { data: filas } = await clienteSupabase.from("registro_actividad").select("*").eq("accion", "CONSULTA").eq("seccion", "SUMINISTROS").order("id")
filas.forEach(f => console.log(f.id, f.perfil_id, f.registro_id))
```

| id | Quién | `registro_id` |
|---|---|---|
| 63 | Lector | 1 |
| 67 | Admin | 1 |

- **Una fila por cada consulta real.** Ni el 999 ni el intento del editor dejaron rastro.
- **El registro no inventa nada.** En la primera ronda, el admin leyó el registro sin haber consultado antes el suministro, y salió una sola fila, la del lector. Hubo que repetir la prueba 4 para que apareciera la 67. Si falta una fila, es que falta una llamada.

### 19.3. Pregunta previsible: "El lector no tiene ACTIVOS, pero ve a qué activo pertenece el suministro"

Es cierto: la fila trae `activo_id: 1`. Pero solo es un número, una referencia. Para ver el activo (dirección, municipio, estado…) habría que pedirlo con `consultar_activo`, y el lector no tiene permiso. Es el mismo criterio que en la sección 17.5: **el permiso es por sección, no por columna**, y quien tiene SUMINISTROS ve el suministro entero, con su referencia al activo incluida.

---

## 20. Registro de actividad — las búsquedas de suministros

La segunda ventanilla de suministros. Migración `024_funcion_buscar_suministros.sql`. Con ella, **las tres secciones (activos, fondos y suministros) tienen ya su ventanilla de consulta y la de búsqueda**.

```js
await clienteSupabase.rpc("buscar_suministros", { texto: "1aa" })
```

### 20.1. Tres decisiones de diseño

1. **Se busca solo en `cups`.**
   - `tipo` solo puede ser LUZ o GAS: buscar "luz" no sería una búsqueda, sino un filtro que devuelve todos los de luz. Si hace falta, irá en una función aparte.
   - `activo_id` y la potencia son números, e `ILIKE` solo compara textos.
2. **Devuelve solo `id`, `tipo` y `cups`, aunque en `suministros` no haya nada tan delicado como el IBAN.** Es la regla de lista y ficha de la sección 18.5, aplicada a todas las ventanillas: **la búsqueda da la lista; la consulta da la ficha completa y queda apuntada con su id**. Una sola regla es más fácil de explicar y de defender que "depende de la tabla".
   - La consecuencia es que `buscar_activos` (sección 16) queda como excepción, porque sigue devolviendo la fila entera. Se recortará en una migración aparte, y así se cierra la duda de la sección 18.7.
3. **Los resultados salen ordenados por CUPS (`ORDER BY s.cups`).**

### 20.2. La función

```sql
CREATE FUNCTION public.buscar_suministros(texto text)
RETURNS TABLE (id bigint, tipo text, cups text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    resultados integer;
BEGIN
    IF NOT privado.tiene_seccion('SUMINISTROS') THEN
        RAISE EXCEPTION 'No tienes permiso para buscar suministros';
    END IF;

    IF texto IS NULL OR trim(texto) = '' THEN
        RAISE EXCEPTION 'Escribe un texto para buscar';
    END IF;

    RETURN QUERY
    SELECT s.id, s.tipo, s.cups
    FROM public.suministros s
    WHERE s.cups ILIKE '%' || texto || '%'
    ORDER BY s.cups;

    GET DIAGNOSTICS resultados = ROW_COUNT;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (
        auth.uid(),
        'BUSQUEDA',
        'SUMINISTROS',
        jsonb_build_object('texto', texto, 'resultados', resultados)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_suministros(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buscar_suministros(text) TO authenticated;
```

Se adaptó a partir de la `022`, que ya tenía la forma de lista. Lo que cambia:

- **Sin `DROP`:** la función no existía, así que se crea directamente. Con la primera línea de la `022`, Postgres habría dado error al intentar borrar algo que no existe.
- **`RETURNS TABLE (id bigint, tipo text, cups text)`**, con los tipos de la migración `003`.
- **El alias pasa a ser `s`**, y el `WHERE` tiene una sola condición, sin `OR`.
- **La trampa del `42702` sigue presente, ahora con `tipo`:** está en el `RETURNS TABLE` y también es una columna de la tabla. Con `s.tipo` en todas partes no hay choque.

### 20.3. Fallo del primer borrador

- **`nombre` en lugar de `tipo`**, en el `RETURNS TABLE` y en el `SELECT` (`s.nombre`). Era un resto de fondos: `suministros` no tiene columna `nombre`.
- Igual que en la sección 18.5, **la función se habría creado sin queja** y habría fallado en la primera búsqueda con `42703` ("column s.nombre does not exist").
- **El truco de la sección 17.2 no lo detecta.** Buscar con Ctrl+F la palabra vieja (`fondo`) encuentra los restos del nombre de la tabla, pero no las columnas que solo existían allí. Se añade un paso: **comparar cada columna escrita con la migración que creó la tabla** (aquí, la `003`).

### 20.4. Cómo se probó

Los CUPS de prueba son 4 de luz que empiezan por `ES0021…` (terminan en AA, CC, DD y EE) y uno de gas, `ES0217…01BB`.

| # | Usuario | `texto` | Resultado |
|---|---|---|---|
| 1 | Lector (con SUMINISTROS) | `"1aa"` | 1 fila: `{id: 1, tipo: 'LUZ', cups: 'ES0021000000000001AA'}`. **Solo tres columnas**, y no distingue mayúsculas |
| 2 | Lector | `"ES0021"` | 4 filas, en orden: …AA, …CC, …DD, …EE. El de gas no sale |
| 3 | Lector | `"luz"` | `[]`, `200`: el tipo no se busca |
| 4 | Lector | `" "` | `400`, `P0001`, "Escribe un texto para buscar" |
| 5 | Lector | `"%"` | Los 5 suministros, con tres columnas. El de gas sale el último (`ES02…` va detrás de `ES00…`) |
| 6 | Editor (sin SUMINISTROS) | `"1aa"` | `400`, `P0001`, "No tienes permiso para buscar suministros" |
| 7 | Admin | `"1aa"` | 1 fila, también con tres columnas |
| 8 | Admin | lee el registro (abajo) | 5 filas `BUSQUEDA`/`SUMINISTROS` |
| 9 | Sin sesión (tras `signOut()`) | `"1aa"` | `401`, `42501`, "permission denied for function buscar_suministros" |

```js
const { data: filas } = await clienteSupabase.from("registro_actividad").select("*").eq("accion", "BUSQUEDA").eq("seccion", "SUMINISTROS").order("id")
filas.forEach(f => console.log(f.id, f.perfil_id, JSON.stringify(f.detalle)))
```

| id | Quién | detalle |
|---|---|---|
| 69 | Lector | `{"texto":"1aa","resultados":1}` |
| 70 | Lector | `{"texto":"ES0021","resultados":4}` |
| 71 | Lector | `{"texto":"luz","resultados":0}` |
| 72 | Lector | `{"texto":"%","resultados":5}` |
| 78 | Admin | `{"texto":"1aa","resultados":1}` |

- **La prueba 3 sigue la lección de la sección 18.6:** "luz" no aparece en ningún CUPS, así que si hubiera salido algo, solo podía ser por el tipo.
- **Las pruebas 4 y 6 no dejaron rastro**, como siempre que salta un `RAISE EXCEPTION`.
- **Como en la sección 19.2, la búsqueda del admin se saltó en la primera ronda** y el registro mostró solo las 4 filas del lector. Desde entonces, los comandos del admin se preparan en un único bloque y en orden: primero la llamada, después la lectura del registro y, al final, `signOut()`.

### 20.5. Preguntas previsibles

**"La lista enseña el CUPS completo. ¿No es lo mismo que pasaba con el IBAN?"**

No del todo. Es cierto que una búsqueda de "%" enseña los 5 CUPS y que el registro solo apunta `resultados: 5`, sin decir cuáles. Pero los dos datos cumplen papeles distintos:

- **El CUPS es el identificador del suministro.** Cumple el mismo papel que el nombre y el CIF en fondos: es el dato por el que se busca y con el que se reconoce cada suministro, y aparece en todas las facturas.
- **El IBAN es un dato financiero:** con él se pueden domiciliar cobros. Por eso solo se ve en la ficha, que queda apuntada.

Un matiz: cuando el titular de un suministro es una persona física, el CUPS se suele considerar dato personal (RGPD). En este proyecto los titulares son activos de fondos, es decir, empresas. Si algún día hubiera titulares particulares, habría que revisar si el CUPS debe salir de la lista.

**"¿Cómo encuentro los suministros de un activo concreto?"**

Hoy no se puede: la búsqueda solo mira el CUPS, y la lista no incluye `activo_id`. Para saber de qué activo es cada suministro hay que abrir la ficha con `consultar_suministro`.

Es a propósito. Buscar suministros por la dirección o el municipio del activo mezclaría dos secciones: un usuario con SUMINISTROS pero sin ACTIVOS acabaría consultando datos de activos a través de la búsqueda. La ampliación natural sería una función `suministros_de_activo(activo_id)` que exija las dos secciones y apunte la consulta.

**Pendientes que se arrastran:** los comodines `%` y `_` y los textos muy cortos (sección 16.1), y que el texto buscado se guarda tal cual (sección 18.7). Aquí pesan menos, porque la búsqueda solo devuelve la lista.

---

## 21. Registro de actividad — `buscar_activos` pasa a devolver solo la lista

Migración `025_buscar_activos_solo_lista.sql`. La `019` (sección 16) devolvía la fila entera de cada activo: referencia catastral, fondo, estado y fechas. Era la única búsqueda que no seguía la regla de lista y ficha (sección 20.1). Con esta migración, **las tres búsquedas funcionan igual**: dan la lista, y la ficha completa solo se ve con la consulta, que queda apuntada con su id.

### 21.1. Qué columnas devuelve y por qué

`id`, `codigo`, `direccion` y `municipio`. Hubo dudas con el municipio, y se mantiene por tres motivos:

- **Se busca por él, y lo que se busca, se ve.** Si alguien busca "Getafe" y no ve el municipio en la lista, no sabría por qué ha salido cada activo.
- **Las direcciones se repiten entre municipios.** La columna `direccion` no lleva el municipio (migración `002`).
- **No es un dato delicado.**

Quitarlo solo sería coherente si también se dejara de buscar por municipio, y se descartó porque "¿qué tenemos en Getafe?" es una pregunta habitual.

### 21.2. La función

```sql
DROP FUNCTION public.buscar_activos(text);

CREATE FUNCTION public.buscar_activos(texto text)
RETURNS TABLE (id bigint, codigo text, direccion text, municipio text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    resultados integer;
BEGIN
    IF NOT privado.tiene_seccion('ACTIVOS') THEN
        RAISE EXCEPTION 'No tienes permiso para buscar activos';
    END IF;

    IF texto IS NULL OR trim(texto) = '' THEN
        RAISE EXCEPTION 'Escribe un texto para buscar';
    END IF;

    RETURN QUERY
    SELECT a.id, a.codigo, a.direccion, a.municipio
    FROM public.activos a
    WHERE a.codigo ILIKE '%' || texto || '%'
    OR a.direccion ILIKE '%' || texto || '%'
    OR a.municipio ILIKE '%' || texto || '%'
    ORDER BY a.codigo;

    GET DIAGNOSTICS resultados = ROW_COUNT;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (
        auth.uid(),
        'BUSQUEDA',
        'ACTIVOS',
        jsonb_build_object('texto', texto, 'resultados', resultados)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_activos(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buscar_activos(text) TO authenticated;
```

Es la estructura de la `022` con los datos de la `019`:

- **`DROP` y luego `CREATE`**, como en la `022`, porque la función ya existía y cambia lo que devuelve (sección 21.5).
- **Alias `a`** en todas las columnas del `SELECT`, del `WHERE` y del `ORDER BY`. Los cuatro nombres del `RETURNS TABLE` coinciden con columnas de la tabla, así que sin el alias saldría el `42702` (sección 18.5).
- **`ORDER BY a.codigo`.** Con esto se cierra la mejora de la sección 16.5: en las pruebas de la `019`, ACT-001 salía la última.

### 21.3. Fallos del primer borrador

- **Un punto en lugar de una coma** en el `RETURNS TABLE`: `direccion text. municipio text`. Postgres lo habría rechazado al ejecutar con un error de sintaxis.
- **`'FONDOS'` en la sección del registro.** Era un resto de la `022`, y es el más peligroso de los dos: **no da error**. La función habría funcionado, pero cada búsqueda de activos habría quedado apuntada como de fondos, y el registro habría mentido. El Ctrl+F con la palabra vieja (sección 17.2) lo encuentra. Por eso es un paso que no se puede saltar.

Los dos se corrigieron antes de ejecutar. Las columnas se comprobaron contra la `002`, como pide la sección 20.3.

### 21.4. Cómo se probó

Ejecutada en el SQL Editor: *"Success. No rows returned"*. **Los papeles son los de activos:** el editor tiene la sección ACTIVOS y el lector no. Los datos de prueba son ACT-001 a ACT-006; ACT-001 está en Getafe y ACT-006 no tiene municipio.

| # | Usuario | `texto` | Resultado |
|---|---|---|---|
| 1 | Editor (con ACTIVOS) | `"getafe"` | 1 fila: `{id: 1, codigo: 'ACT-001', direccion: 'Ronda de Ucrania y Eslava 88', municipio: 'Getafe'}`. **Solo cuatro columnas** |
| 2 | Editor | `"ACT"` | 6 filas, **en orden de ACT-001 a ACT-006** |
| 3 | Editor | `"%"` | Las mismas 6 filas, con cuatro columnas |
| 4 | Editor | `" "` | `400`, `P0001`, "Escribe un texto para buscar" |
| 5 | Lector (sin ACTIVOS) | `"ACT"` | `400`, `P0001`, "No tienes permiso para buscar activos" |
| 6 | Admin | `"ACT"` | 6 filas |
| 7 | Admin | lee el registro (abajo) | 4 filas nuevas `BUSQUEDA`/`ACTIVOS` |
| 8 | Sin sesión (tras `signOut()`) | `"ACT"` | `401`, `42501`, "permission denied for function buscar_activos" |

```js
const { data: filas } = await clienteSupabase.from("registro_actividad").select("*").eq("accion", "BUSQUEDA").eq("seccion", "ACTIVOS").order("id")
filas.forEach(f => console.log(f.id, f.perfil_id, JSON.stringify(f.detalle)))
```

| id | Quién | detalle |
|---|---|---|
| 29 | Editor | `{"texto":"getafe","resultados":1}` (pruebas de la `019`) |
| 30 | Editor | `{"texto":"ACT","resultados":6}` (pruebas de la `019`) |
| 31 | Editor | `{"texto":"zzz","resultados":0}` (pruebas de la `019`) |
| 80 | Editor | `{"texto":"getafe","resultados":1}` |
| 81 | Editor | `{"texto":"ACT","resultados":6}` |
| 82 | Editor | `{"texto":"%","resultados":6}` |
| 85 | Admin | `{"texto":"ACT","resultados":6}` |

- **Las filas 29 a 31 son de las pruebas de la `019`** (sección 16). El registro no se borra al cambiar la función: guarda la historia completa.
- **Las pruebas 4 y 5 no dejaron rastro**, como siempre que salta un `RAISE EXCEPTION`.
- **ACT-006 sale en "ACT" y en "%" aunque su municipio sea nulo.** Una columna nula no rompe el `OR`, simplemente no encaja (sección 16.4).
- **La página no usa todavía `buscar_activos`**, así que cambiar lo que devuelve no rompe nada.

### 21.5. Preguntas previsibles

**"¿Por qué `DROP` y `CREATE`, y no `CREATE OR REPLACE`?"**

Porque `CREATE OR REPLACE` no permite cambiar lo que devuelve una función: pasar de la fila entera (`SETOF public.activos`) a cuatro columnas da el error `42P13` ("cannot change return type of existing function"). Hay que borrarla y crearla de nuevo. Al borrarla se pierden sus permisos, y por eso se repiten el `REVOKE` y el `GRANT` al final.

**"¿Y si alguien la llama justo entre el `DROP` y el `CREATE`?"**

El SQL Editor envía el archivo entero en una sola petición, y Postgres ejecuta así un bloque de varias sentencias como una única transacción: se aplica entero o no se aplica. Nadie puede encontrarse la función a medias. En un proyecto real se escribirían `BEGIN;` y `COMMIT;` explícitos para que quede claro sin depender de cómo se ejecuta el archivo.

**"Con `%` se saca la lista de todos los activos."**

Es cierto, pero solo la lista (código, dirección y municipio), no la ficha. Y queda apuntado: la fila 82 dice `{"texto":"%","resultados":6}`. Un auditor vería que alguien listó todos los activos, y para abrir cualquier ficha habría que pasar por `consultar_activo`, que apunta qué activo se miró.

**El punto débil que queda: la puerta del almacén sigue abierta.** Las políticas de lectura de las secciones 8 y 9 siguen activas. Cualquiera con la sección ACTIVOS puede saltarse la ventanilla con `from("activos").select("*")` y leerlo todo sin dejar rastro. Ahora que las tres secciones tienen su consulta y su búsqueda, **el siguiente paso es cerrar la lectura directa** y comprobar qué se rompe (sección 15.2). Es la pieza que hace que el registro de lecturas no se pueda saltar.

---

## 22. Registro de actividad — se cierra la lectura directa

Hasta aquí había **dos caminos para leer** activos, fondos y suministros: las ventanillas (secciones 15 a 21), que apuntan cada lectura, y la lectura directa con `from(...).select()`, abierta por las políticas de las secciones 8 y 9, que no deja rastro. Con la migración `026_cerrar_lectura_directa.sql` se cierra la lectura directa y **solo queda la ventanilla**. Es el paso que hace defendible la decisión de la sección 15.2.

Se hizo en cuatro fases: una foto del antes, la migración, las pruebas con hipótesis apuntadas de antemano y la interpretación.

### 22.1. La foto del antes

Antes de cambiar nada, el editor:

- Leyó `activos` directamente con `from("activos").select("*")`: **las 6 filas completas**, con `referencia_catastral`, `fondo_id`, `estado` y las fechas, justo lo que la `025` quitó de la búsqueda.
- Modificó ACT-004 de `COMPRA` a `EN OBRA`: 1 fila.

El registro, leído por el admin desde la fila 86:

| id | Quién | Acción | Detalle |
|---|---|---|---|
| 86 | Editor | `LOGIN` | — |
| 87 | Editor | `MODIFICACION` / `ACTIVOS` / 4 | `{"estado":{"antes":"COMPRA","despues":"EN OBRA"}}` |
| 88 | Admin | `LOGIN` | — |

**La lectura no dejó ninguna fila.** El editor vio los seis activos enteros y el registro no se enteró. Es la demostración de que la puerta estaba abierta.

### 22.2. La migración

```sql
DROP POLICY "Lectura de fondos por sección" ON public.fondos;
DROP POLICY "Lectura de activos por sección" ON public.activos;
DROP POLICY "Lectura de suministros por sección" ON public.suministros;
```

- **El nombre tiene que coincidir carácter por carácter**, tilde incluida. Se comprobó byte a byte contra la `009` y la `010`: una tilde puede verse igual en pantalla y estar guardada de otra forma, y entonces Postgres diría que la política no existe.
- **El nombre va entre comillas dobles**, porque es un nombre de objeto, no un texto.

**Lo que no se tocó:**
- **`privado.tiene_seccion`**, aunque nació en la misma `009`: la usan todas las ventanillas. Se borra la política, no la función.
- **Las políticas de `perfiles`** (secciones 6 y 7): el saludo del login las necesita.
- **La lectura del registro por el admin** (sección 11).
- **Las políticas de escritura** (sección 10), para ver qué les pasaba.

Tras ejecutarla, se comprobó qué políticas quedaban:

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
```

Quedaron 9: `activos`, `fondos` y `suministros`, solo con su `INSERT` y su `UPDATE`; `perfiles`, con sus dos de `SELECT`; `registro_actividad`, con la suya. **Ningún `SELECT` en las tres tablas de datos.**

### 22.3. Las hipótesis

Se apuntaron antes de probar:

| Qué se prueba | Qué se espera | Por qué |
|---|---|---|
| Lectura directa | `[]`, **sin error** | Sin política que lo permita, RLS no da error: devuelve cero filas |
| Las ventanillas | Siguen funcionando | Son `SECURITY DEFINER`: se ejecutan con los permisos del dueño de las tablas, que no pasa por RLS |
| Crear (`insert` sin `.select()`) | Funciona | Crear no necesita leer |
| Modificar (`update().eq(...)`) | **0 filas, sin error** | Para encontrar la fila del `.eq`, el `UPDATE` necesita poder leerla (sección 15.2) |

**El diseño de la última prueba tiene truco.** Si el `update` se hace con `.select()` y sale `[]`, no se sabe si es porque no modificó nada o porque no puede devolver lo modificado (devolver también es leer). Por eso se hizo **sin `.select()`**, y después se comprobó el resultado con la ventanilla.

### 22.4. Cómo se probó

| # | Usuario | Prueba | Resultado |
|---|---|---|---|
| 1 | Editor | `from("activos").select("*")` | `[]`, `error: null` |
| 2 | Editor | `consultar_activo(1)` | 1 fila (ACT-001) |
| 3 | Editor | `buscar_activos("ACT")` | 6 filas |
| 4 | Editor | Crear ACT-007 con `insert` | `error: null`, creado con id 7 |
| 5 | Editor | ACT-004 de vuelta a `COMPRA` con `update`, sin `.select()` | `error: null` |
| 6 | Editor | `consultar_activo(4)` | **Estado `EN OBRA`: el paso 5 no cambió nada** |
| 7 | Lector | `fondos` y `suministros` directos | `[]` y `[]`, sin error |
| 8 | Admin | `from("activos").select("*")` | `[]`: tampoco el admin entra por la puerta |

El registro, leído por el admin desde la fila 89:

| id | Quién | Acción | Detalle |
|---|---|---|---|
| 89 | Editor | `LOGIN` | — |
| 90 | Editor | `CONSULTA` / `ACTIVOS` / 1 | — |
| 91 | Editor | `BUSQUEDA` / `ACTIVOS` | `{"texto":"ACT","resultados":6}` |
| 92 | Editor | `CREACION` / `ACTIVOS` / 7 | — |
| 93 | Editor | `CONSULTA` / `ACTIVOS` / 4 | — |
| 94 | Lector | `LOGIN` | — |
| 95 | Admin | `LOGIN` | — |

**Se cumplieron las cuatro hipótesis.** La prueba definitiva de la última: **no hay ninguna `MODIFICACION`**. Las lecturas directas de las pruebas 1, 7 y 8 tampoco dejaron rastro, pero ahora porque no devolvieron nada.

### 22.5. Qué significa

1. **La puerta está cerrada para todos, también para el admin.** Nadie lee activos, fondos ni suministros sin pasar por una ventanilla que lo apunta. El registro de lecturas ya no se puede saltar.
2. **Lo que se rompe son las modificaciones, y en silencio.** El paso 5 devolvió `error: null`. Si la página hiciera esa modificación, le diría al usuario "guardado" sin haber cambiado nada. Solo se descubrió al comprobar el efecto con la ventanilla (paso 6). **Un "sin error" no significa "hecho": hay que comprobar el efecto.** La página todavía no modifica datos, así que no hay nada roto a la vista.
3. **Sin probar, pero previsible:** un `insert` con `.select()` también fallaría, por la misma razón. La creación funciona solo porque no pide nada de vuelta.

**Lo siguiente: las funciones de escritura.** La propuesta es crear `crear_…` y `modificar_…` para las tres tablas y, después, retirar también las políticas de `INSERT` y `UPDATE`. Las tablas quedarían sin ninguna puerta, y la única forma de hablar con ellas serían las ventanillas, que comprueban el permiso y lo apuntan.

**Marcha atrás:** el paso es reversible. Bastaría con volver a ejecutar los `CREATE POLICY` de la `009` y la `010`. Ningún dato se borra: solo cambia por dónde se puede leer.

### 22.6. Preguntas previsibles

**"¿Por qué el admin tampoco puede leer directamente?"**

Porque también se le audita. Un admin que se saltara el registro sería el punto ciego perfecto. Ahora sus lecturas quedan apuntadas igual que las de cualquiera.

**"¿Quién audita al auditor?"**

Nadie, todavía. El admin lee el registro directamente (sección 11), y esas lecturas no se apuntan. Queda como ampliación.

**"¿Y desde el SQL Editor?"**

El SQL Editor se salta las políticas y no apunta nada (sección 12): es la llave maestra del dueño del proyecto, para mantenimiento. En una empresa, ese acceso estaría restringido a muy pocas personas y vigilado con otras herramientas.

**"Si las modificaciones fallan en silencio, ¿no habéis roto la aplicación?"**

Se ha roto algo que la página todavía no usa, y se ha hecho a propósito para encontrarlo con pruebas antes de que llegue al usuario. Es el siguiente paso, y está identificado: las funciones de escritura.

---

## 23. Escritura mediante funciones — las modificaciones

Con la lectura directa cerrada (sección 22), las modificaciones desde la página tocaban 0 filas sin dar error. Esta sección arregla eso con tres ventanillas de escritura: `modificar_activo` (migración `027`), y `modificar_fondo` y `modificar_suministro` (migración `028`, que además corrige la primera).

```js
await clienteSupabase.rpc("modificar_activo", { activo_id: 4, nuevo_estado: "COMPRA" })
```

### 23.1. La decisión: un parámetro por columna

Había tres formas de decirle a la función qué cambiar:

- **A. Un parámetro por columna, y "vacío" significa "no cambiar".** Elegida.
- **B. Un único parámetro con los cambios en JSON.** Es flexible, pero obliga a tratar cada columna a mano o a montar la consulta como texto, que es la puerta a la inyección de SQL (sección 18.8).
- **C. Una función por acción de negocio** (`cambiar_estado_activo`, `registrar_venta_activo`…). Es la más cercana a una empresa, pero son demasiadas funciones para la versión mínima.

Con la A, la página solo manda lo que cambia, y cada dato llega con su tipo comprobado por Postgres. **Su límite: no permite vaciar un campo a propósito**, por ejemplo borrar una fecha de venta puesta por error. Queda como ampliación.

**Lo que no se modifica:** en activos, `id`, `codigo` y `creado_en`. El código es el identificador que se usa fuera de la aplicación (en Teams y en los correos), y cambiarlo debería ser una operación aparte y excepcional. En suministros, tampoco `tipo` ni `activo_id`: pasar una luz a gas, o un suministro a otro activo, no es modificarlo, sino dar de baja uno y crear otro.

### 23.2. El molde: `modificar_activo` (`027`)

Trae tres piezas nuevas respecto a las ventanillas de lectura:

1. **Parámetros opcionales con `DEFAULT NULL`.** Los que la página no manda llegan vacíos. Llevan el prefijo `nuevo_` / `nueva_` para no chocar con las columnas de la tabla (el `42702` de la sección 18.5).
2. **`COALESCE(nuevo, actual)`:** usa el valor nuevo y, si viene vacío, deja el que había.
3. **`UPDATE … RETURNING a.* INTO fila`** seguido de **`IF NOT FOUND THEN RAISE EXCEPTION`**: modifica, guarda cómo ha quedado la fila y, si no había ningún activo con ese id, da un error. **Es lo que arregla el fallo silencioso de la sección 22.**

```sql
    UPDATE public.activos a
    SET direccion = COALESCE(nueva_direccion, a.direccion),
        municipio = COALESCE(nuevo_municipio, a.municipio),
        ...
        fecha_venta = COALESCE(nueva_fecha_venta, a.fecha_venta)
    WHERE a.id = activo_id
    RETURNING a.* INTO fila;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El activo no existe';
    END IF;
```

El permiso se comprueba con `privado.puede_escribir('ACTIVOS')`, de la sección 10: exige el rol EDITOR y la sección, o ser admin.

**Lo que la función no hace: apuntar en el registro.** El disparador de las secciones 12 y 14 salta con cualquier `UPDATE` sobre la tabla, también dentro de una función, y apunta la `MODIFICACION` con el antes y el después. Las pruebas lo confirmaron.

**Fallos del primer borrador**, corregidos en dos vueltas:
- Faltaban las comas entre los parámetros.
- `SET` repetido en cada línea. Va una sola vez, con las columnas separadas por comas.
- Nombres de columna con espacios a la izquierda del `=` (`referencia catastral`, `fondo id`…). El nombre de la izquierda tiene que ser el mismo que va detrás de `a.` en el `COALESCE` de esa línea.
- En la segunda vuelta faltaban las comas al final de las líneas del `SET`. **Truco para contar:** 8 parámetros → 7 comas; 7 columnas en el `SET` → 6 comas.

### 23.3. Cómo se probó la `027`

| # | Usuario | Petición | Resultado |
|---|---|---|---|
| 1 | Editor | ACT-004 → `COMPRA` | 1 fila, el resto de columnas igual. **Lo que fallaba en silencio en la sección 22** |
| 2 | Editor | ACT-007: municipio `Getafe` y fecha de compra, a la vez | 1 fila con los dos cambios |
| 3 | Editor | Activo 999 | `P0001`, "El activo no existe" |
| 4 | Editor | ACT-004 → `DEMOLIDO` | `23514`, la restricción `CHECK` del estado (ver 23.4) |
| 5 | Editor | ACT-004 sin cambios | 1 fila igual |
| 6 | Lector | ACT-004 → `EN VENTA` | `P0001`, "No tienes permiso para modificar activos" |
| 7 | Admin | ACT-004 → `EN VENTA` | 1 fila |
| 8 | Admin | Lee el registro desde la fila 96 | Ver abajo |
| 9 | Sin sesión | ACT-004 → `EN VENTA` | `401`, `42501` |

| id | Quién | Acción | Detalle |
|---|---|---|---|
| 96 | Editor | `LOGIN` | — |
| 97 | Editor | `MODIFICACION` / `ACTIVOS` / 4 | `{"estado":{"antes":"EN OBRA","despues":"COMPRA"}}` |
| 98 | Editor | `MODIFICACION` / `ACTIVOS` / 7 | `{"municipio":{"antes":"Madrid","despues":"Getafe"},"fecha_compra":{"antes":null,"despues":"2026-11-13"}}` |
| 99 | Lector | `LOGIN` | — |
| 100 | Admin | `LOGIN` | — |
| 101 | Admin | `MODIFICACION` / `ACTIVOS` / 4 | `{"estado":{"antes":"COMPRA","despues":"EN VENTA"}}` |

- **Las filas 97 y 98 llevan el `perfil_id` del editor.** La función se ejecuta con los permisos del dueño de las tablas (`SECURITY DEFINER`), pero `auth.uid()` sigue devolviendo el usuario que la llamó. **El registro apunta a la persona real, no al dueño.**
- **Las pruebas 3 a 6 no dejaron rastro:** el 999 no existe, la 4 se deshace por el error, la 5 no cambia nada (la `017` no apunta modificaciones vacías) y el lector no tiene permiso.

### 23.4. Un hallazgo: el error del `CHECK` enseñaba la fila

El error de la prueba 4 traía esto en `details`:

> Failing row contains (4, ACT-004, Calle del Editor 1, Madrid, null, 1, DEMOLIDO, …)

**Postgres enseña la fila entera** cuando una restricción `CHECK` la rechaza. Y como el error deshace todo, no queda nada en el registro. Alguien con permiso de escritura podía ver la ficha completa de cualquier activo mandando a propósito un estado inválido, **sin que quedara ninguna `CONSULTA`**. Solo afecta a quien ya puede escribir en esa sección, pero es una lectura que se salta el registro: el mismo tipo de puerta lateral que la del IBAN (sección 18.5).

**El arreglo: validar antes del `UPDATE`**, con un mensaje propio:

```sql
    IF nuevo_estado IS NOT NULL
       AND nuevo_estado NOT IN ('COMPRA', 'EN OBRA', 'EN VENTA', 'VENDIDO') THEN
        RAISE EXCEPTION 'Estado no válido';
    END IF;
```

La restricción `CHECK` de la tabla se queda como última defensa. Además, el usuario recibe un mensaje en castellano que entiende, en lugar de uno técnico en inglés.

### 23.5. La `028`: el arreglo y las otras dos ventanillas

Una sola migración con tres bloques comentados:

1. **`CREATE OR REPLACE` de `modificar_activo`**, con la validación del estado. **No lleva `REVOKE` ni `GRANT`:** `CREATE OR REPLACE` conserva los permisos, porque la firma (nombres y tipos de los parámetros) es idéntica. Si cambiara, habría que hacer `DROP` y `CREATE`, como en la `025` (sección 21.5).
2. **`modificar_fondo(fondo_id, nuevo_nombre, nuevo_cif, nuevo_iban)`**, el molde aplicado a `fondos`. Esta tabla no tiene restricciones `CHECK`, así que no hace falta validar nada antes.
3. **`modificar_suministro(suministro_id, nuevo_cups, nueva_potencia_contratada_kw, nuevo_tipo_instalacion_gas)`.** Las restricciones de la `003` dicen que la potencia solo vale para luz y el tipo de instalación solo para gas. Para validarlo antes del `UPDATE`, la función **lee primero el tipo** del suministro:

```sql
    SELECT s.tipo INTO tipo_actual
    FROM public.suministros s
    WHERE s.id = suministro_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El suministro no existe';
    END IF;

    IF tipo_actual = 'GAS' AND nueva_potencia_contratada_kw IS NOT NULL THEN
        RAISE EXCEPTION 'La potencia contratada solo se aplica a suministros de luz';
    END IF;
```

**El orden importa: primero el permiso y después si existe.** Al revés, alguien sin permiso podría averiguar qué ids existen según el mensaje de error que recibiera.

**Juntar las tres en una migración** ahorra ciclos de pruebas y no puede dejar nada a medias: el SQL Editor la ejecuta entera de una vez, como una transacción (sección 21.5).

### 23.6. Cómo se probó la `028`

**Una lección de la primera ronda:** las pruebas se lanzaron sin haber ejecutado la migración en Supabase. Todas las llamadas a las funciones nuevas dieron `PGRST202` ("Could not find the function"), y `modificar_activo` seguía dando el `23514` antiguo. **Si sale `PGRST202`, lo primero es comprobar que la migración está ejecutada: el archivo de VS Code no es la base de datos.** El registro solo recogió los tres `LOGIN` (102 a 104): las pruebas no causaron ningún daño.

Ya ejecutada, **en fondos y suministros solo puede escribir el admin**: el editor no tiene esas secciones, y el lector las tiene, pero con rol LECTOR.

| # | Usuario | Petición | Resultado |
|---|---|---|---|
| 1 | Editor | ACT-004 → `DEMOLIDO` | `P0001`, "Estado no válido", **`details: null`** |
| 2 | Editor | `modificar_fondo` | `P0001`, "No tienes permiso para modificar fondos" |
| 3 | Lector (con FONDOS) | `modificar_fondo` | `P0001`, "No tienes permiso para modificar fondos" |
| 4 | Admin | Fondo 2, IBAN nuevo | 1 fila |
| 5 | Admin | Fondo 999 | `P0001`, "El fondo no existe" |
| 6 | Admin | Suministro 1 (luz), potencia 8 | 1 fila |
| 7 | Admin | Suministro 2 (gas), potencia 5 | `P0001`, "La potencia contratada solo se aplica a suministros de luz" |
| 8 | Admin | Suministro 1 (luz), instalación `COMUNITARIA` | `P0001`, "El tipo de instalación solo se aplica a suministros de gas" |
| 9 | Admin | Suministro 999 | `P0001`, "El suministro no existe" |
| 10 | Admin | Lee el registro | Ver abajo |
| 11 | Sin sesión | `modificar_fondo` | `401`, `42501` |

| id | Quién | Acción | Detalle |
|---|---|---|---|
| 105-107 | Editor, lector y admin | `LOGIN` | — |
| 108 | Admin | `MODIFICACION` / `FONDOS` / 2 | `{"iban":{"antes":"ES00 PRUEBA EDITOR SQL","despues":"ES00 PRUEBA 028"}}` |
| 109 | Admin | `MODIFICACION` / `SUMINISTROS` / 1 | `{"potencia_contratada_kw":{"antes":7.5,"despues":8}}` |

**Todos los errores salen en castellano, con un mensaje claro y sin `details`.** Es lo que necesita la página para enseñárselos al usuario tal cual.

### 23.7. Preguntas previsibles

**"El registro guarda el IBAN en claro."**

Es cierto: la fila 108 tiene el IBAN anterior y el nuevo. Solo lo lee el admin (sección 11), pero es un dato financiero guardado en un sitio más. La ampliación natural es que el disparador lo enmascare (por ejemplo, `ES00 **** 028`).

**"¿Cómo borro una fecha de venta puesta por error?"**

Hoy no se puede: es el límite de la opción A (sección 23.1). Se resolvería con un parámetro aparte que indique qué columnas vaciar, o con una función específica.

**"Los errores de duplicado dicen si un valor existe."**

Si alguien pone un CUPS, un CIF o una referencia catastral que ya tiene otro registro, Postgres responde que ya existe (`23505`). Lo mismo pasa con un `nuevo_fondo_id` que no existe (`23503`). Solo afecta a quien puede escribir en esa sección, y la respuesta solo confirma un valor que esa persona ya ha escrito.

**Validaciones de negocio pendientes:** que la potencia sea positiva, que la fecha de venta no sea anterior a la de compra, o qué cambios de estado tienen sentido (no volver de `VENDIDO` a `COMPRA`). Es lo que resolvería la opción C de la sección 23.1, y queda como ampliación.

---

## 24. Escritura mediante funciones — las creaciones, y las tablas se cierran del todo

Dos migraciones cierran el bloque de base de datos: la `029`, con las tres ventanillas de creación (`crear_activo`, `crear_fondo` y `crear_suministro`), y la `030`, que retira las políticas de escritura de la sección 10. Desde aquí, **`activos`, `fondos` y `suministros` no tienen ninguna política: no se puede leer, crear ni modificar nada sin pasar por una ventanilla.**

```js
await clienteSupabase.rpc("crear_activo", { nuevo_codigo: "ACT-008", nueva_direccion: "Calle de la Ventanilla 8", nuevo_fondo_id: 1, nuevo_estado: "COMPRA" })
```

### 24.1. Lo que cambia respecto a modificar

1. **Parámetros obligatorios y opcionales.** Las columnas `NOT NULL` de la tabla van como parámetros **sin** `DEFAULT` y **delante**. Postgres exige que, a partir del primer parámetro con `DEFAULT`, todos los que vengan detrás también lo tengan.
2. **`INSERT … RETURNING * INTO fila`.** La función devuelve la fila nueva, y así la página recibe el `id` que le ha asignado la base de datos.
3. **El texto vacío.** `NOT NULL` impide que falte un dato, pero no impide `""`. Cada función valida sus textos obligatorios con `trim(coalesce(x, '')) = ''`: `coalesce` convierte el `NULL` en texto vacío y `trim` quita los espacios, así que una sola comprobación detecta el dato que falta, el vacío y el que solo tiene espacios.
4. **Las mismas validaciones previas que en la `028`:** el estado en activos, y el tipo, la potencia y la instalación en suministros. Los errores salen en castellano y no dependen de los `CHECK` de la tabla (sección 23.4).
5. **La `CREACION` la apunta el disparador**, como la `MODIFICACION`.

```sql
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
...
    IF trim(coalesce(nuevo_codigo, '')) = '' OR trim(coalesce(nueva_direccion, '')) = '' THEN
        RAISE EXCEPTION 'El código y la dirección son obligatorios';
    END IF;
...
    INSERT INTO public.activos
        (codigo, direccion, fondo_id, estado, municipio, referencia_catastral, fecha_compra, fecha_venta)
    VALUES
        (nuevo_codigo, nueva_direccion, nuevo_fondo_id, nuevo_estado, nuevo_municipio, nueva_referencia_catastral, nueva_fecha_compra, nueva_fecha_venta)
    RETURNING * INTO fila;
```

`crear_fondo(nuevo_nombre, nuevo_cif, nuevo_iban)` exige el nombre y el CIF. `crear_suministro(nuevo_activo_id, nuevo_tipo, nuevo_cups, …)` exige el CUPS y comprueba que el tipo sea LUZ o GAS antes de validar la potencia y la instalación.

### 24.2. Cómo se probó la `029`

Esta vez la migración se ejecutó antes de probar (la lección de la sección 23.6).

| # | Usuario | Petición | Resultado |
|---|---|---|---|
| 1 | Editor | Crear ACT-008 | 1 fila, id 8 |
| 2 | Editor | Estado `DEMOLIDO` | `P0001`, "Estado no válido" |
| 3 | Editor | Código `"   "` | `P0001`, "El código y la dirección son obligatorios" |
| 4 | Editor | Código `ACT-001`, repetido | `409`, `23505`, "Key (codigo)=(ACT-001) already exists" |
| 5 | Editor | `crear_fondo` | `P0001`, "No tienes permiso para crear fondos" |
| 6 | Lector (con FONDOS) | `crear_fondo` | `P0001`, "No tienes permiso para crear fondos" |
| 7 | Admin | Crear "FONDO 029 SL" | 1 fila, id 8 |
| 8 | Admin | Luz para ACT-008, 5,75 kW | 1 fila, suministro 6 |
| 9 | Admin | Gas con potencia | `P0001`, "La potencia contratada solo se aplica a suministros de luz" |
| 10 | Admin | Tipo `AGUA` | `P0001`, "Tipo no válido: tiene que ser LUZ o GAS" |
| 11 | Sin sesión | `crear_fondo` | `401`, `42501` |

| id | Quién | Acción |
|---|---|---|
| 110 | Editor | `LOGIN` |
| 111 | Editor | `CREACION` / `ACTIVOS` / 8 |
| 112 | Lector | `LOGIN` |
| 113 | Admin | `LOGIN` |
| 114 | Admin | `CREACION` / `FONDOS` / 8 |
| 115 | Admin | `CREACION` / `SUMINISTROS` / 6 |

- **Las `CREACION` no guardan los valores en `detalle`**, solo el `registro_id`. Para saber cómo se creó un registro hay que consultarlo. Ampliación posible: guardar la fila inicial como "después", igual que en las modificaciones.
- **El fondo nuevo es el 8, aunque solo hubiera cuatro fondos.** Los ids no se reutilizan (sección 24.4).

### 24.3. La `030`: las tablas se quedan sin puertas

```sql
DROP POLICY "Creación de fondos por sección" ON public.fondos;
DROP POLICY "Modificación de fondos por sección" ON public.fondos;
DROP POLICY "Creación de activos por sección" ON public.activos;
DROP POLICY "Modificación de activos por sección" ON public.activos;
DROP POLICY "Creación de suministros por sección" ON public.suministros;
DROP POLICY "Modificación de suministros por sección" ON public.suministros;
```

**No se toca `privado.puede_escribir`**, aunque nació en la misma `011`: la usan las seis ventanillas de escritura.

**Fallos del primer borrador.** Se escribió a partir de la `026` y quedaron restos: tres líneas con los nombres de "Lectura de … por sección" (ya borradas en la sección 22, así que Postgres habría dado "policy does not exist" y no se habría aplicado nada), y dos líneas que repetían "Modificación de fondos" en las tablas `activos` y `suministros`. Se corrigió en varias vueltas, comparando cada nombre con la `011`. **La comprobación rápida:** cada tabla tiene que aparecer dos veces, una con "Creación" y otra con "Modificación", y la palabra del nombre tiene que coincidir con la tabla del `ON`.

Tras ejecutarla, `pg_policies` mostró **solo 3 políticas**: las dos de `perfiles` y la de `registro_actividad`.

### 24.4. Cómo se probó la `030`

| # | Usuario | Prueba | Resultado |
|---|---|---|---|
| 1 | Editor | `from("activos").insert(...)` (ACT-011) | **`403`, `42501`**, "new row violates row-level security policy for table activos" |
| 2 | Editor | `from("activos").update(...)` de ACT-008 | `error: null` |
| 3 | Editor | `consultar_activo(8)` | Estado `COMPRA`: **el paso 2 no cambió nada** |
| 4 | Editor | `crear_activo` (ACT-010) | 1 fila |
| 5 | Editor | `modificar_activo(8)` → `EN OBRA` | 1 fila |

| id | Quién | Acción | Detalle |
|---|---|---|---|
| 116 | Editor | `LOGIN` | — |
| 117 | Editor | `CONSULTA` / `ACTIVOS` / 8 | — |
| 118 | Editor | `CREACION` / `ACTIVOS` / 11 | — |
| 119 | Editor | `MODIFICACION` / `ACTIVOS` / 8 | `{"estado":{"antes":"COMPRA","despues":"EN OBRA"}}` |
| 120 | Admin | `LOGIN` | — |

- **Crear directamente falla en voz alta; modificar, en silencio.** Para un `INSERT`, RLS comprueba la fila nueva y, si ninguna política la deja entrar, da error. Para un `UPDATE`, RLS primero filtra qué filas se pueden ver; sin política, no ve ninguna, y modificar cero filas no es un error (sección 22.5).
- **ACT-010 tiene el id 11.** El ACT-001 repetido de la `029` consumió el 9, y el `insert` de la prueba 1, aunque RLS lo rechazara, consumió el 10: Postgres reserva el número antes de comprobar si la fila puede entrar. Se había previsto el 10, y la prueba lo corrigió. **El id no coincide con el número del código**, y la página nunca debe suponerlo.

### 24.5. Lo que queda cerrado

Con esta sección termina el bloque de base de datos de la versión mínima:

- **Nadie lee, crea ni modifica nada sin pasar por una ventanilla**, tampoco el admin.
- **Cada ventanilla comprueba el permiso, valida los datos y queda apuntada** a nombre del usuario real.
- **Los errores salen en castellano** y no enseñan datos que no se deberían ver.

| Tabla | Consultar | Buscar | Crear | Modificar |
|---|---|---|---|---|
| `activos` | `consultar_activo` | `buscar_activos` | `crear_activo` | `modificar_activo` |
| `fondos` | `consultar_fondo` | `buscar_fondos` | `crear_fondo` | `modificar_fondo` |
| `suministros` | `consultar_suministro` | `buscar_suministros` | `crear_suministro` | `modificar_suministro` |

Doce ventanillas: es el catálogo de operaciones de la aplicación, como el de una API.

### 24.6. Preguntas previsibles

**"¿Y borrar?"**

No hay ninguna ventanilla de borrado, y sin políticas nadie puede hacer un `DELETE`. Es a propósito: en una gestora, un activo vendido no se borra, se pasa a `VENDIDO`, y la historia completa se conserva. Si hiciera falta, sería una función aparte, solo para el admin, y quedaría apuntada como `BORRADO`.

**"Si las tablas no tienen políticas, ¿para qué sirve RLS?"**

Precisamente para eso: con RLS activado y sin políticas, **la respuesta por defecto es "no"** para cualquier usuario de la aplicación. Las funciones `SECURITY DEFINER` son la única vía, y cada una decide quién pasa. Si mañana alguien añadiera una tabla nueva con RLS y sin políticas, nacería cerrada.

**"¿Qué pasa si alguien encuentra la forma de llamar a una función sin la página?"**

Nada que no pudiera hacer desde la página. Las funciones se pueden llamar desde la consola (así se han hecho todas las pruebas), y por eso cada una comprueba el permiso por dentro, en lugar de confiar en que la página solo enseñe botones a quien puede usarlos.

## 25. Las pantallas — paso 1: la sesión, y el login nuevo

Con la base de datos cerrada empiezan las pantallas del usuario. Se decidió hacer primero solo las de **activos** (fondos y suministros llegarán cuando la versión mínima esté presentable), en cuatro pasos: la sesión, el buscador, la ficha y los formularios de crear y editar. Esta sección cubre el paso 1 y el rediseño del login.

**El principio de todas las pantallas: la página esconde por comodidad; la seguridad está en la base de datos.** Si la página no enseña el botón "Crear" a un lector, es para no confundirlo, no para protegerse: aunque lo llamara desde la consola, `crear_activo` le diría que no (sección 24.6).

### 25.1. La `031`: `mi_perfil()`

Para decidir qué enseñar, la página necesita saber quién es el usuario, qué rol tiene y qué secciones puede leer y escribir. Desde la sección 22 no puede leer tablas directamente, así que lo pregunta por una ventanilla más:

```sql
CREATE FUNCTION public.mi_perfil()
RETURNS TABLE (nombre text, rol text, secciones_lectura text[], secciones_escritura text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.nombre,
    p.rol,
    ARRAY(
      SELECT s.seccion
      FROM unnest(ARRAY['ACTIVOS', 'FONDOS', 'SUMINISTROS']) AS s(seccion)
      WHERE privado.tiene_seccion(s.seccion)
    ),
    ARRAY(
      SELECT s.seccion
      FROM unnest(ARRAY['ACTIVOS', 'FONDOS', 'SUMINISTROS']) AS s(seccion)
      WHERE privado.puede_escribir(s.seccion)
    )
  FROM public.perfiles p
  WHERE p.id = auth.uid()
    AND p.activo;
$$;
```

1. **`LANGUAGE sql` y no `plpgsql`.** No hay lógica (ni `IF` ni variables): es una sola consulta.
2. **`STABLE`.** Le dice a Postgres que la función no modifica nada y que, dentro de la misma consulta, devuelve siempre lo mismo.
3. **Reutiliza las reglas, no las copia.** Las listas salen de pasar las tres secciones por `privado.tiene_seccion` y `privado.puede_escribir`, las mismas funciones que usan las ventanillas. Si mañana cambian las reglas, la página se entera sola. `unnest` convierte la lista `['ACTIVOS', 'FONDOS', 'SUMINISTROS']` en tres filas y `ARRAY(...)` vuelve a juntar las que pasan el filtro.
4. **Un perfil desactivado no recibe nada** (`AND p.activo`), y la página lo trata como si no tuviera perfil.
5. **No se apunta en el registro.** Es una consulta del usuario sobre sí mismo, no sobre los datos de la empresa.

### 25.2. `activos.html` y el guardián

`activos.html` tiene la cabecera y el contenido **ocultos** (`hidden`) hasta comprobar la sesión: así nadie ve la página ni un instante sin haber entrado. `activos.js` hace de guardián:

```js
async function iniciar() {
    const { data: datosSesion } = await clienteSupabase.auth.getSession();
    if (!datosSesion.session) {
        window.location.replace("login.html");
        return;
    }

    const { data: perfiles, error } = await clienteSupabase.rpc("mi_perfil");
    if (error || !perfiles || perfiles.length === 0) {
        await clienteSupabase.auth.signOut();
        window.location.replace("login.html");
        return;
    }

    mostrarPerfil(perfiles[0]);
}
```

- **Sin sesión**, de vuelta al login. **Con sesión pero sin perfil activo**, se cierra la sesión y también de vuelta: si solo se le redirigiera, el login vería la sesión abierta y lo mandaría otra vez a activos, en bucle.
- **`location.replace` y no `location.href`.** `replace` sustituye la página en el historial: el botón "Atrás" no devuelve a una página a la que no se puede volver.
- **La cabecera** enseña el nombre y una píldora con el rol. La tarjeta "Tu sesión" enseña las secciones que puede leer y escribir, con una píldora del color de cada sección, o "Ninguna".
- **Todo se escribe con `textContent`, nunca con `innerHTML`.** `textContent` trata lo que recibe como texto: si alguien se llamara `<script>…`, se vería tal cual en lugar de ejecutarse.
- **Cerrar sesión** llama a `signOut()` y vuelve al login.

`login.js` cambia en dos cosas: al entrar, redirige a `activos.html` en lugar de saludar en la misma página (y ya no lee `perfiles`), y si al abrir el login ya hay una sesión, redirige directamente.

### 25.3. Cómo se probó el paso 1

| # | Prueba | Resultado |
|---|---|---|
| 1 | Entrar como editor | Cabecera "EDITOR"; lee y escribe Activos |
| 2 | Entrar como lector | Cabecera "LECTOR"; lee Fondos y Suministros; escribe "Ninguna" |
| 3 | Entrar como admin | Cabecera "ADMIN"; lee y escribe las tres secciones |
| 4 | Contraseña mala | "Correo o contraseña incorrectos." en rojo, sin salir del login |
| 5 | Abrir `activos.html` sin sesión | Vuelve al login |

### 25.4. El login nuevo

El login pasa de una tarjeta sencilla a una portada con identidad propia. Es lo primero que se ve de la aplicación, y se trabajó en una maqueta aparte (fuera del repositorio) antes de pasarlo al proyecto.

- **El fondo.** Una ilustración generada con Gemini (NotebookLM) a partir de un brief propio: un panel digital con la ciudad sobre pistas de circuito, un marco central y seis paneles laterales. Se le quitaron con Python (Pillow) los iconos que traía, para redibujarlos, y la marca de agua, tapada con la esquina opuesta reflejada, porque la imagen es simétrica. Se convirtió a WebP: **de 4 MB a 74 KB** sin pérdida visible.
- **El "escenario".** La imagen tiene proporciones fijas (2752 × 1536), así que todo va dentro de una caja con esas mismas proporciones que cubre la ventana: `width: max(100vw, 100vh * 2752 / 1536)`. Dentro, todo se coloca en porcentajes y los textos se miden en `cqw` (1 % del ancho de la caja, con `container-type: inline-size`). Así, al cambiar el tamaño de la ventana, todo crece y encoge a la vez y nunca se descoloca respecto al dibujo. Por debajo de 900 px de ancho o en vertical, los paneles serían ilegibles: se ocultan y queda una tarjeta normal.
- **Los paneles son tarjetas informativas, no botones.** Antes de iniciar sesión no hay adónde llevar. Izquierda: las tres secciones; derecha: emplazamiento, registro de actividad y áreas. Hay una versión B del lado derecho, más técnica (registro, permisos por sección y ventanillas), guardada en `docs/alternativas/`.
- **Los iconos** se redibujaron en SVG copiando el detalle de los originales (trazo fino, brillo de neón con `drop-shadow`). Al ser vectoriales se ven nítidos a cualquier tamaño y cambian de color con la sección.
- **La corriente por los circuitos.** Sobre la imagen hay un SVG con las pistas de arriba trazadas encima de las del dibujo. Cada línea tiene `stroke-dasharray: 70 5000`, un trazo de 70 unidades y un hueco enorme, y al animar `stroke-dashoffset` el trazo recorre la pista como un haz de luz. Para que la luz no se salga, se recorta con una **máscara** hecha con los píxeles reales de las pistas. El lado derecho es el izquierdo reflejado (`<use>` con `scale(-1 1)`).
- **Los resaltes** (tarjetas y botón) solo animan **opacidad**: un velo del color de la sección en las tarjetas, y un halo y un velo claro en el botón.
- **Siempre en oscuro**, aunque el sistema esté en claro, porque la imagen es oscura. Más adelante (sección 26), toda la aplicación pasó a una sola paleta oscura.
- **Accesibilidad.** Con el teclado, el botón enciende el mismo resalte que con el cursor (la esquina recortada cortaría el contorno de foco). Si el sistema pide reducir el movimiento, se ocultan los circuitos.

### 25.5. Lo que se aprendió por el camino

1. **Un degradado de fondo no se anima.** El navegador lo cambia de golpe. Para aclarar un botón poco a poco hay que usar otra cosa.
2. **Para que un resalte arranque al instante, se anima `opacity`, no `filter`.** La opacidad la mueve la tarjeta gráfica desde el primer fotograma; los filtros (`drop-shadow`, `brightness`) se recalculan en cada fotograma y arrancan un pelín tarde. El botón tuvo un retardo visible hasta que se rehízo con capas de opacidad, como las tarjetas.
3. **Las listas de sombras se emparejan por posición.** Si en reposo hay dos `drop-shadow` y con el cursor tres, el halo nuevo "nace" de la sombra que ocupaba su sitio, y pasa por negro antes de ser azul.
4. **A las copias de `<use>` no les llegan los selectores con ancestro** (`.circuitos path`). Salían rellenas de negro. Solución: una clase en cada pista.
5. **En `@keyframes`, `calc(var(--fin) * -1)` sin unidad se descarta en silencio.** Tiene que ser `* -1px`.

### 25.6. Preguntas previsibles

**"Si el guardián es JavaScript, ¿no se lo puede saltar cualquiera?"**

Sí, y no pasa nada. Saltárselo solo permite ver la página vacía: cada dato llega por una ventanilla que comprueba la sesión y el permiso en la base de datos. El guardián sirve para que la experiencia sea limpia, no para proteger.

**"¿La imagen del login la has hecho tú?"**

La generé con Gemini a partir de un brief mío y la elegí entre varias versiones. Lo que hay encima es trabajo propio: los iconos redibujados, los textos, la animación de los circuitos y el encaje con el formulario.

**"¿Por qué no usar un framework (React, Tailwind…)?"**

Para aprender lo que hay debajo. Con HTML, CSS y JavaScript sin capas intermedias, cada decisión de esta sección se ve y se puede explicar. Pasar a un framework más adelante sería traducir, no reaprender.

## 26. Las pantallas — la identidad de activos y un sistema de diseño común

Con el login terminado, la pantalla de activos se rediseñó para que tuviera la misma identidad. Se hizo primero una **maqueta completa** fuera del repositorio, con el buscador, la lista, la ficha y los formularios con datos ficticios, para decidir la línea visual de todos los pasos de una vez.

### 26.1. Sintonía con el login, pero no una copia

El login es una portada: se ve unos segundos y puede permitirse una imagen a pantalla completa y circuitos en movimiento. Activos es una pantalla de trabajo, en la que alguien pasa mucho rato leyendo datos. Por eso:

- **Se comparte la identidad:** colores, fuentes (Rajdhani en títulos, Saira en el texto), esquinas recortadas, botones con relieve, etiquetas y la animación de entrada.
- **El fondo es tranquilo:** la rejilla del login, muy tenue, con una viñeta que oscurece los bordes.
- **El movimiento se queda en la cabecera.** La cabecera es la franja superior de la imagen del login, con sus circuitos y sus haces de luz; nada se mueve detrás de los datos.

### 26.2. Solo entra al repositorio lo que funciona

De la maqueta, al repositorio solo pasó lo que el paso 1 ya hace de verdad: la cabecera con el nombre y el rol, la tarjeta "Tu sesión" y una tarjeta nueva, **"Sin acceso"**, para quien no tiene la sección Activos (el lector de prueba). El buscador, la ficha y los formularios entrarán con los pasos 2, 3 y 4, cada uno ya conectado a la base de datos, usando la maqueta como plano. **En el repositorio no hay un buscador que no busca.**

```js
if (perfil.secciones_lectura.includes("ACTIVOS")) {
    pintarSecciones(document.getElementById("secciones-lectura"), perfil.secciones_lectura);
    pintarSecciones(document.getElementById("secciones-escritura"), perfil.secciones_escritura);
} else {
    document.getElementById("tarjeta-sesion").hidden = true;
    document.getElementById("sin-acceso").hidden = false;
    pintarSecciones(document.getElementById("secciones-lector"), perfil.secciones_lectura);
}
```

Como siempre, la página solo decide qué enseñar: aunque el lector se saltara esta comprobación, cualquier ventanilla de activos le diría que no.

### 26.3. Un sistema de diseño común

`estilos-formal.css` se reorganizó para que login y activos compartan piezas en lugar de repetirlas:

1. **Una sola paleta, oscura.** Antes había una paleta clara, una oscura que se activaba si el sistema lo pedía y una copia de la oscura dentro del login. Con toda la aplicación en oscuro, sobraban las dos primeras y la copia.
2. **Un solo botón principal, `.boton-relieve`.** "Entrar" y los futuros "Nuevo activo" y "Guardar" son el mismo diseño: el login solo ajusta las medidas (en `cqw`, porque todo el login escala con la imagen). Si mañana cambia el botón, cambia en todas partes.
3. **Un botón secundario, `.boton-linea`**, con la misma letra, altura y esquina que el principal, pero solo con contorno ("Cerrar sesión", y después "Editar" y "Cancelar").
4. **Las etiquetas** (rol, estado y sección) con el estilo "esquina recortada y relieve": fondo teñido con su propio color, brillo arriba y canto abajo. Las de sección llevan un cuadradito que las distingue de las de estado.
5. **Los bloques** (`.bloque`) tienen las esquinas de los paneles del login: la superior izquierda pequeña y la inferior derecha grande.

### 26.4. Dos técnicas que aparecen en todas las piezas

**El borde de una forma recortada.** `clip-path` recorta el elemento, y con él su borde y su sombra. Para dibujar el contorno de un bloque recortado se usan dos capas con la misma forma: la de fuera, del color de la línea, y la de dentro, 1 px más pequeña, del color del relleno.

```css
.bloque::before, .bloque::after {
  clip-path: polygon(var(--c1) 0, 100% 0, 100% calc(100% - var(--c2)), calc(100% - var(--c2)) 100%, 0 100%, 0 var(--c1));
}
.bloque::before { inset: 0; background: var(--linea-fuerte); }  /* la línea */
.bloque::after { inset: 1px; background: var(--panel); }       /* el relleno */
```

**La sombra de una forma recortada.** Por la misma razón, un `box-shadow` no sobrevive al recorte. La sombra la pone un envoltorio con `filter: drop-shadow`, que sí sigue la forma de lo que contiene (`.sombra` en los botones y `.sombra-pildora` en las etiquetas).

### 26.5. Cómo se probó

| # | Prueba | Resultado |
|---|---|---|
| 1 | Entrar como editor | Cabecera con circuitos, "EDITOR"; "Tu sesión": lee y escribe Activos |
| 2 | Entrar como lector | "No tienes acceso a Activos"; lee Fondos y Suministros |
| 3 | Login después de la reorganización | Igual que antes, comparado con una captura previa |

### 26.6. Lo que ya está decidido para los pasos siguientes

La maqueta dejó decididos el buscador, la lista y la ficha, que se despliega de izquierda a derecha en tres tiempos (el panel, el nombre y los datos), y una decisión de datos: **la ficha mostrará el nombre del fondo propietario**, no solo su número. El editor no tiene la sección Fondos, así que la `032` ampliará `consultar_activo` para entregar el nombre (solo el nombre: el CIF y el IBAN siguen protegidos).

## 27. Las pantallas — paso 2: el buscador

La barra de `activos.html` tiene ya el buscador conectado a `buscar_activos`, junto a los permisos del usuario ("Lees" y "Escribes", que antes estaban en la tarjeta "Tu sesión"). Debajo, la lista de resultados: código, dirección y municipio, lo mismo que devuelve la función (sección 21).

Las filas todavía no se pueden pulsar y no hay botón "Nuevo activo": llegarán con la ficha (paso 3) y los formularios (paso 4). La página no promete nada que todavía no hace.

### 27.1. El problema: buscar mientras se escribe llena el registro

Lo cómodo es que la lista se actualice mientras se escribe. Pero cada llamada a `buscar_activos` queda apuntada como `BUSQUEDA` en el registro de actividad, y buscar letra a letra dejaría un rastro de búsquedas a medias: "c", "ca", "cal"…

La primera idea fue que se apuntara solo la palabra final. **Se descartó**, porque para eso la página tendría que decirle a la base de datos "esta no la apuntes", y la página no es de fiar: cualquiera podría llamar a la función desde la consola pidiendo que no se apunte nada y buscar sin dejar rastro. **Un registro que el usuario puede apagar no sirve como registro.**

### 27.2. La solución: la base de datos apunta todo, la página no manda búsquedas a medias

```js
const MIN_LETRAS = 3;
const ESPERA_MS = 600;

campoBusqueda.addEventListener("input", function () {
    clearTimeout(temporizador);
    const texto = campoBusqueda.value.trim();
    if (texto === "") {
        ...
    } else if (texto.length >= MIN_LETRAS) {
        temporizador = setTimeout(function () { buscar(texto); }, ESPERA_MS);
    }
});
```

1. **La búsqueda automática espera a que se deje de escribir.** Cada letra cancela el temporizador anterior (`clearTimeout`) y pone uno nuevo. Solo cuando pasan 600 ms sin teclear se manda la búsqueda. Esta técnica se llama *debounce*.
2. **Con menos de 3 letras no se busca sola**: con 1 o 2 letras casi todo coincide.
3. **Intro busca al momento con cualquier texto**, aunque tenga una sola letra: es una decisión clara del usuario, no un tecleo a medias. Así se pueden buscar municipios de dos letras, como Ea (Bizkaia) o Ur (Girona).
4. **La misma búsqueda no se repite seguida.** Si la búsqueda automática ya buscó "calle" y después se pulsa Intro, no se manda otra vez: se apuntaría dos veces.
5. **Solo se pinta la respuesta de la última búsqueda.** Cada búsqueda lleva un número; si llega tarde la respuesta de una anterior, se descarta.

**Por qué 3 y 600.** No son valores "óptimos", sino puntos de partida razonables. Quien escribe con soltura deja 200-300 ms entre tecla y tecla, y alguien más pausado, 400-500 ms: la espera tiene que ser mayor para no cortar la palabra. Por otro lado, hasta 1 segundo una espera no rompe el hilo de lo que se está haciendo (criterio de Jakob Nielsen). Los buscadores suelen usar 300-500 ms; aquí se eligió algo más porque cada búsqueda queda registrada. Están en dos constantes al principio de `activos.js`, para ajustarlas probando.

**La selección final también queda apuntada:** cuando el usuario abra la ficha de un activo (paso 3), `consultar_activo` apuntará una `CONSULTA` con el activo concreto. El registro contará qué se buscó y qué se abrió.

### 27.3. La entrada de los resultados

En cada búsqueda, el panel baja desde arriba (0,8 s, con la misma curva que la ficha), después aparece el recuento y las filas entran una a una, cada una 0,1 s después de la anterior. Cada fila lleva su turno en una variable CSS (`--i`) y el retraso se calcula en la hoja de estilos:

```css
.despliega-abajo tbody tr { animation-delay: calc(0.35s + min(var(--i, 0), 10) * 0.1s); }
```

`min(var(--i), 10)` pone un tope: a partir de la décima fila, las demás entran a la vez. Con 50 resultados, sin tope serían 5 segundos de espera.

### 27.4. Cómo se probó

Primero, con una base de datos simulada que apuntaba cada llamada, y un guion que tecleaba solo:

| Tecleo | Llamadas que llegaron |
|---|---|
| "c", "ca", "cal", "call", "calle" (150 ms entre letras), y después Intro | `"calle"` (una sola vez) |
| "e", "ea" y después Intro | `"ea"` |
| "zzz" | `"zzz"` |

Once pulsaciones, tres búsquedas. Después, con Supabase y consultando el registro como admin:

| id | Acción | Detalle |
|---|---|---|
| 132 | `BUSQUEDA` | `{"texto": "calle", "resultados": 6}` |
| 133 | `BUSQUEDA` | `{"texto": "dubida", "resultados": 0}` |

Ninguna búsqueda a medias.

### 27.5. Preguntas previsibles

**"¿Y si alguien se salta las reglas desde la consola y busca letra a letra?"**

Se apunta todo, letra a letra. Las reglas de la página sirven para que el registro de un uso normal quede limpio, no para controlar nada: lo que se apunta lo decide la base de datos.

**"¿No sería más eficiente traer todos los activos una vez y filtrar en la página?"**

Con pocos datos, sí. Pero la página recibiría todos los activos, también los que el usuario no ha buscado, y las búsquedas no quedarían registradas. Con la ventanilla, cada usuario recibe solo lo que busca y queda constancia.

## 28. Las pantallas — paso 3: la ficha del activo

Al elegir un activo de la lista, la página llama a `consultar_activo` y despliega su ficha en la columna de la derecha. Antes hubo que cambiar la función, porque la ficha necesitaba un dato que no entregaba: el nombre del fondo propietario.

### 28.1. La `032`: el nombre del fondo, sin el resto del fondo

El editor de prueba solo tiene la sección Activos, así que no puede leer nada de `fondos`. Pero para quien trabaja con activos, saber de qué fondo es cada uno forma parte del propio activo, y "fondo nº 1" no le dice nada. La decisión: **`consultar_activo` entrega también el nombre del fondo, y solo el nombre**. El CIF y el IBAN siguen protegidos tras la sección Fondos.

```sql
BEGIN;

DROP FUNCTION public.consultar_activo(bigint);

CREATE FUNCTION public.consultar_activo(activo_id bigint)
RETURNS TABLE (
    id bigint, codigo text, direccion text, municipio text, referencia_catastral text,
    fondo_id bigint, fondo_nombre text, estado text, fecha_compra date, fecha_venta date, creado_en timestamptz
)
...
    RETURN QUERY
    SELECT a.id, a.codigo, a.direccion, a.municipio, a.referencia_catastral,
           a.fondo_id, f.nombre, a.estado, a.fecha_compra, a.fecha_venta, a.creado_en
    FROM public.activos a
    JOIN public.fondos f ON f.id = a.fondo_id
    WHERE a.id = activo_id;
...
COMMIT;
```

1. **`DROP` y `CREATE`, como en la `025`.** La función devolvía `SETOF public.activos`, filas con la forma exacta de la tabla. Con una columna más, la forma cambia, y `CREATE OR REPLACE` no permite cambiar lo que devuelve una función.
2. **`BEGIN` / `COMMIT`: todo o nada.** Entre el `DROP` y el `CREATE`, si algo fallara, la aplicación se quedaría sin la función. Dentro de una transacción, o se aplica todo o no se aplica nada.
3. **`JOIN` y no `LEFT JOIN`:** `fondo_id` es obligatorio y siempre apunta a un fondo que existe.
4. **El alias en cada columna** (`a.id`, `a.codigo`…). Con `RETURNS TABLE`, cada columna del resultado es también una variable dentro de la función; sin el alias, Postgres no sabría a cuál se refiere `id` ("column reference is ambiguous").
5. **El `DROP` borra los permisos**, así que el `REVOKE` y el `GRANT` se repiten.

| # | Usuario | Prueba | Resultado |
|---|---|---|---|
| 1 | Editor | `consultar_activo(1)` | 1 fila, `fondo_nombre: 'BODEGA DE ALS SL'` |
| 2 | Editor | `consultar_activo(999)` | `[]`, sin apuntar nada |
| 3 | Lector | `consultar_activo(1)` | `400`: "No tienes permiso para consultar activos" |
| 4 | Admin | Leer el registro | `CONSULTA` / `ACTIVOS` / 1; nada del 999 ni del lector |

### 28.2. La ficha en la página

- **Las filas se pueden elegir** con un clic, o con Tab hasta la fila e Intro, y se tiñen del color de Activos. La elegida lleva una barra a la izquierda.
- **La ficha se despliega en tres tiempos**, de izquierda a derecha, como si saliera de la lista: el panel con su etiqueta (0,8 s), después el código y el estado, y por último los datos. Se repite completa en cada selección: se probó una versión más ágil al cambiar de activo y se descartó.
- **La «×» la repliega** hacia la izquierda, en 0,3 s (el cierre, más corto que la apertura), y vuelve el hueco "Elige un activo de la lista".
- **Respuestas tardías:** si se eligen dos activos muy seguidos, cada consulta lleva un número y solo se pinta la última, como en el buscador.
- **El fin del repliegue** se detecta con el aviso `animationend`, filtrando el de la propia ficha (el de sus hijos también sube) y con un temporizador de respaldo de 350 ms por si el aviso no llegara, para que la columna nunca se quede vacía.
- **Sin botón "Editar"** hasta el paso 4: la página no enseña nada que todavía no hace.

Cada ficha abierta queda apuntada como `CONSULTA`. Con el buscador del paso 2, el registro cuenta las dos cosas: qué se buscó y qué activo se abrió.

| id | Acción | `registro_id` |
|---|---|---|
| 148 | `BUSQUEDA` ("calle") | — |
| 149 | `CONSULTA` / `ACTIVOS` | 2 |
| 150 | `CONSULTA` / `ACTIVOS` | 3 |
| 151 | `CONSULTA` / `ACTIVOS` | 4 |

### 28.3. Probar antes de aprobar: una rama de Git

Este paso se construyó en una **rama**, `paso-3-ficha`: una copia paralela del proyecto dentro del mismo repositorio. La rama principal (`main`), la que está en GitHub y funciona, no se tocó mientras se probaba la versión real con Supabase. Aprobada, la rama se fusionó con `main` (*merge*). Si no hubiera convencido, bastaba con volver a `main` y todo habría quedado como estaba.

### 28.4. De paso: el resalte de las tarjetas del login

Probando, apareció un defecto en el login: el velo del resalte asomaba por fuera de la esquina superior izquierda de las tarjetas. Se midieron las esquinas en la imagen (unos 52 px arriba a la izquierda y 56 px abajo a la derecha, de 2752 px de ancho) y el recorte del velo pasó de 0,9 a 1,9 `cqw` y de 2 a 2,05 `cqw`. **Medir en el dibujo en lugar de ajustar a ojo.**

## 29. Las pantallas — paso 4: editar y crear

Quien puede escribir activos (el editor con la sección Activos y el admin) ve dos botones nuevos: **"+ Nuevo activo"** en la barra y **"Editar"** en el pie de la ficha. El formulario aparece en el sitio de la ficha, con la misma animación, y guarda mediante las ventanillas de las secciones 23 y 24: `modificar_activo` y `crear_activo`.

### 29.1. La `033`: la lista de fondos para el desplegable

El fondo propietario se elige en un desplegable con los nombres de los fondos, pero el editor no tiene la sección Fondos. Hizo falta una ventanilla más:

```sql
CREATE FUNCTION public.fondos_para_elegir()
RETURNS TABLE (id bigint, nombre text)
...
    IF NOT privado.puede_escribir('ACTIVOS') THEN
        RAISE EXCEPTION 'No tienes permiso para elegir fondos';
    END IF;

    RETURN QUERY
    SELECT f.id, f.nombre
    FROM public.fondos f
    ORDER BY f.nombre;
```

1. **Solo `id` y `nombre`:** lo que necesita el desplegable. El CIF y el IBAN no salen.
2. **Solo para quien puede escribir activos.** La lista solo sirve para rellenar el formulario: quien no puede guardar un activo no la necesita. Un lector con la sección Activos ve fichas, pero no recibe la lista completa de fondos. Es el principio de dar a cada uno lo mínimo que necesita.
3. **No se apunta en el registro, a propósito.** Es la primera ventanilla de una tabla de negocio que no deja rastro, y la decisión se tomó con sus pros y contras:
   - Es una lista auxiliar que se pide cada vez que se abre el formulario. Apuntarla añadiría a cada edición una línea que no dice qué activo se tocó ni qué cambió.
   - Los nombres de los fondos ya se habían decidido como dato no delicado (sección 28), y `mi_perfil` tampoco se apunta.
   - Lo importante queda registrado igualmente: la creación o la modificación del activo, con el fondo elegido, la apunta el disparador.

   Para que nadie lo tome por un olvido, el motivo está escrito en un comentario al principio de la migración.

| # | Usuario | Prueba | Resultado |
|---|---|---|---|
| 1 | Editor | `fondos_para_elegir()` | 5 fondos por orden alfabético, solo `id` y `nombre` |
| 2 | Lector | lo mismo | `400`: "No tienes permiso para elegir fondos" |
| 3 | Admin | lo mismo | La misma lista |
| 4 | Admin | Leer el registro | Solo los `LOGIN` de las pruebas: la lista no deja rastro |

### 29.2. El formulario

- **Al editar, solo se envían los campos cambiados.** `modificar_activo` entiende "vacío = no cambiar" (sección 23), así que la página compara cada campo con su valor original y manda solo los distintos. Si no ha cambiado nada, avisa sin llamar a la base de datos. Así el registro apunta solo lo que se tocó.
- **Las mismas comprobaciones que las ventanillas**, antes de enviar: código y dirección obligatorios, y fondo elegido. Los mensajes salen en castellano, y la base de datos vuelve a comprobarlo todo al final.
- **Errores sin traducir:** un código o una referencia catastral repetidos llegan como el error `23505` de Postgres, en inglés. La página lo reconoce y lo traduce ("Ya existe un activo con ese código"). Lo escrito se conserva para corregirlo.
- **Guardar se desactiva mientras se envía:** un doble clic no crea el mismo activo dos veces.
- **Después de guardar no se vuelve a consultar.** La ventanilla devuelve la fila guardada, el nombre del fondo se toma de la lista que ya está cargada y la fila de la lista se actualiza sin volver a buscar. Si se hubiera reabierto la ficha con `consultar_activo`, cada guardado dejaría además una `CONSULTA` en el registro.
- **La lista de fondos se pide una sola vez** por visita a la página, aunque se abra el formulario varias veces.

### 29.3. Una limitación: vaciar un campo

`modificar_activo` usa `COALESCE(nuevo_valor, valor_actual)`: si un campo llega vacío, se queda como estaba. Es el "vacío = no cambiar" de la sección 23, y tiene una consecuencia: **desde el formulario no se puede vaciar un campo que ya tenía dato** (por ejemplo, una fecha de venta puesta por error). Además, mandar un texto vacío (`""`) en lugar de nada guardaría un texto vacío en lugar de `NULL`.

Mientras no se cambie la función, la página es honesta: si se vacía un campo que tenía dato, no envía nada y avisa de que, por ahora, no se puede vaciar desde aquí. Nunca parece que se ha guardado algo que no se ha guardado. La limitación se resolvió justo después, con la `034` (sección 30).

### 29.4. Cómo se probó

Primero, con una base de datos simulada que apuntaba cada llamada:

| # | Caso | Resultado | Llamada |
|---|---|---|---|
| 1 | Editar sin cambiar nada | "No has cambiado nada." | Ninguna |
| 2 | Vaciar la fecha de compra | Aviso de que no se puede vaciar | Ninguna |
| 3 | Cambiar municipio y estado | Aviso verde y fila de la lista actualizada | `modificar_activo` solo con esos dos campos |
| 4 | Crear sin código ni dirección | "El código y la dirección son obligatorios." | Ninguna |
| 5 | Crear con un código repetido | "Ya existe un activo con ese código.", conservando lo escrito | `crear_activo`, rechazada |
| 6 | Crear uno válido | Ficha nueva, con el fondo por su nombre | `crear_activo` |
| 7 | Lector con Activos, sin escritura | Ve la ficha, pero ni "Editar" ni "+ Nuevo activo" | — |

Después, con Supabase: se modificó un activo y se creó otro.

| id | Acción | `registro_id` | Detalle |
|---|---|---|---|
| 158 | `CONSULTA` | 6 | — |
| 159 | `MODIFICACION` | 6 | `{"municipio": {"antes": null, "despues": "Madrid"}}` |
| 160 | `CREACION` | 12 | — |

La modificación solo registra el campo que se cambió, y después de guardar no hay ninguna `CONSULTA`.

**De paso, un fallo del paso 3:** al probar la `033` como lector apareció el hueco de la ficha encima de la tarjeta "Sin acceso". La página ocultaba la lista, pero no el contenedor de lista y ficha añadido en el paso 3. Se arregló y se volvieron a probar los tres usuarios. **Lección: al cambiar la estructura de una página, se repiten las pruebas con todos los usuarios, no solo con el editor.**

## 30. Vaciar campos a propósito: la `034`

En `modificar_activo`, un campo que llega vacío significa "no cambiar" (sección 23), así que no había forma de decir "vacía este campo" (sección 29.3). Se estudiaron tres opciones:

- **Una lista explícita de campos a vaciar** (la elegida). Vaciar es una orden clara, no se deduce de un campo en blanco, y si no se manda la lista, la función hace lo mismo que antes.
- **Un paquete JSON** en el que "la clave está, pero vale nulo" significa vaciar. Más flexible, pero obliga a reescribir la función entera y es más difícil de leer.
- **Un valor especial** ("-" o "VACIAR"). Descartado: ese valor podría ser algún día un dato real.

### 30.1. La función

```sql
BEGIN;

DROP FUNCTION public.modificar_activo(bigint, text, text, text, bigint, text, date, date);

CREATE FUNCTION public.modificar_activo(
    activo_id bigint,
    ...
    nueva_fecha_venta date DEFAULT NULL,
    campos_a_vaciar text[] DEFAULT '{}'
)
...
    FOREACH campo IN ARRAY campos_a_vaciar LOOP
        IF campo NOT IN ('municipio', 'referencia_catastral', 'fecha_compra', 'fecha_venta') THEN
            RAISE EXCEPTION 'No se puede vaciar el campo %', campo;
        END IF;
    END LOOP;
...
    UPDATE public.activos a
    SET ...
        municipio = CASE WHEN 'municipio' = ANY(campos_a_vaciar) THEN NULL
                         ELSE COALESCE(nuevo_municipio, a.municipio) END,
...
COMMIT;
```

1. **`text[] DEFAULT '{}'`:** una lista de textos que, si no se manda, está vacía. Por eso nada de lo anterior cambia.
2. **Solo los campos opcionales.** La dirección, el estado y el fondo son obligatorios en la tabla: pedir vaciarlos da un error en castellano, antes de tocar nada.
3. **No se puede pedir a la vez cambiar y vaciar el mismo campo.**
4. **`CASE WHEN 'municipio' = ANY(campos_a_vaciar)`:** "si el campo está en la lista, ponlo a `NULL`; si no, lo de siempre". `ANY` comprueba si un valor está dentro de una lista.
5. **El registro no necesitó cambios:** el disparador ya guarda el antes y el después de cada campo cambiado, también cuando el después es `NULL`.

### 30.2. La firma de una función

Postgres identifica cada función por su nombre **y** por los tipos de sus parámetros: su **firma**. Con un parámetro más, `modificar_activo(bigint, text, text, text, bigint, text, date, date)` pasa a ser otra función. Un `CREATE OR REPLACE` no habría sustituido a la vieja: habría creado una segunda con el mismo nombre (una *sobrecarga*), y Supabase no habría sabido a cuál llamar. Por eso se borró la vieja y se creó la nueva, dentro de una transacción, y el `REVOKE` y el `GRANT` usan la firma nueva, terminada en `text[]`.

La primera prueba fue comprobar que no quedaba la vieja al lado:

```sql
SELECT count(*) FROM pg_proc WHERE proname = 'modificar_activo';   -- 1
```

`pg_proc` es el catálogo interno donde Postgres guarda todas las funciones.

### 30.3. En la página

El aviso de "no se puede vaciar" desapareció: si se borra un campo opcional que tenía dato, la página lo manda en `campos_a_vaciar`.

### 30.4. Cómo se probó

| # | Prueba | Resultado |
|---|---|---|
| 1 | `count(*)` en `pg_proc` | 1 |
| 2 | Borrar el municipio del activo 6 desde la página | Ficha con "Sin dato" |
| 3 | `campos_a_vaciar: ["direccion"]` | "No se puede vaciar el campo direccion" |
| 4 | Cambiar y vaciar a la vez el municipio | "No se puede cambiar y vaciar a la vez el mismo campo" |
| 5 | Leer el registro | `MODIFICACION` 166: `{"municipio": {"antes": "Madrid", "despues": null}}`; nada de las pruebas 3 y 4 |

## 31. El panel del admin — paso 1: preparar el registro y la lista de usuarios

El panel del admin enseña quién usa la aplicación y qué hace: una lista de usuarios con su último inicio de sesión, una línea de tiempo de la actividad y filtros por usuario, acción y fechas. Antes de construirlo se repasó el plan buscando sus puntos débiles, y salieron dos cosas que había que preparar en la base de datos.

### 31.1. La `035`: una sección nueva y los índices que faltaban

```sql
BEGIN;

ALTER TABLE public.registro_actividad
    DROP CONSTRAINT registro_actividad_seccion_check;

ALTER TABLE public.registro_actividad
    ADD CONSTRAINT registro_actividad_seccion_check
    CHECK (seccion IN ('FONDOS', 'ACTIVOS', 'SUMINISTROS', 'ACTIVIDAD'));

CREATE INDEX registro_actividad_perfil_fecha_idx
    ON public.registro_actividad (perfil_id, ocurrido_en DESC);

CREATE INDEX registro_actividad_fecha_idx
    ON public.registro_actividad (ocurrido_en DESC);

COMMIT;
```

1. **Sección `ACTIVIDAD`.** Cuando el admin mira el registro, eso también queda apuntado: quien vigila también deja rastro. La regla de la columna `seccion` solo admitía las tres tablas, así que se borró y se volvió a crear con la sección nueva. Una regla `CHECK` no se puede editar: se quita y se pone otra.
2. **Índices.** Un índice es como el índice de un libro: permite ir directo a las filas sin leer la tabla entera. El diseño en papel ya los preveía, pero ninguna migración los había creado. Uno sirve para "la actividad de este usuario, de la más reciente a la más antigua" y el otro, para "toda la actividad por fecha". Con pocas filas no se nota; con miles, sí.
3. **Todo en una transacción:** o se aplican los cuatro cambios, o ninguno.

### 31.2. La `036`: `usuarios_admin()`

```sql
CREATE FUNCTION public.usuarios_admin()
RETURNS TABLE (id uuid, nombre text, email text, rol text, activo boolean,
               secciones_lectura text[], secciones_escritura text[],
               ultimo_inicio_sesion timestamptz, ultima_actividad timestamptz, acciones bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT privado.es_admin() THEN
        RAISE EXCEPTION 'Solo el administrador puede ver los usuarios';
    END IF;

    RETURN QUERY
    SELECT p.id, p.nombre, u.email::text, p.rol, p.activo,
           ...,   -- secciones de lectura y de escritura según el rol
           (SELECT max(r.ocurrido_en) FROM public.registro_actividad r WHERE r.perfil_id = p.id AND r.accion = 'LOGIN'),
           (SELECT max(r.ocurrido_en) FROM public.registro_actividad r WHERE r.perfil_id = p.id),
           (SELECT count(*) FROM public.registro_actividad r WHERE r.perfil_id = p.id)
    FROM public.perfiles p
    JOIN auth.users u ON u.id = p.id
    ORDER BY p.nombre;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (auth.uid(), 'CONSULTA', 'ACTIVIDAD', jsonb_build_object('vista', 'usuarios'));
END;
$$;
```

1. **Solo el admin.** El guardián de siempre (`privado.es_admin()`), con un mensaje en castellano.
2. **El correo sale de `auth.users`**, la tabla de cuentas de Supabase, para saber qué cuenta es cada persona. Una función `SECURITY DEFINER` puede leerla; la página, directamente, no.
3. **"Último inicio de sesión" y "última actividad", y no "última conexión".** Una sesión recordada no genera un `LOGIN` nuevo, así que "última conexión" habría sido un dato inexacto. Se enseñan los dos datos con su nombre real.
4. **Subconsultas por usuario:** cada `(SELECT ...)` calcula un dato de esa persona en el registro. Aquí es donde trabajan los índices de la `035`.
5. **Se apunta después de leer.** Si el `INSERT` fuera antes, la propia consulta contaría en la actividad del admin que se está calculando.
6. **Una duplicación consciente.** Las secciones repiten las reglas de `tiene_seccion` y `puede_escribir` (secciones 8 y 10), porque esas funciones solo sirven para el usuario que llama. Si cambian esas reglas, hay que cambiar también esta función; está avisado en un comentario.

### 31.3. Cómo se probó

| # | Prueba | Resultado |
|---|---|---|
| 1 | Ejecutar la `035` y mirar `pg_indexes` | Los dos índices creados |
| 2 | Ejecutar la `036` | "Success" |
| 3 | Admin | Los 3 usuarios ordenados por nombre. Admin: las tres secciones, su último inicio de sesión igual a su última actividad (la consulta en curso no se cuenta), 61 acciones. Editor: lee y escribe Activos, 71. Lector: lee Fondos y Suministros, no escribe en ninguna, 39 |
| 4 | Editor | "Solo el administrador puede ver los usuarios" |
| 5 | Sin sesión | `401`: "permission denied for function usuarios_admin" (el `REVOKE` a `anon`) |
| 6 | Leer el registro | 170: `CONSULTA` / `ACTIVIDAD` / `{"vista": "usuarios"}`; nada del intento del editor. Que se guardara con `ACTIVIDAD` confirma también la regla nueva de la `035` |

## 32. El panel del admin — paso 2: la línea de tiempo, `actividad_admin`

La segunda ventanilla del panel entrega el registro de actividad como una línea de tiempo, de lo más reciente a lo más antiguo, con filtros por usuario, acción y fechas, y por páginas.

### 32.1. La `037`

```sql
CREATE FUNCTION public.actividad_admin(
    filtro_usuario uuid DEFAULT NULL,
    filtro_accion text DEFAULT NULL,
    desde timestamptz DEFAULT NULL,
    hasta timestamptz DEFAULT NULL,
    ocultar_mis_consultas boolean DEFAULT true,
    antes_de bigint DEFAULT NULL,
    tamano integer DEFAULT 50
)
RETURNS TABLE (id bigint, ocurrido_en timestamptz, perfil_id uuid, nombre text, accion text,
               seccion text, registro_id bigint, registro_etiqueta text, detalle jsonb)
...
    IF NOT privado.es_admin() THEN
        RAISE EXCEPTION 'Solo el administrador puede ver la actividad';
    END IF;
    ...   -- validar la acción, el orden de las fechas y el tamaño (entre 1 y 200)

    RETURN QUERY
    SELECT r.id, r.ocurrido_en, r.perfil_id, p.nombre, r.accion, r.seccion, r.registro_id,
        CASE r.seccion
            WHEN 'ACTIVOS' THEN (SELECT a.codigo FROM public.activos a WHERE a.id = r.registro_id)
            WHEN 'FONDOS' THEN (SELECT f.nombre FROM public.fondos f WHERE f.id = r.registro_id)
            WHEN 'SUMINISTROS' THEN (SELECT s.tipo || ' · ' || a.codigo ...)
        END,
        r.detalle
    FROM public.registro_actividad r
    JOIN public.perfiles p ON p.id = r.perfil_id
    WHERE (filtro_usuario IS NULL OR r.perfil_id = filtro_usuario)
      AND (filtro_accion IS NULL OR r.accion = filtro_accion)
      AND (desde IS NULL OR r.ocurrido_en >= desde)
      AND (hasta IS NULL OR r.ocurrido_en < hasta)
      AND (antes_de IS NULL OR r.id < antes_de)
      AND NOT (coalesce(ocultar_mis_consultas, true)
               AND r.perfil_id = yo
               AND r.seccion IS NOT DISTINCT FROM 'ACTIVIDAD')
    ORDER BY r.id DESC
    LIMIT tamano;

    GET DIAGNOSTICS resultados = ROW_COUNT;

    INSERT INTO public.registro_actividad (perfil_id, accion, seccion, detalle)
    VALUES (yo, 'CONSULTA', 'ACTIVIDAD', jsonb_strip_nulls(jsonb_build_object(
        'vista', 'actividad', 'usuario', filtro_usuario, 'accion', filtro_accion,
        'desde', desde, 'hasta', hasta, ..., 'antes_de', antes_de, 'tamano', tamano,
        'resultados', resultados)));
```

1. **Todos los filtros son opcionales.** Cada condición tiene la forma "o no se ha pedido, o se cumple" (`filtro IS NULL OR ...`), así que sin filtros sale todo.
2. **Los parámetros llevan prefijo** (`filtro_usuario`, `filtro_accion`). En `plpgsql`, las columnas de `RETURNS TABLE` funcionan como variables; si un parámetro se llamara `accion`, como una de ellas, Postgres no sabría a cuál se refiere. Por lo mismo, todas las columnas van con su alias (`r.`, `p.`).
3. **Validaciones antes de leer:** la acción tiene que ser una de las que admite la tabla, la fecha de inicio tiene que ser anterior a la de fin y el tamaño de página tiene que estar entre 1 y 200, para que nadie pida el registro entero de una vez.
4. **Una etiqueta legible.** `registro_id` solo se entiende junto a su sección: el 4 de Activos y el 4 de Fondos son cosas distintas. El `CASE` lo traduce al código del activo, al nombre del fondo o al tipo y el código del activo de un suministro ("LUZ · ACT-001").
5. **Queda registrada, con los filtros.** `detalle` guarda los filtros usados, la página y cuántas filas devolvió (`GET DIAGNOSTICS`, como en la sección 16). `jsonb_strip_nulls` quita los filtros que no se usaron. Se apunta después de leer, como en la `036`.

### 32.2. Páginas por cursor, no "saltar N filas"

La forma habitual de paginar es "sáltate las 50 primeras y dame 50" (`OFFSET`). Aquí falla: **cada llamada escribe una fila nueva en el registro**. Al pedir la página 2, esa fila nueva ha empujado todo un puesto hacia abajo, y la última fila de la página 1 vuelve a salir al principio de la página 2.

Con un **cursor**, la página pide "dame las 50 anteriores a la fila 169" (`antes_de`, el id de la última fila recibida). Lo que se añada arriba no mueve nada por debajo de la 169. Además, Postgres va directo a esa fila por la clave primaria, en vez de leer y descartar las que se salta.

### 32.3. Las fechas y el desfase con UTC

Supabase guarda y compara las fechas en UTC, y España va una hora por delante (dos en verano). Si la función recibiera un día (`date`), "el 16/11" empezaría a las 00:00 UTC, que es la 1:00 en España: se perdería lo ocurrido entre medianoche y la una.

Por eso `desde` y `hasta` son `timestamptz` (fecha y hora con zona) y **los calcula la página**, que sabe en qué zona está el navegador. Para "hoy", manda la medianoche local de hoy y la de mañana. `hasta` no se incluye (`<`, no `<=`), así que "hasta la medianoche de mañana" es exactamente "todo hoy".

### 32.4. La trampa del `NULL`

La casilla "Ocultar mis consultas del registro" quita las filas que son del admin **y** de la sección `ACTIVIDAD`. Escrito con `=`, sería `NOT (... AND r.seccion = 'ACTIVIDAD')`. Pero un `LOGIN` no tiene sección (`NULL`), y en SQL `NULL = 'ACTIVIDAD'` no da falso: da **desconocido**. Un `NOT` de algo desconocido sigue siendo desconocido, y el `WHERE` solo deja pasar lo verdadero. Resultado: **los inicios de sesión del admin desaparecerían de la lista**, sin ningún error.

`IS NOT DISTINCT FROM` compara tratando `NULL` como un valor más: `NULL IS NOT DISTINCT FROM 'ACTIVIDAD'` da falso, y la fila se queda. El filtro se aplica en la base de datos, y no en la página, para que una página de 50 filas no llegue con 30 escondidas.

### 32.5. Cómo se probó

Desde la consola del navegador, con una ayuda que pinta la respuesta en tabla y con la hora local.

| # | Prueba | Resultado |
|---|---|---|
| 1 | Ejecutar la `037` | "Success" |
| 2 | Admin, 5 filas | 175, 173, 172, 171, 169: se salta sus consultas del registro (170 y 174) y conserva sus `LOGIN` |
| 3 | Página 2 (`antes_de` 169) | 168 a 164, sin repetir ninguna, aunque la llamada anterior había escrito la 176 |
| 4 | Solo `MODIFICACION` | Las tres etiquetas: `ACT-006`, `LUZ · ACT-…` y el nombre de un fondo |
| 5 | Hoy, en hora local | 5 filas, entre ellas la 169, la 171 y la 172, que en UTC son del 15/11 (23:18) y en España del 16/11 (0:18). La 168, del 15/11 en España, queda fuera |
| 6 | Sin ocultar | Aparecen arriba sus consultas 176-179 |
| 7 | Acción `BAILAR`, tamaño 500, fechas al revés | Los tres mensajes en castellano |
| 8 | Solo el editor | 10 filas, todas suyas |
| 9 | Editor | "Solo el administrador puede ver la actividad" |
| 10 | Sin sesión | `401`: "permission denied for function actividad_admin" |
| 11 | `detalle` de las consultas | 177 con `antes_de: 169`; 178 con `accion`; 179 con `desde: 2026-11-15T23:00:00+00:00` (la medianoche de España en UTC); 184 con `usuario`. Entre la 180 y la 183 solo hay dos `LOGIN`: los errores y los rechazos no dejan rastro |

---

*Pendiente como ampliación: `LOGOUT` y `ACCESO_DENEGADO`.*
