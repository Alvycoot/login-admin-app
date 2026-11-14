const clienteSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const NOMBRES_SECCION = {
    ACTIVOS: "Activos",
    FONDOS: "Fondos",
    SUMINISTROS: "Suministros",
};

// Cuándo se lanza la búsqueda automática (cada búsqueda queda apuntada en el registro de actividad):
// con al menos MIN_LETRAS y cuando se deja de escribir durante ESPERA_MS. Intro busca al momento con cualquier texto.
// Son puntos de partida: se ajustan probando.
const MIN_LETRAS = 3;
const ESPERA_MS = 600;

// 1. El guardián: sin sesión o sin perfil activo, de vuelta al login.
async function iniciar() {
    const { data: datosSesion } = await clienteSupabase.auth.getSession();
    if (!datosSesion.session) {
        window.location.replace("login.html");
        return;
    }

    const { data: perfiles, error } = await clienteSupabase.rpc("mi_perfil");
    if (error || !perfiles || perfiles.length === 0) {
        console.log("No se pudo cargar el perfil:", error);
        await clienteSupabase.auth.signOut();
        window.location.replace("login.html");
        return;
    }

    mostrarPerfil(perfiles[0]);
}

// 2. Rellena la cabecera y la barra con lo que ha devuelto mi_perfil().
//    Quien no tiene la sección Activos ve la tarjeta "Sin acceso" en lugar del buscador.
function mostrarPerfil(perfil) {
    document.getElementById("nombre-usuario").textContent = perfil.nombre;

    const rol = document.getElementById("rol-usuario");
    rol.textContent = perfil.rol;
    rol.classList.add("rol-" + perfil.rol.toLowerCase());

    if (perfil.secciones_lectura.includes("ACTIVOS")) {
        pintarSecciones(document.getElementById("secciones-lectura"), perfil.secciones_lectura);
        pintarSecciones(document.getElementById("secciones-escritura"), perfil.secciones_escritura);
        pintarEstado("Escribe al menos " + MIN_LETRAS + " letras, o pulsa Intro para buscar.", "Busca por código, dirección o municipio.");
    } else {
        document.getElementById("barra").hidden = true;
        document.getElementById("resultados").hidden = true;
        document.getElementById("sin-acceso").hidden = false;
        pintarSecciones(document.getElementById("secciones-lector"), perfil.secciones_lectura);
    }

    document.getElementById("cabecera").hidden = false;
    document.getElementById("contenido").hidden = false;
}

// 3. Una etiqueta por sección, o "Ninguna" si la lista viene vacía.
//    Cada etiqueta va dentro de su envoltorio de sombra (.sombra-pildora).
function pintarSecciones(contenedor, secciones) {
    if (secciones.length === 0) {
        const vacio = document.createElement("span");
        vacio.className = "texto-suave";
        vacio.textContent = "Ninguna";
        contenedor.appendChild(vacio);
        return;
    }

    for (const seccion of secciones) {
        const envoltorio = document.createElement("span");
        envoltorio.className = "sombra-pildora";
        const pildora = document.createElement("span");
        pildora.className = "pildora pildora-seccion seccion-" + seccion.toLowerCase();
        pildora.textContent = NOMBRES_SECCION[seccion] || seccion;
        envoltorio.appendChild(pildora);
        contenedor.appendChild(envoltorio);
    }
}

// 4. El buscador (paso 2).
const campoBusqueda = document.getElementById("texto-busqueda");
let temporizador = null;    // la búsqueda automática pendiente
let ultimaBuscada = null;   // para no repetir (y apuntar dos veces) la misma búsqueda seguida
let numeroBusqueda = 0;     // para pintar solo la respuesta de la última búsqueda lanzada

campoBusqueda.addEventListener("input", function () {
    clearTimeout(temporizador);
    const texto = campoBusqueda.value.trim();
    if (texto === "") {
        ultimaBuscada = null;
        pintarEstado("Escribe al menos " + MIN_LETRAS + " letras, o pulsa Intro para buscar.", "Busca por código, dirección o municipio.");
    } else if (texto.length >= MIN_LETRAS) {
        temporizador = setTimeout(function () { buscar(texto); }, ESPERA_MS);
    }
});

campoBusqueda.addEventListener("keydown", function (evento) {
    if (evento.key !== "Enter") return;
    evento.preventDefault();
    clearTimeout(temporizador);
    const texto = campoBusqueda.value.trim();
    if (texto !== "") buscar(texto);
});

async function buscar(texto) {
    if (texto === ultimaBuscada) return;
    ultimaBuscada = texto;
    const esta = ++numeroBusqueda;

    const { data, error } = await clienteSupabase.rpc("buscar_activos", { texto: texto });
    if (esta !== numeroBusqueda) return;   // ya hay una búsqueda más reciente: esta respuesta llega tarde

    if (error) {
        console.log("Error al buscar:", error);
        ultimaBuscada = null;   // se podrá reintentar
        pintarEstado("No se pudo hacer la búsqueda.", error.message, true);
        desplegarResultados();
        return;
    }

    document.getElementById("aviso-registrada").hidden = false;
    const cuantos = data.length === 1 ? "1 resultado" : data.length + " resultados";
    document.getElementById("meta-busqueda").textContent = cuantos + " para «" + texto + "»";

    if (data.length === 0) {
        pintarFilaUnica("Ningún activo coincide con la búsqueda.");
        desplegarResultados();
        return;
    }

    const filas = document.getElementById("filas");
    filas.replaceChildren();
    data.forEach(function (activo, posicion) {
        const fila = document.createElement("tr");
        fila.style.setProperty("--i", posicion);   // su turno en la entrada una a una
        fila.append(celda(activo.codigo, "codigo"), celda(activo.direccion), celda(activo.municipio, "texto-suave"));
        filas.appendChild(fila);
    });
    desplegarResultados();
}

// Vuelve a lanzar la animación de entrada del panel de resultados (en cada búsqueda, completa)
function desplegarResultados() {
    const panel = document.getElementById("resultados");
    panel.classList.remove("aparece-3", "despliega-abajo");
    void panel.offsetWidth;   // obliga al navegador a "olvidar" la animación anterior antes de repetirla
    panel.classList.add("despliega-abajo");
}

function celda(texto, clase) {
    const td = document.createElement("td");
    if (clase) td.className = clase;
    td.textContent = texto || "";
    return td;
}

// Mensaje sobre la tabla y una sola fila con un aviso (sin búsqueda, sin resultados o error)
function pintarEstado(meta, aviso, esError) {
    document.getElementById("meta-busqueda").textContent = meta;
    document.getElementById("aviso-registrada").hidden = true;
    pintarFilaUnica(aviso, esError);
}

function pintarFilaUnica(texto, esError) {
    const fila = document.createElement("tr");
    const td = celda(texto, esError ? "vacio error" : "vacio");
    td.colSpan = 3;
    fila.appendChild(td);
    document.getElementById("filas").replaceChildren(fila);
}

// 5. Cerrar sesión.
document.getElementById("boton-salir").addEventListener("click", async function () {
    await clienteSupabase.auth.signOut();
    window.location.replace("login.html");
});

iniciar();
