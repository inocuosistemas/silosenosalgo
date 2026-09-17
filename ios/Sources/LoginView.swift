import SwiftUI

struct LoginView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    private var canSubmit: Bool { !busy && !username.isEmpty && !password.isEmpty }

    var body: some View {
        VStack(spacing: 18) {
            Spacer()

            // La marca de la app, la misma que la cabecera de dentro y la que
            // se ve en el icono: quien abre esto ha pulsado un icono hace medio
            // segundo y tiene que reconocer que está donde quería. El emoji que
            // había no es de nadie.
            Image("MarcaApp")
                .resizable()
                .scaledToFit()
                .frame(width: 76, height: 76)
                .accessibilityHidden(true)
            Text("SiLoSeNoSalgo")
                .font(.largeTitle.bold())
                .foregroundStyle(Theme.slate100)
            Text("Baliza · seguimiento en vivo")
                .font(.subheadline)
                .foregroundStyle(Theme.sky500)
            Text("Iniciar sesión")
                .foregroundStyle(Theme.slate400)

            VStack(spacing: 12) {
                TextField("", text: $username, prompt: Text("Usuario").foregroundColor(Theme.slate400))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.username)
                    .appField()

                SecureField("", text: $password, prompt: Text("Contraseña").foregroundColor(Theme.slate400))
                    .textContentType(.password)
                    .appField()
            }
            .padding(.top, 4)

            if let error {
                Text(error)
                    .foregroundStyle(.red)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
            }

            Button {
                Task { await submit() }
            } label: {
                Group {
                    if busy {
                        ProgressView().tint(.white)
                    } else {
                        Text("Entrar").fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            .background(canSubmit ? Theme.sky600 : Theme.slate700)
            .foregroundStyle(.white)
            .cornerRadius(12)
            .disabled(!canSubmit)

            Text("El acceso es solo con cuenta. Pide una invitación al organizador para crearla desde la web.")
                .font(.footnote)
                .foregroundStyle(Theme.slate400)
                .multilineTextAlignment(.center)

            Spacer()
        }
        .padding(24)
    }

    private func submit() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await auth.login(username: username, password: password)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Error de conexión"
        }
    }
}
