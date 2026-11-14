const clienteSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
console.log("Cliente de Supabase creado");

const formulario = document.getElementById("form-login");
const campoEmail = document.getElementById("email");
const campoPassword = document.getElementById("password");
const mensaje = document.getElementById("mensaje");

// Si ya hay una sesión abierta, no tiene sentido volver a pedir la contraseña.
async function comprobarSesion() {
    const { data } = await clienteSupabase.auth.getSession();
    if (data.session) {
        window.location.replace("activos.html");
    }
}

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
        window.location.replace("activos.html");
    }
});

comprobarSesion();