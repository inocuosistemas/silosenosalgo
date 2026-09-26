import SwiftUI

/**
 El botón de la cuenta, arriba a la derecha: la marca de quien usa la app (su
 emoji en el aro de su color). Sin marca elegida, la inicial del usuario en un
 aro gris: sigue siendo un sitio al que tocar, y dice que ahí se elige.
 */
struct BotonDeCuenta: View {
    @EnvironmentObject var auth: AuthStore
    let accion: () -> Void

    var body: some View {
        Button(action: accion) {
            MarcaEvento(emoji: auth.perfil.favEmoji ?? inicial, colorSlug: auth.perfil.favColor, size: 40)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Mi cuenta")
        .accessibilityIdentifier("botonMiCuenta")
    }

    private var inicial: String {
        auth.user?.username.first.map { String($0).uppercased() } ?? "·"
    }
}

/**
 «Mi cuenta»: lo que es de la persona y no de una salida ni de una carrera.

 - La MARCA con la que se entra a cualquier evento: el emoji y el color. La
   misma que se elige en la web (ver `MyMark.tsx`); se guarda al tocar.
 - La CONTRASEÑA, con la actual delante: con la sesión abierta en un móvil
   olvidado encima de la mesa no se debe poder cambiar.
 - Salir de la cuenta y la versión, que antes estaban al final de «Archivo».
 */
struct PantallaMiCuenta: View {
    @EnvironmentObject var auth: AuthStore
    @ObservedObject private var store = TrackingStore.shared
    @Environment(\.dismiss) private var dismiss

    @State private var emojiAbierto = false
    @State private var colorAbierto = false
    @State private var otroEmoji = ""
    @State private var guardando = false
    @State private var errorMarca: String?
    @State private var guardado = false

    @State private var actual = ""
    @State private var nueva = ""
    @State private var repetida = ""
    @State private var cambiando = false
    @State private var errorClave: String?
    @State private var claveCambiada = false

    @State private var confirmandoSalida = false

    @State private var claveBorrar = ""
    @State private var confirmandoBorrar = false
    @State private var borrando = false
    @State private var errorBorrar: String?

    /// Los mismos sesenta de la web (`EMOJI_POOL` en shared/emoji.ts).
    static let emojis = [
        "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵",
        "🦉", "🦅", "🦆", "🐢", "🐬", "🐙", "🦖", "🦄", "🐝", "🦋",
        "🍎", "🍌", "🍉", "🍇", "🍒", "🥑", "🌽", "🍄", "🌵", "🌻",
        "⚽", "🏀", "🎾", "🏈", "🥏", "🎿", "🛹", "🚀", "⛵", "🚂",
        "🎸", "🥁", "🎺", "🎨", "📷", "🔦", "🧭", "⏰", "💡", "🔑",
        "⭐", "🌈", "🔥", "❄️", "🌙", "☂️", "🍀", "🎩", "👑", "🧊",
    ]
    /// Los doce de la paleta de los eventos (shared/eventColors.ts), en su orden.
    static let colores: [(slug: String, nombre: String)] = [
        ("sky", "Azul"), ("emerald", "Verde"), ("amber", "Ámbar"), ("rose", "Rojo"),
        ("violet", "Violeta"), ("lime", "Lima"), ("orange", "Naranja"), ("cyan", "Cian"),
        ("fuchsia", "Fucsia"), ("teal", "Turquesa"), ("indigo", "Índigo"), ("pink", "Rosa"),
    ]

    private static let minimo = 8

