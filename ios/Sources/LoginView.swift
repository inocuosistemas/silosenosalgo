import SwiftUI

struct LoginView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var username = ""
    @State private var password = ""
    @State private var isRegister = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Text("SiLoSeNoSalgo")
                .font(.largeTitle.bold())
            Text(isRegister ? "Crear cuenta" : "Iniciar sesión")
                .foregroundStyle(.secondary)

            TextField("Usuario", text: $username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.username)
                .textFieldStyle(.roundedBorder)

            SecureField("Contraseña", text: $password)
                .textContentType(isRegister ? .newPassword : .password)
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
                    Text(isRegister ? "Crear cuenta" : "Entrar").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(busy || username.isEmpty || password.isEmpty)

            Button(isRegister ? "Ya tengo cuenta" : "Crear una cuenta nueva") {
                isRegister.toggle()
                error = nil
            }
            .font(.footnote)

            Spacer()
        }
        .padding()
    }

    private func submit() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            if isRegister {
                try await auth.register(username: username, password: password)
            } else {
                try await auth.login(username: username, password: password)
            }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Error de conexión"
        }
    }
}
