const clienteSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const NOMBRES_SECCION = {
    ACTIVOS: "Activos",
    FONDOS: "Fondos",
    SUMINISTROS: "Suministros",
};

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

// 2. Rellena la cabecera y la tarjeta con lo que ha devuelto mi_perfil().
//    Quien no tiene la sección Activos ve la tarjeta "Sin acceso" en lugar de la de su sesión.
function mostrarPerfil(perfil) {
    document.getElementById("nombre-usuario").textContent = perfil.nombre;

    const rol = document.getElementById("rol-usuario");
    rol.textContent = perfil.rol;
    rol.classList.add("rol-" + perfil.rol.toLowerCase());

    if (perfil.secciones_lectura.includes("ACTIVOS")) {
        pintarSecciones(document.getElementById("secciones-lectura"), perfil.secciones_lectura);
        pintarSecciones(document.getElementById("secciones-escritura"), perfil.secciones_escritura);
    } else {
        document.getElementById("tarjeta-sesion").hidden = true;
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

// 4. Cerrar sesión.
document.getElementById("boton-salir").addEventListener("click", async function () {
    await clienteSupabase.auth.signOut();
    window.location.replace("login.html");
});

iniciar();