    var body: some View {
        NavigationStack {
            Form {
                seccionMarca
                seccionContrasena
                Section {
                    // En rojo apagado, como estaba en «Archivo»: es una salida,
                    // no una alarma.
                    Button("Salir de la cuenta") { confirmandoSalida = true }
                        .frame(maxWidth: .infinity, alignment: .center)
                        .foregroundStyle(Theme.rose300.opacity(0.85))
                        .accessibilityIdentifier("salirDeLaCuenta")
                }
                .listRowBackground(Theme.slate900)
                seccionBorrar
                // La versión, al pie: lo primero que hay que preguntar cuando
                // alguien dice que algo no le funciona.
                Section {
                    Text(Self.version)
                        .font(.caption2)
                        .foregroundStyle(Theme.slate400)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .textSelection(.enabled)
                }
                .listRowBackground(Color.clear)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.slate950)
            .tint(Theme.sky500)
            .navigationTitle("Mi cuenta")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Hecho") { dismiss() }
                }
            }
            .task {
                emojiAbierto = auth.perfil.favEmoji == nil
                colorAbierto = auth.perfil.favColor == nil
                await auth.cargaPerfil()
            }
            .alert("Salir de la cuenta", isPresented: $confirmandoSalida) {
                Button(store.isSharing ? "Detener y salir" : "Salir", role: .destructive) {
                    Task {
                        await store.stopSharing()
                        // Antes de cerrar la sesión, que es cuando todavía hay
                        // con qué autenticar la baja: si no, este móvil seguiría
                        // recibiendo los ánimos de quien ya no lo usa.
                        await PushRegistrar.shared.daDeBaja()
                        await auth.logout()
                    }
                }
                Button("Cancelar", role: .cancel) { }
            } message: {
                Text(store.isSharing
                     ? "Estás compartiendo tu ubicación. Al salir se detiene el seguimiento y se cierra la sesión."
                     : "Se cerrará tu sesión en este dispositivo.")
            }
            .alert("¿Borrar tu cuenta para siempre?", isPresented: $confirmandoBorrar) {
                Button("Borrar", role: .destructive) { borraCuenta() }
                Button("Cancelar", role: .cancel) { }
            } message: {
                Text("Se borra todo lo tuyo y no se puede recuperar.")
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: Borrar la cuenta

    /// Lo último, con la contraseña y una pregunta más: lo único de aquí que no
    /// tiene vuelta atrás (y lo que la App Store y Google Play piden que exista).
    private var seccionBorrar: some View {
        Section {
            SecureField("Tu contraseña", text: $claveBorrar)
                .textContentType(.password)
            if let errorBorrar {
                Text(errorBorrar).font(.caption).foregroundStyle(Theme.rose300)
            }
            Button(borrando ? "Borrando…" : "Borrar mi cuenta") { confirmandoBorrar = true }
                .disabled(claveBorrar.isEmpty || borrando)
                .foregroundStyle(Theme.rose300)
                .accessibilityIdentifier("borrarLaCuenta")
        } header: {
            Text("Borrar la cuenta")
        } footer: {
            Text("Se borran tu cuenta, tus salidas con sus notas, fotos y audios, tus rutas y tus pronósticos. Los eventos que creaste con más gente pasan a otro participante. No se puede deshacer.")
        }
        .listRowBackground(Theme.slate900)
    }

    private func borraCuenta() {
        borrando = true
        errorBorrar = nil
        Task {
            do {
                await store.stopSharing()
                await PushRegistrar.shared.daDeBaja()
                try await auth.borraCuenta(contrasena: claveBorrar)
            } catch let e as APIError where e.code == "invalid_credentials" {
                errorBorrar = "La contraseña no es esa."
            } catch {
                errorBorrar = "No se ha podido borrar. Prueba de nuevo."
            }
            borrando = false
        }
    }

    // MARK: Marca

    private var seccionMarca: some View {
        Section {
            HStack(spacing: 14) {
                MarcaEvento(emoji: auth.perfil.favEmoji ?? "?", colorSlug: auth.perfil.favColor, size: 56)
                VStack(alignment: .leading, spacing: 3) {
                    Text(auth.user?.username ?? "")
                        .font(.headline)
                        .foregroundStyle(Theme.slate100)
                    Text("Así te verán en el mapa de los eventos. Si al entrar en uno tu emoji ya lo lleva otro, entrarás con otro.")
                        .font(.caption)
                        .foregroundStyle(Theme.slate400)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.vertical, 4)

            DisclosureGroup(isExpanded: $emojiAbierto) {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 6), spacing: 6) {
                    ForEach(Self.emojis, id: \.self) { e in
                        let elegido = e == auth.perfil.favEmoji
                        Button { guarda(emoji: .some(e)) } label: {
                            Text(e)
                                .font(.system(size: 26))
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(elegido ? Theme.sky500.opacity(0.25) : Color.clear)
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(elegido ? Theme.sky500 : .clear, lineWidth: 2))
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(e)
                        .accessibilityAddTraits(elegido ? .isSelected : [])
                    }
                }
                .padding(.vertical, 4)
                .disabled(guardando)
                // Cualquier emoji vale, no solo los sesenta: el teclado de emojis
                // del sistema tiene los demás.
                HStack {
                    TextField("", text: $otroEmoji, prompt: Text("Otro: escríbelo aquí").foregroundColor(Theme.slate400))
                        .submitLabel(.done)
                        .onSubmit(guardaOtro)
                    if !otroEmoji.trimmingCharacters(in: .whitespaces).isEmpty {
                        Button("Usar", action: guardaOtro).disabled(guardando)
                    }
                }
                if auth.perfil.favEmoji != nil {
                    Button("Quitar mi emoji", role: .destructive) { guarda(emoji: .some(nil)) }
                        .font(.footnote)
                        .disabled(guardando)
                }
            } label: {
                fila("Mi emoji", auth.perfil.favEmoji ?? "sin elegir")
            }

            DisclosureGroup(isExpanded: $colorAbierto) {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 10) {
                    ForEach(Self.colores, id: \.slug) { c in
                        let elegido = c.slug == auth.perfil.favColor
                        Button { guarda(color: .some(c.slug)) } label: {
                            VStack(spacing: 4) {
                                Circle()
                                    .fill(Theme.eventColor(c.slug))
                                    .frame(width: 32, height: 32)
                                    .overlay(Circle().stroke(Theme.slate100, lineWidth: elegido ? 3 : 0).padding(-4))
                                    .overlay(elegido ? Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(Theme.slate950) : nil)
                                Text(c.nombre)
                                    .font(.caption2)
                                    .foregroundStyle(elegido ? Theme.slate100 : Theme.slate400)
                            }
                            .frame(maxWidth: .infinity, minHeight: 56)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(c.nombre)
                        .accessibilityAddTraits(elegido ? .isSelected : [])
                    }
                }
                .padding(.vertical, 6)
                .disabled(guardando)
                if auth.perfil.favColor != nil {
                    Button("Quitar mi color", role: .destructive) { guarda(color: .some(nil)) }
                        .font(.footnote)
                        .disabled(guardando)
                }
            } label: {
                HStack {
                    Text("Mi color").foregroundStyle(Theme.slate100)
                    Spacer()
                    if let slug = auth.perfil.favColor {
                        Circle().fill(Theme.eventColor(slug)).frame(width: 12, height: 12)
                    }
                    Text(Self.colores.first { $0.slug == auth.perfil.favColor }?.nombre ?? "sin elegir")
                        .foregroundStyle(Theme.slate400)
                }
            }

            if let errorMarca {
                Text(errorMarca).font(.footnote).foregroundStyle(Theme.rose300)
            } else if guardado {
                Text("Guardado ✓").font(.footnote).foregroundStyle(Theme.emerald300)
            }
        } header: {
            cabecera("Tu marca", "face.smiling")
        }
        .listRowBackground(Theme.slate900)
    }

