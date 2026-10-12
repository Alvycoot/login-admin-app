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
});