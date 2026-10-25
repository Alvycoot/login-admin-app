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

---

*Pendiente como ampliación: `LOGOUT` y `ACCESO_DENEGADO`.*