    /// Como las de la pantalla principal (`TrackingView.cabecera`).
    private func cabecera(_ texto: String, _ icono: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icono).font(.caption2)
            Text(texto.uppercased())
                .font(.caption.weight(.bold))
                .kerning(0.8)
        }
        .foregroundStyle(Theme.sky500)
        .padding(.top, 2)
    }

    private func fila(_ titulo: String, _ valor: String) -> some View {
        HStack {
            Text(titulo).foregroundStyle(Theme.slate100)
            Spacer()
            Text(valor).foregroundStyle(Theme.slate400)
        }
    }

    private func guardaOtro() {
        let e = otroEmoji.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !e.isEmpty else { return }
        guarda(emoji: .some(e)) { otroEmoji = "" }
    }

    private func guarda(emoji: String?? = nil, color: String?? = nil, alAcabar: @escaping () -> Void = {}) {
        guardando = true
        errorMarca = nil
        Task {
            do {
                try await auth.guardaPerfil(emoji: emoji, color: color)
                alAcabar()
                guardado = true
                try? await Task.sleep(for: .seconds(1.5))
                guardado = false
            } catch {
                errorMarca = error.localizedDescription
            }
            guardando = false
        }
    }

    // MARK: Contraseña

    private var noCoinciden: Bool { !repetida.isEmpty && nueva != repetida }
    private var puedeCambiar: Bool {
        !actual.isEmpty && nueva.count >= Self.minimo && nueva == repetida && !cambiando
    }

    private var seccionContrasena: some View {
        Section {
            SecureField("", text: $actual, prompt: Text("Contraseña actual").foregroundColor(Theme.slate400))
                .textContentType(.password)
                .accessibilityIdentifier("claveActual")
            SecureField("", text: $nueva, prompt: Text("Nueva (mínimo \(Self.minimo) caracteres)").foregroundColor(Theme.slate400))
                .textContentType(.newPassword)
                .accessibilityIdentifier("claveNueva")
            SecureField("", text: $repetida, prompt: Text("Repite la nueva").foregroundColor(Theme.slate400))
                .textContentType(.newPassword)
                .accessibilityIdentifier("claveRepetida")
            if noCoinciden {
                Text("No coinciden.").font(.footnote).foregroundStyle(Theme.rose300)
            }
            if let errorClave {
                Text(errorClave).font(.footnote).foregroundStyle(Theme.rose300)
            } else if claveCambiada {
                Text("Contraseña cambiada ✓").font(.footnote).foregroundStyle(Theme.emerald300)
            }
            Button {
                cambiaContrasena()
            } label: {
                HStack {
                    Spacer()
                    if cambiando { ProgressView().padding(.trailing, 6) }
                    Text(cambiando ? "Cambiando…" : "Cambiar la contraseña").fontWeight(.semibold)
                    Spacer()
                }
            }
            .disabled(!puedeCambiar)
            .accessibilityIdentifier("cambiarContrasena")
        } header: {
            cabecera("Contraseña", "key.fill")
        } footer: {
            Text("Al cambiarla se cierra la sesión en la web y en los demás móviles; en este sigues dentro.")
                .foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)
    }

    private func cambiaContrasena() {
        cambiando = true
        errorClave = nil
        claveCambiada = false
        Task {
            do {
                try await auth.cambiaContrasena(actual: actual, nueva: nueva)
                actual = ""; nueva = ""; repetida = ""
                claveCambiada = true
            } catch let e as APIError where e.code == "invalid_credentials" {
                errorClave = "La contraseña actual no es esa."
            } catch {
                errorClave = error.localizedDescription
            }
            cambiando = false
        }
    }

    /// "SiLoSeNoSalgo 1.0 (447)": el número de compilación es el que distingue
    /// una versión de otra.
    static var version: String {
        let info = Bundle.main.infoDictionary
        let corta = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "SiLoSeNoSalgo \(corta) (\(build))"
    }
}
