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

// Si el usuario puede crear y modificar activos (lo dice mi_perfil). Solo decide qué botones se enseñan:
// aunque alguien los forzara, crear_activo y modificar_activo comprueban el permiso en la base de datos.
let puedeEscribirActivos = false;

// 2. Rellena la cabecera y la barra con lo que ha devuelto mi_perfil().
//    Quien no tiene la sección Activos ve la tarjeta "Sin acceso" en lugar del buscador.
function mostrarPerfil(perfil) {
    puedeEscribirActivos = perfil.secciones_escritura.includes("ACTIVOS");
    document.getElementById("zona-crear").hidden = !puedeEscribirActivos;

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
        document.getElementById("columnas").hidden = true;   // la lista y la ficha, juntas
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
        fila.className = "elegible";
        fila.tabIndex = 0;                          // se llega con Tab y se abre con Intro
        fila.dataset.id = activo.id;
        fila.setAttribute("aria-selected", activo.id === seleccionado);
        fila.style.setProperty("--i", posicion);   // su turno en la entrada una a una
        fila.append(celda(activo.codigo, "codigo"), celda(activo.direccion), celda(activo.municipio, "texto-suave"), celda("›", "flecha"));
        fila.addEventListener("click", function () { abrirFicha(activo.id); });
        fila.addEventListener("keydown", function (evento) {
            if (evento.key === "Enter" || evento.key === " ") { evento.preventDefault(); abrirFicha(activo.id); }
        });
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
    td.colSpan = 4;
    fila.appendChild(td);
    document.getElementById("filas").replaceChildren(fila);
}

// 5. La ficha (paso 3).
let seleccionado = null;   // id del activo de la ficha (null: ficha cerrada)
let abierta = false;       // si la ficha está desplegada
let numeroConsulta = 0;    // para pintar solo la respuesta de la última consulta lanzada

async function abrirFicha(id) {
    seleccionado = id;
    marcarSeleccionada();
    const esta = ++numeroConsulta;

    // Cada vez que se abre una ficha, consultar_activo apunta una CONSULTA en el registro
    const { data, error } = await clienteSupabase.rpc("consultar_activo", { activo_id: id });
    if (esta !== numeroConsulta) return;   // ya se eligió otro activo: esta respuesta llega tarde

    if (error) {
        console.log("Error al consultar el activo:", error);
        mostrarEnFicha([crear("p", "eyebrow", "Ficha del activo"), crear("h2", "", "No se pudo abrir"), crear("p", "mensaje-error", error.message)]);
        return;
    }
    if (data.length === 0) {
        mostrarEnFicha([crear("p", "eyebrow", "Ficha del activo"), crear("h2", "", "No encontrado"), crear("p", "texto-suave", "Este activo ya no existe.")]);
        return;
    }

    pintarFicha(data[0]);
}

// Pinta la ficha de un activo que ya tenemos (recién consultado, guardado o creado), sin volver a pedirlo:
// así, guardar no deja además una CONSULTA en el registro. "aviso" es el mensaje verde tras guardar.
let activoEnFicha = null;

function pintarFicha(activo, aviso) {
    activoEnFicha = activo;
    const titulo = crear("div", "ficha-titulo");
    titulo.append(crear("h2", "", activo.codigo), etiquetaEstado(activo.estado));

    const datos = crear("dl", "datos");
    ponerDato(datos, "Dirección", activo.direccion, true);
    ponerDato(datos, "Municipio", activo.municipio);
    ponerDato(datos, "Referencia catastral", activo.referencia_catastral);
    ponerDato(datos, "Fondo propietario", activo.fondo_nombre, true);
    ponerDato(datos, "Fecha de compra", formatoFecha(activo.fecha_compra));
    ponerDato(datos, "Fecha de venta", formatoFecha(activo.fecha_venta));

    const pie = crear("div", "ficha-pie");
    // "Consulta registrada" solo si la ficha viene de una consulta: tras guardar no se consulta nada
    // (lo registrado es el cambio, y eso ya lo dice el aviso). Un hueco vacío mantiene "Editar" a la derecha.
    pie.appendChild(aviso ? crear("span") : document.getElementById("plantilla-registrada").content.cloneNode(true));
    if (puedeEscribirActivos) {
        const editar = botonLinea("Editar");
        editar.addEventListener("click", function () { abrirFormulario(activo); });
        pie.appendChild(editar);
    }

    const nodos = [crear("p", "eyebrow", "Ficha del activo"), titulo];
    if (aviso) nodos.push(crear("p", "mensaje-exito", aviso));
    nodos.push(datos, pie);
    mostrarEnFicha(nodos);
}

