const clienteSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Eventos por página de la línea de tiempo (actividad_admin admite entre 1 y 200)
const TAMANO = 50;

const NOMBRES_SECCION = { ACTIVOS: "Activos", FONDOS: "Fondos", SUMINISTROS: "Suministros", ACTIVIDAD: "Actividad" };
const ACCIONES = { LOGIN: "Inicio de sesión", LOGOUT: "Cierre de sesión", BUSQUEDA: "Búsqueda", CONSULTA: "Consulta", CREACION: "Creación", MODIFICACION: "Modificación", BORRADO: "Borrado", ACCESO_DENEGADO: "Acceso denegado" };
const VERBOS = { LOGIN: "inició sesión", LOGOUT: "cerró sesión", BUSQUEDA: "buscó", CONSULTA: "consultó", CREACION: "creó", MODIFICACION: "modificó", BORRADO: "borró", ACCESO_DENEGADO: "intentó acceder a" };
// Nombres legibles de las columnas que pueden salir en el detalle de una modificación (activos, fondos y suministros)
const COLUMNAS = {
    codigo: "Código", direccion: "Dirección", municipio: "Municipio", referencia_catastral: "Referencia catastral",
    fondo_id: "Fondo (n.º)", estado: "Estado", fecha_compra: "Fecha de compra", fecha_venta: "Fecha de venta",
    nombre: "Nombre", cif: "CIF", iban: "IBAN",
    activo_id: "Activo (n.º)", tipo: "Tipo", cups: "CUPS", potencia_contratada_kw: "Potencia contratada (kW)", tipo_instalacion_gas: "Instalación de gas",
};
// Lo que actividad_admin apunta en detalle de cada consulta del registro
const FILTROS = { vista: "Vista", usuario: "Usuario", accion: "Acción", desde: "Desde", hasta: "Hasta (sin incluir)", ocultar_mis_consultas: "Ocultar mis consultas", antes_de: "Antes del n.º", tamano: "Tamaño de página", resultados: "Resultados" };

let yo = null;        // id del administrador que ha entrado: sus consultas del registro salen apagadas
let usuarios = [];    // la última lista de usuarios_admin: rellena el filtro y pone nombre a los id del detalle

// 1. El guardián: sin sesión o sin perfil activo, de vuelta al login; si no es administrador, a Activos.
//    Solo decide qué página se enseña: aunque alguien la abriera a la fuerza, usuarios_admin y actividad_admin
//    comprueban en la base de datos que quien llama es el administrador.
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

    const perfil = perfiles[0];
    if (perfil.rol !== "ADMIN") {
        window.location.replace("activos.html");
        return;
    }

    yo = datosSesion.session.user.id;
    document.getElementById("nombre-usuario").textContent = perfil.nombre;
    const rol = document.getElementById("rol-usuario");
    rol.textContent = perfil.rol;
    rol.classList.add("rol-admin");
    document.getElementById("cabecera").hidden = false;
    document.getElementById("contenido").hidden = false;

    elegirVista("usuarios");
}

// 2. Utilidades.
function crear(etiqueta, clase, texto) {
    const elemento = document.createElement(etiqueta);
    if (clase) elemento.className = clase;
    if (texto !== undefined && texto !== null) elemento.textContent = texto;
    return elemento;
}

// Etiqueta dentro de su envoltorio de sombra (.sombra-pildora)
function pildora(texto, clase) {
    const envoltorio = crear("span", "sombra-pildora");
    envoltorio.appendChild(crear("span", "pildora " + clase, texto));
    return envoltorio;
}

function dosCifras(n) { return String(n).padStart(2, "0"); }

// La fecha local de un momento, como "2026-11-16" (para agrupar por día en la hora de quien mira)
function diaLocal(fecha) {
    return fecha.getFullYear() + "-" + dosCifras(fecha.getMonth() + 1) + "-" + dosCifras(fecha.getDate());
}

function horaLocal(fecha) {
    return dosCifras(fecha.getHours()) + ":" + dosCifras(fecha.getMinutes());
}

// "16 nov · 03:35"
function fechaCorta(texto) {
    const fecha = new Date(texto);
    return fecha.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + " · " + horaLocal(fecha);
}

