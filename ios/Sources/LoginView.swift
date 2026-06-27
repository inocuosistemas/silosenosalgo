import SwiftUI

struct LoginView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Text("SiLoSeNoSalgo")
                .font(.largeTitle.bold())
            Text("Iniciar sesión")
                .foregroundStyle(.secondary)

            TextField("Usuario", text: $username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.username)
                .textFieldStyle(.roundedBorder)

            SecureField("Contraseña", text: $password)
                .textContentType(.password)
                .textFieldStyle(.roundedBorder)

            if let error {
                Text(error)
                    .foregroundStyle(.red)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
            }

            Button {
                Task { await submit() }
            } label: {
                if busy {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("Entrar").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(busy || username.isEmpty || password.isEmpty)

            Text("El acceso es solo con cuenta. Pide una invitación al organizador para crearla desde la web.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Spacer()
        }
        .padding()
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