// Pone contenido en la ficha y la despliega con la animación completa (en cada selección).
// El primer nodo es la etiqueta (entra con el panel), el segundo el título (paso 1) y el resto, los datos (paso 2).
function mostrarEnFicha(nodos) {
    nodos.forEach(function (nodo, i) {
        if (i === 1) nodo.classList.add("paso-1");
        if (i > 1) nodo.classList.add("paso-2");
    });

    const cerrar = crear("button", "cerrar-ficha", "×");
    cerrar.type = "button";
    cerrar.setAttribute("aria-label", "Cerrar la ficha");
    cerrar.addEventListener("click", cerrarFicha);

    const ficha = document.getElementById("ficha");
    ficha.replaceChildren(cerrar, ...nodos);
    ficha.classList.remove("recoge");
    abierta = true;
    document.getElementById("hueco-ficha").hidden = true;
    ficha.hidden = false;
    ficha.classList.remove("despliega");
    void ficha.offsetWidth;   // obliga al navegador a "olvidar" la animación anterior antes de repetirla
    ficha.classList.add("despliega");
}

// Repliega la ficha hacia la izquierda (hacia la lista) y deja el hueco en su sitio
function cerrarFicha() {
    const ficha = document.getElementById("ficha");
    abierta = false;
    seleccionado = null;
    activoEnFicha = null;
    numeroConsulta++;   // si había una consulta en camino, su respuesta ya no abrirá la ficha
    marcarSeleccionada();

    const terminar = function () {
        ficha.hidden = true;
        ficha.classList.remove("recoge");
        document.getElementById("hueco-ficha").hidden = false;
    };
    if (ficha.hidden) { terminar(); return; }

    // Se termina al acabar el repliegue (0,3 s). El aviso de fin también sube desde dentro de la ficha,
    // así que solo vale el de la propia ficha. Si el aviso no llegara, un temporizador de respaldo
    // termina igualmente: la columna nunca se queda vacía.
    let hecho = false;
    const terminarUnaVez = function () {
        if (hecho) return;
        hecho = true;
        ficha.removeEventListener("animationend", alTerminar);
        if (!abierta) terminar();
    };
    const alTerminar = function (evento) { if (evento.target === ficha) terminarUnaVez(); };
    ficha.classList.remove("despliega");
    ficha.addEventListener("animationend", alTerminar);
    ficha.classList.add("recoge");
    setTimeout(terminarUnaVez, 350);
}

// Marca en la lista la fila del activo elegido, sin volver a pintar la lista
function marcarSeleccionada() {
    for (const fila of document.querySelectorAll("#filas tr.elegible")) {
        fila.setAttribute("aria-selected", Number(fila.dataset.id) === seleccionado);
    }
}

function ponerDato(lista, nombre, valor, ancho) {
    const grupo = crear("div", ancho ? "ancho" : "");
    grupo.append(crear("dt", "", nombre), crear("dd", valor ? "" : "sin-dato", valor || "Sin dato"));
    lista.appendChild(grupo);
}

function etiquetaEstado(estado) {
    const envoltorio = crear("span", "sombra-pildora");
    envoltorio.appendChild(crear("span", "pildora estado-" + estado.toLowerCase().replace(" ", "-"), estado));
    return envoltorio;
}

// "2021-03-15" → "15/03/2021"
function formatoFecha(fecha) {
    return fecha ? fecha.split("-").reverse().join("/") : null;
}

function crear(etiqueta, clase, texto) {
    const elemento = document.createElement(etiqueta);
    if (clase) elemento.className = clase;
    if (texto !== undefined) elemento.textContent = texto;
    return elemento;
}

// 6. Editar y crear (paso 4). El formulario aparece en el sitio de la ficha, con la misma animación.
const ESTADOS = ["COMPRA", "EN OBRA", "EN VENTA", "VENDIDO"];
let fondos = null;   // [{ id, nombre }] de fondos_para_elegir(), pedida una sola vez (no se apunta en el registro)

document.getElementById("boton-crear").addEventListener("click", function () { abrirFormulario(null); });