function haceCuanto(texto) {
    const minutos = Math.round((Date.now() - new Date(texto)) / 60000);
    if (minutos < 1) return "ahora mismo";
    if (minutos < 60) return "hace " + minutos + " min";
    const horas = Math.round(minutos / 60);
    if (horas < 24) return "hace " + horas + " h";
    const dias = Math.round(horas / 24);
    return dias === 1 ? "hace 1 día" : "hace " + dias + " días";
}

function tituloDia(dia) {
    const hoy = diaLocal(new Date());
    const ayer = diaLocal(new Date(Date.now() - 86400000));
    const largo = new Date(dia + "T12:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    if (dia === hoy) return "Hoy · " + largo;
    if (dia === ayer) return "Ayer · " + largo;
    return largo;
}

// Medianoche local del día elegido ("2026-11-16"), como momento exacto. desplazamiento 1 = la del día siguiente.
// Las fechas viajan como momentos y no como días: con días, la base de datos los cortaría en UTC
// y lo que pasó entre las 00:00 y la 01:00 de aquí caería en el día anterior.
function medianocheLocal(texto, desplazamiento) {
    const partes = texto.split("-").map(Number);
    return new Date(partes[0], partes[1] - 1, partes[2] + desplazamiento).toISOString();
}

function nombreUsuario(id) {
    const encontrado = usuarios.find(function (u) { return u.id === id; });
    return encontrado ? encontrado.nombre : id;
}

// Relanza una animación de entrada: quitar la clase, obligar al navegador a notarlo y volver a ponerla
function relanzar(nodo, clase) {
    nodo.classList.remove(clase);
    void nodo.offsetWidth;
    nodo.classList.add(clase);
}

// 3. Paneles que esperan a sus datos.
//    Mientras llegan, el panel se queda invisible y quieto: no se ve el contenido viejo
//    ni desaparece de golpe al empezar la bajada. Baja una sola vez, ya con los datos nuevos.
//    Cada carga lleva un número; si al llegar ya se ha pedido otra (cambio rápido de vista), se descarta.
let numeroCarga = 0;

function esperarDatos(bloque) {
    bloque.classList.remove("despliega-abajo");
    bloque.classList.add("esperando");
    return ++numeroCarga;
}

function mostrarBloque(bloque) {
    bloque.classList.remove("esperando");
    relanzar(bloque, "despliega-abajo");
}

// 4. Vista "Usuarios" (usuarios_admin). Cada vez que se abre, la base de datos apunta una CONSULTA / ACTIVIDAD.
async function mostrarUsuarios() {
    const meta = document.getElementById("meta-usuarios");
    const filas = document.getElementById("filas-usuarios");
    const aviso = document.getElementById("registrada-usuarios");
    const vista = document.getElementById("vista-usuarios");
    const esta = esperarDatos(vista);
    aviso.hidden = true;

    const { data, error } = await clienteSupabase.rpc("usuarios_admin");
    if (esta !== numeroCarga) return;   // ya se ha pedido otra vista: esta respuesta llega tarde

    filas.replaceChildren();
    if (error) {
        console.log("Error al cargar los usuarios:", error);
        meta.textContent = "";
        const fila = crear("tr");
        const td = crear("td", "vacio error", "No se pudo cargar la lista de usuarios. " + error.message);
        td.colSpan = 8;
        fila.appendChild(td);
        filas.appendChild(fila);
        mostrarBloque(vista);
        return;
    }

    usuarios = data;   // ya vienen ordenados por nombre
    rellenarFiltroUsuarios();

    data.forEach(function (u, posicion) {
        const fila = crear("tr", u.activo ? "" : "inactivo");
        fila.style.setProperty("--i", posicion);   // su turno en la entrada una a una
        fila.tabIndex = 0;                         // se llega con Tab y se abre con Intro
        fila.title = "Ver la actividad de " + u.nombre;

        const persona = crear("td", "persona");
        persona.append(crear("strong", "", u.nombre), crear("span", "", u.email));

        const rol = crear("td");
        rol.appendChild(pildora(u.rol, u.rol === "ADMIN" ? "rol-admin" : u.rol === "EDITOR" ? "rol-editor" : ""));

        const estado = crear("td");
        estado.appendChild(pildora(u.activo ? "Activo" : "Desactivado", u.activo ? "estado-activo" : "estado-inactivo"));

        const permisos = crear("td");
        const lista = crear("dl", "permisos");
        for (const [titulo, secciones] of [["Lee", u.secciones_lectura], ["Escribe", u.secciones_escritura]]) {
            const dd = crear("dd");
            if (secciones.length === 0) dd.appendChild(crear("span", "texto-suave", "Ninguna"));
            for (const s of secciones) dd.appendChild(pildora(NOMBRES_SECCION[s] || s, "pildora-seccion seccion-" + s.toLowerCase()));
            lista.append(crear("dt", "", titulo), dd);
        }
        permisos.appendChild(lista);

        fila.append(persona, rol, estado, permisos, celdaMomento(u.ultimo_inicio_sesion), celdaMomento(u.ultima_actividad),
            crear("td", "numero", Number(u.acciones).toLocaleString("es-ES")), crear("td", "flecha", "›"));

        fila.addEventListener("click", function () { irAActividadDe(u.id); });
        fila.addEventListener("keydown", function (evento) {
            if (evento.key === "Enter" || evento.key === " ") { evento.preventDefault(); irAActividadDe(u.id); }
        });
        filas.appendChild(fila);
    });

    const activos = data.filter(function (u) { return u.activo; }).length;
    meta.textContent = data.length + (data.length === 1 ? " usuario · " : " usuarios · ") + activos + (activos === 1 ? " activo" : " activos") + " · pulsa una fila para ver su actividad";
    aviso.hidden = false;
    mostrarBloque(vista);
}

// "16 nov · 03:35" y debajo "hace 5 días"; quien nunca ha entrado o no ha hecho nada, "Nunca"
function celdaMomento(texto) {
    const td = crear("td", "momento");
    if (!texto) {
        td.appendChild(crear("span", "sin-dato", "Nunca"));
        return td;
    }
    td.append(fechaCorta(texto), crear("small", "", haceCuanto(texto)));
    return td;
}

// 5. Vista "Actividad" (actividad_admin): filtros.
//    Los filtros se aplican con el botón, no al cambiarlos: cada carga queda apuntada en el registro
//    y apuntar cada clic lo llenaría.
const formFiltros = document.getElementById("form-filtros");
const campos = {
    usuario: document.getElementById("f-usuario"),
    accion: document.getElementById("f-accion"),
    desde: document.getElementById("f-desde"),
    hasta: document.getElementById("f-hasta"),
    ocultar: document.getElementById("f-ocultar"),
};
let aplicados = leerFiltros();   // los filtros de la línea de tiempo que se está viendo

for (const [valor, texto] of Object.entries(ACCIONES)) campos.accion.appendChild(new Option(texto, valor));

// El filtro de usuario se rellena con la lista de usuarios_admin (el panel se abre en Usuarios),
// sin pedirla otra vez: cada petición dejaría otra CONSULTA en el registro.
function rellenarFiltroUsuarios() {
    const elegido = campos.usuario.value;
    campos.usuario.replaceChildren(new Option("Todos", ""));
    for (const u of usuarios) campos.usuario.appendChild(new Option(u.nombre, u.id));
    campos.usuario.value = elegido;
    if (campos.usuario.value !== elegido) campos.usuario.value = "";
}

function leerFiltros() {
    return {
        usuario: campos.usuario.value,
        accion: campos.accion.value,
        desde: campos.desde.value,
        hasta: campos.hasta.value,
        ocultar: campos.ocultar.checked,
    };
}

function mismosFiltros(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

formFiltros.addEventListener("input", function () {
    document.getElementById("sin-aplicar").hidden = mismosFiltros(leerFiltros(), aplicados);
});

formFiltros.addEventListener("submit", function (evento) {
    evento.preventDefault();
    const filtros = leerFiltros();
    const error = document.getElementById("error-filtros");
    // La base de datos lo comprueba igualmente; la página avisa antes para no gastar una llamada (ni una fila del registro)
    if (filtros.desde && filtros.hasta && filtros.desde > filtros.hasta) {
        error.textContent = "La fecha de inicio tiene que ser anterior a la de fin.";
        error.hidden = false;
        return;
    }
    error.hidden = true;
    aplicados = filtros;
    document.getElementById("sin-aplicar").hidden = true;
    cargarActividad(true);
});

document.getElementById("boton-limpiar").addEventListener("click", function () {
    campos.usuario.value = "";
    campos.accion.value = "";
    campos.desde.value = "";
    campos.hasta.value = "";
    campos.ocultar.checked = true;
    document.getElementById("error-filtros").hidden = true;
    formFiltros.requestSubmit();
});

document.getElementById("boton-mas").addEventListener("click", function () { cargarActividad(false); });

// 6. Vista "Actividad": la línea de tiempo.
//    Páginas por cursor: "Cargar más" pide los eventos anteriores al último recibido (antes_de).
const linea = document.getElementById("linea-tiempo");
let cursor = null;      // id del último evento recibido
let ultimoDia = null;   // el día del último grupo pintado, para seguir en él al cargar más

async function cargarActividad(desdeCero) {
    const meta = document.getElementById("meta-actividad");
    const aviso = document.getElementById("registrada-actividad");
    const bloque = document.getElementById("bloque-actividad");
    const zonaMas = document.getElementById("zona-mas");
    const botonMas = document.getElementById("boton-mas");
    const filtros = aplicados;

    // Desde cero (cambio de vista, Aplicar, Limpiar), el panel espera invisible.
    // Con "Cargar más" se queda a la vista: lo cargado no cambia y solo se añaden eventos debajo.
    let esta;
    if (desdeCero) {
        cursor = null;
        ultimoDia = null;
        aviso.hidden = true;
        esta = esperarDatos(bloque);
    } else {
        esta = ++numeroCarga;
        meta.textContent = "Cargando…";
    }

    const parametros = { ocultar_mis_consultas: filtros.ocultar, tamano: TAMANO };
    if (filtros.usuario) parametros.filtro_usuario = filtros.usuario;
    if (filtros.accion) parametros.filtro_accion = filtros.accion;
    if (filtros.desde) parametros.desde = medianocheLocal(filtros.desde, 0);
    if (filtros.hasta) parametros.hasta = medianocheLocal(filtros.hasta, 1);   // "hasta" no se incluye: la medianoche del día siguiente
    if (cursor !== null) parametros.antes_de = cursor;

    botonMas.disabled = true;   // un doble clic no pide (ni apunta) la misma página dos veces
    const { data, error } = await clienteSupabase.rpc("actividad_admin", parametros);
    botonMas.disabled = false;
    if (esta !== numeroCarga) return;   // ya se ha pedido otra carga: esta respuesta llega tarde

    if (error) {
        console.log("Error al cargar la actividad:", error);
        meta.textContent = "";
        if (desdeCero) linea.replaceChildren();
        linea.appendChild(crear("p", "vacio error", "No se pudo cargar la actividad. " + error.message));
        zonaMas.hidden = true;
        aviso.hidden = true;
        if (desdeCero) mostrarBloque(bloque);
        return;
    }

    if (desdeCero) linea.replaceChildren();
    if (desdeCero && data.length === 0) linea.appendChild(crear("p", "vacio", "No hay actividad con estos filtros."));
    pintarEventos(data);
    if (data.length > 0) cursor = data[data.length - 1].id;
    const hayMas = data.length === TAMANO;

    const cargados = linea.querySelectorAll(".evento").length;
    meta.textContent = cargados === 0 ? "Sin resultados"
        : cargados + (cargados === 1 ? " evento" : " eventos") + (hayMas ? " · hay más" : "") + (filtros.ocultar ? " · sin tus consultas del registro" : "");
    zonaMas.hidden = !hayMas;
    aviso.hidden = false;
    if (desdeCero) mostrarBloque(bloque);
}

// Agrupa los eventos por día (en la hora local) y los añade debajo de lo ya cargado
function pintarEventos(eventos) {
    let grupo = ultimoDia ? linea.querySelector('.dia[data-dia="' + ultimoDia + '"] ol') : null;
    eventos.forEach(function (r, posicion) {
        const dia = diaLocal(new Date(r.ocurrido_en));
        if (dia !== ultimoDia || !grupo) {
            const bloqueDia = crear("section", "dia entra");
            bloqueDia.dataset.dia = dia;
            bloqueDia.style.setProperty("--i", posicion);
            bloqueDia.appendChild(crear("p", "eyebrow", tituloDia(dia)));
            grupo = crear("ol");
            bloqueDia.appendChild(grupo);
            linea.appendChild(bloqueDia);
            ultimoDia = dia;
        }
        grupo.appendChild(crearEvento(r, posicion));
    });
}

// Si el detalle de una modificación tiene la forma {"columna": {"antes", "despues"}} (la de la 017)
function esDetalleDeCambios(detalle) {
    return Object.values(detalle).every(function (v) { return v !== null && typeof v === "object" && "antes" in v && "despues" in v; });
}

function crearEvento(r, posicion) {
    // Clase de color de la acción: LOGIN → a-login, ACCESO_DENEGADO → a-acceso-denegado
    const claseAccion = "a-" + r.accion.toLowerCase().replace("_", "-");
    const propia = r.perfil_id === yo && r.seccion === "ACTIVIDAD";
    const evento = crear("li", "evento entra " + claseAccion + (propia ? " propia" : ""));
    evento.style.setProperty("--i", posicion);

    // Se despliega todo lo que trae detalle, menos las búsquedas (su texto y sus resultados ya van en la frase)
    const tieneDetalle = r.detalle !== null && typeof r.detalle === "object" && Object.keys(r.detalle).length > 0;
    const desplegable = tieneDetalle && r.accion !== "BUSQUEDA";
    const fila = crear(desplegable ? "button" : "div", "evento-fila");
    if (desplegable) { fila.type = "button"; fila.setAttribute("aria-expanded", "false"); }

    const momento = new Date(r.ocurrido_en);
    const tiempo = crear("time", "hora", horaLocal(momento));
    tiempo.dateTime = r.ocurrido_en;
    tiempo.title = momento.toLocaleString("es-ES");

    // La frase: "Editor de prueba modificó ACT-004"
    const texto = crear("span", "evento-texto");
    texto.append(crear("strong", "", r.nombre), " ", crear("span", "verbo", VERBOS[r.accion] || r.accion));
    if (r.accion === "BUSQUEDA" && tieneDetalle && r.detalle.texto !== undefined) {
        const n = r.detalle.resultados;
        texto.append(" ", crear("span", "objeto", "«" + r.detalle.texto + "»"));
        if (n !== undefined) texto.append(" ", crear("span", "extra", "· " + n + (n === 1 ? " resultado" : " resultados")));
    } else if (r.seccion === "ACTIVIDAD") {
        const vista = tieneDetalle && r.detalle.vista === "usuarios" ? "la lista de usuarios" : "la línea de tiempo";
        texto.append(" ", crear("span", "objeto de-actividad", vista));
        if (propia) texto.append(" ", crear("span", "extra", "· tu consulta del registro"));
    } else if (r.registro_etiqueta || r.registro_id) {
        // Sin etiqueta, el registro ya no existe: queda su número
        texto.append(" ", crear("span", "objeto", r.registro_etiqueta || "n.º " + r.registro_id));
    } else if (r.accion === "ACCESO_DENEGADO" && r.seccion) {
        texto.append(" ", crear("span", "objeto", NOMBRES_SECCION[r.seccion] || r.seccion));
    }

    const etiquetas = crear("span", "evento-etiquetas");
    etiquetas.appendChild(pildora(ACCIONES[r.accion] || r.accion, "accion"));
    if (r.seccion) etiquetas.appendChild(pildora(NOMBRES_SECCION[r.seccion] || r.seccion, "pildora-seccion neutra seccion-" + r.seccion.toLowerCase()));

    const cola = desplegable ? document.getElementById("plantilla-chevron").content.firstElementChild.cloneNode(true) : crear("span");
    fila.append(tiempo, crear("span", "nodo"), texto, etiquetas, cola);
    evento.appendChild(fila);

    if (desplegable) {
        fila.addEventListener("click", function () {
            const abierto = fila.getAttribute("aria-expanded") === "true";
            fila.setAttribute("aria-expanded", String(!abierto));
            const anterior = evento.querySelector(".evento-detalle");
            if (anterior) anterior.remove();
            if (!abierto) evento.appendChild(crearDetalle(r));
        });
    }
    return evento;
}

function valor(v) {
    if (v === null || v === undefined) return crear("span", "sin-dato", "Sin dato");
    return document.createTextNode(typeof v === "object" ? JSON.stringify(v) : String(v));
}

// Lo que se ve al desplegar un evento: la tabla campo · antes → después de una modificación,
// los filtros de una consulta del registro o, para cualquier otro detalle, sus claves y valores
function crearDetalle(r) {
    const caja = crear("div", "evento-detalle");

    if (r.accion === "MODIFICACION" && esDetalleDeCambios(r.detalle)) {
        const tabla = crear("table", "cambios");
        const cabeza = crear("tr");
        for (const t of ["Campo", "Antes", "", "Después"]) cabeza.appendChild(crear("th", "", t));
        const thead = crear("thead");
        thead.appendChild(cabeza);
        const cuerpo = crear("tbody");
        for (const [columna, cambio] of Object.entries(r.detalle)) {
            const antes = crear("td", "antes");
            antes.appendChild(valor(cambio.antes));
            const despues = crear("td", "despues");
            despues.appendChild(valor(cambio.despues));
            const fila = crear("tr");
            fila.append(crear("td", "", COLUMNAS[columna] || columna), antes, crear("td", "flecha-cambio", "→"), despues);
            cuerpo.appendChild(fila);
        }
        tabla.append(thead, cuerpo);
        caja.appendChild(tabla);
        return caja;
    }

    const lista = crear("dl", "filtros-usados");
    const deActividad = r.seccion === "ACTIVIDAD";
    for (const [clave, v] of Object.entries(r.detalle)) {
        let texto = valor(v);
        if (deActividad) {
            if (clave === "vista") texto = document.createTextNode(v === "usuarios" ? "Lista de usuarios" : "Línea de tiempo");
            if (clave === "usuario") texto = document.createTextNode(nombreUsuario(v));
            if (clave === "accion") texto = document.createTextNode(ACCIONES[v] || v);
            if (clave === "desde" || clave === "hasta") texto = document.createTextNode(new Date(v).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }));
            if (clave === "ocultar_mis_consultas") texto = document.createTextNode(v ? "Sí" : "No");
        }
        const dd = crear("dd");
        dd.appendChild(texto);
        lista.append(crear("dt", "", (deActividad && FILTROS[clave]) || clave), dd);
    }
    caja.appendChild(lista);
    return caja;
}