// activo: el de la ficha, para editarlo; null, para crear uno nuevo
async function abrirFormulario(activo) {
    numeroConsulta++;   // si había una ficha en camino, su respuesta ya no sustituirá al formulario

    if (fondos === null) {
        const { data, error } = await clienteSupabase.rpc("fondos_para_elegir");
        if (error) {
            console.log("Error al pedir la lista de fondos:", error);
            mostrarEnFicha([crear("p", "eyebrow", activo ? "Editar activo" : "Nuevo activo"), crear("h2", "", "No se pudo abrir"), crear("p", "mensaje-error", error.message)]);
            return;
        }
        fondos = data;
    }

    const form = crear("form", "form-activo");
    form.noValidate = true;   // las comprobaciones las hace la página (con mensajes en castellano) y, al final, la base de datos

    // Orden: (Código, solo al crear) · Dirección · Municipio | Estado · Referencia catastral · Fondo · Fechas
    const codigo = activo ? null : campo(form, "f-codigo", "Código *", "text", "", false);
    if (!activo) form.appendChild(crear("div"));
    const direccion = campo(form, "f-direccion", "Dirección *", "text", activo && activo.direccion, true);
    const municipio = campo(form, "f-municipio", "Municipio", "text", activo && activo.municipio, false);
    const estado = desplegable(form, "f-estado", "Estado *", ESTADOS.map(function (e) { return [e, e]; }), activo ? activo.estado : "COMPRA", null, false);
    const referencia = campo(form, "f-referencia", "Referencia catastral", "text", activo && activo.referencia_catastral, true);
    const fondo = desplegable(form, "f-fondo", "Fondo propietario *", fondos.map(function (f) { return [String(f.id), f.nombre]; }),
        activo ? String(activo.fondo_id) : "", activo ? null : "Elige un fondo", true);
    const compra = campo(form, "f-compra", "Fecha de compra", "date", activo && activo.fecha_compra, false);
    const venta = campo(form, "f-venta", "Fecha de venta", "date", activo && activo.fecha_venta, false);

    const mensaje = crear("p", "mensaje-formulario");
    form.appendChild(mensaje);

    const acciones = crear("div", "acciones");
    const guardar = crear("button", "boton-relieve", "Guardar");
    guardar.type = "submit";
    const cancelar = botonLinea("Cancelar");
    // Cancelar vuelve a la ficha del activo, sin pedirla otra vez; si se estaba creando, a la ficha que hubiera, o la cierra
    cancelar.addEventListener("click", function () {
        if (activo) pintarFicha(activo);
        else if (activoEnFicha && seleccionado) pintarFicha(activoEnFicha);
        else cerrarFicha();
    });
    acciones.append(envolverRelieve(guardar), cancelar);
    form.appendChild(acciones);

    form.addEventListener("submit", async function (evento) {
        evento.preventDefault();
        const avisar = function (texto) { mensaje.className = "mensaje-formulario mensaje-error"; mensaje.textContent = texto; };
        const valor = function (entrada) { return entrada.value.trim(); };

        // Las mismas comprobaciones que hacen las ventanillas, para avisar antes de enviar
        if ((codigo && !valor(codigo)) || !valor(direccion)) { avisar("El código y la dirección son obligatorios."); return; }
        if (!fondo.value) { avisar("Elige el fondo propietario."); return; }

        let llamada, parametros;
        if (activo) {
            // Solo se envían los campos cambiados: en modificar_activo, un parámetro que no llega significa "no cambiar",
            // y así el registro apunta solo lo que se tocó. Un campo opcional que tenía dato y se ha borrado
            // va en la lista campos_a_vaciar (034). Los obligatorios no pueden quedar vacíos (lo comprueba arriba).
            const cambios = [
                // [parámetro, valor nuevo, valor original, columna]
                ["nueva_direccion", valor(direccion), activo.direccion, "direccion"],
                ["nuevo_municipio", valor(municipio), activo.municipio, "municipio"],
                ["nuevo_estado", estado.value, activo.estado, "estado"],
                ["nueva_referencia_catastral", valor(referencia), activo.referencia_catastral, "referencia_catastral"],
                ["nuevo_fondo_id", Number(fondo.value), activo.fondo_id, "fondo_id"],
                ["nueva_fecha_compra", compra.value, activo.fecha_compra, "fecha_compra"],
                ["nueva_fecha_venta", venta.value, activo.fecha_venta, "fecha_venta"],
            ];
            parametros = { activo_id: activo.id };
            const vaciar = [];
            for (const c of cambios) {
                if (c[1] === "" && c[2]) vaciar.push(c[3]);
                else if (c[1] !== "" && c[1] !== (c[2] === null ? "" : c[2])) parametros[c[0]] = c[1];
            }
            if (vaciar.length > 0) parametros.campos_a_vaciar = vaciar;
            if (Object.keys(parametros).length === 1) { avisar("No has cambiado nada."); return; }
            llamada = "modificar_activo";
        } else {
            parametros = {
                nuevo_codigo: valor(codigo).toUpperCase(),
                nueva_direccion: valor(direccion),
                nuevo_fondo_id: Number(fondo.value),
                nuevo_estado: estado.value,
                nuevo_municipio: valor(municipio) || null,
                nueva_referencia_catastral: valor(referencia) || null,
                nueva_fecha_compra: compra.value || null,
                nueva_fecha_venta: venta.value || null,
            };
            llamada = "crear_activo";
        }

        // Mientras se guarda, el botón se desactiva: un doble clic no crea el activo dos veces
        guardar.disabled = true;
        const { data, error } = await clienteSupabase.rpc(llamada, parametros);
        guardar.disabled = false;

        if (error) {
            console.log("Error al guardar:", error);
            avisar(traducirError(error));   // lo escrito se conserva para corregirlo
            return;
        }

        // La función devuelve la fila guardada; el nombre del fondo se toma de la lista que ya tenemos
        const guardado = Object.assign({}, data[0], { fondo_nombre: nombreFondo(data[0].fondo_id) });
        seleccionado = guardado.id;
        if (activo) actualizarFila(guardado);
        marcarSeleccionada();
        pintarFicha(guardado, activo ? "Cambios guardados. La modificación queda registrada." : "Activo creado. La creación queda registrada.");
    });

    mostrarEnFicha([crear("p", "eyebrow", activo ? "Editar activo" : "Nuevo activo"), crear("h2", "", activo ? activo.codigo : "Nuevo activo"), form]);
    (codigo || direccion).focus({ preventScroll: true });
}

// Errores de la base de datos que no traen un mensaje en castellano
function traducirError(error) {
    if (error.code === "23505") {
        if ((error.details || "").includes("(codigo)")) return "Ya existe un activo con ese código.";
        if ((error.details || "").includes("(referencia_catastral)")) return "Ya existe un activo con esa referencia catastral.";
        return "Ya existe un activo con alguno de esos datos.";
    }
    return error.message;
}

function nombreFondo(id) {
    const encontrado = (fondos || []).find(function (f) { return f.id === id; });
    return encontrado ? encontrado.nombre : null;
}

// Tras modificar un activo, su fila de la lista se pone al día sin volver a buscar (y sin otra BUSQUEDA en el registro)
function actualizarFila(activo) {
    const fila = document.querySelector('#filas tr.elegible[data-id="' + activo.id + '"]');
    if (!fila) return;
    fila.children[1].textContent = activo.direccion || "";
    fila.children[2].textContent = activo.municipio || "";
}

function campo(form, id, texto, tipo, valorInicial, ancho) {
    const grupo = crear("div", ancho ? "ancho" : "");
    const etiqueta = crear("label", "", texto);
    etiqueta.htmlFor = id;
    const entrada = crear("input");
    entrada.id = id;
    entrada.type = tipo;
    entrada.value = valorInicial || "";
    grupo.append(etiqueta, entrada);
    form.appendChild(grupo);
    return entrada;
}

// opciones: [[valor, texto], ...]; textoVacio: primera opción "Elige…" (al crear)
function desplegable(form, id, texto, opciones, valorInicial, textoVacio, ancho) {
    const grupo = crear("div", ancho ? "ancho" : "");
    const etiqueta = crear("label", "", texto);
    etiqueta.htmlFor = id;
    const lista = crear("select");
    lista.id = id;
    if (textoVacio) {
        const vacia = crear("option", "", textoVacio);
        vacia.value = "";
        lista.appendChild(vacia);
    }
    for (const opcion of opciones) {
        const elemento = crear("option", "", opcion[1]);
        elemento.value = opcion[0];
        lista.appendChild(elemento);
    }
    lista.value = valorInicial;
    grupo.append(etiqueta, lista);
    form.appendChild(grupo);
    return lista;
}

function botonLinea(texto) {
    const boton = crear("button", "boton-linea");
    boton.type = "button";
    boton.append(crear("span", "borde-acento"), texto);
    return boton;
}

// El botón principal va dentro de su zona (con el halo) y su sombra (el relieve)
function envolverRelieve(boton) {
    const zona = crear("div", "zona-boton");
    const halo = crear("span", "halo");
    halo.setAttribute("aria-hidden", "true");
    const sombra = crear("div", "sombra");
    sombra.appendChild(boton);
    zona.append(halo, sombra);
    return zona;
}

// 7. Cerrar sesión.
document.getElementById("boton-salir").addEventListener("click", async function () {
    await clienteSupabase.auth.signOut();
    window.location.replace("login.html");
});

iniciar();