// 7. Cambio de vista.
const opciones = { usuarios: document.getElementById("opcion-usuarios"), actividad: document.getElementById("opcion-actividad") };

function elegirVista(vista) {
    for (const [nombre, boton] of Object.entries(opciones)) boton.setAttribute("aria-pressed", String(nombre === vista));
    document.getElementById("vista-usuarios").hidden = vista !== "usuarios";
    document.getElementById("vista-actividad").hidden = vista !== "actividad";
    if (vista === "usuarios") mostrarUsuarios();
    else cargarActividad(true);
}

opciones.usuarios.addEventListener("click", function () { elegirVista("usuarios"); });
opciones.actividad.addEventListener("click", function () { elegirVista("actividad"); });

// Desde la lista de usuarios: la actividad de esa persona, con el filtro ya aplicado
function irAActividadDe(id) {
    campos.usuario.value = id;
    document.getElementById("error-filtros").hidden = true;
    aplicados = leerFiltros();
    document.getElementById("sin-aplicar").hidden = true;
    elegirVista("actividad");
}

// 8. Ir a Activos y cerrar sesión.
document.getElementById("boton-activos").addEventListener("click", function () { window.location.href = "activos.html"; });

document.getElementById("boton-salir").addEventListener("click", async function () {
    await clienteSupabase.auth.signOut();
    window.location.replace("login.html");
});

iniciar();
