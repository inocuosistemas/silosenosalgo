import SwiftUI
import PhotosUI

/**
 La pantalla de las CUENTAS ATRÁS: lo que enseña el widget.

 Arriba, la tarjeta tal como va a quedar —se ve cambiar mientras se toca el
 color o el emoji, que es lo que hace que elegir tenga sentido—; debajo, la
 lista: primero las carreras en las que estás (su nombre y su salida los pone
 el servidor, y de ellas solo se cambia el aspecto) y después las tuyas, que se
 crean aquí con su fecha.
 */
struct ContadoresView: View {
    @State private var contadores: [Contador] = []
    @State private var editando: Contador?
    @State private var nuevo = false

    var body: some View {
        List {
            Section {
                if let primero = contadores.first {
                    TarjetaContador(contador: primero)
                        .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
                        .listRowBackground(Color.clear)
                }
                Text("Mantén pulsado el widget en la pantalla de inicio para elegir cuál de estas cuentas atrás enseña. Puedes poner varios, cada uno con la suya.")
                    .font(.caption).foregroundStyle(Theme.slate400)
                    .listRowBackground(Theme.slate900)
            } header: {
                Text("EN LA PANTALLA DE INICIO").font(.caption).foregroundStyle(Theme.slate400)
            }

            if !deCarrera.isEmpty {
                Section {
                    ForEach(deCarrera) { c in
                        Button { editando = c } label: { FilaContador(contador: c) }
                    }
                } header: {
                    Text("TUS CARRERAS").font(.caption).foregroundStyle(Theme.slate400)
                } footer: {
                    Text("La fecha y el nombre los pone la carrera: si la organización mueve la salida, la cuenta atrás se mueve con ella. Aquí eliges cómo se ve.")
                        .font(.caption).foregroundStyle(Theme.slate400)
                }
                .listRowBackground(Theme.slate900)
            }

            Section {
                ForEach(propios) { c in
                    Button { editando = c } label: { FilaContador(contador: c) }
                }
                .onDelete { indices in
                    var lista = propios
                    lista.remove(atOffsets: indices)
                    ContadoresDeCarreras.guardaPropios(lista)
                    recarga()
                }
                Button { nuevo = true } label: {
                    Label("Añadir una cuenta atrás", systemImage: "plus.circle.fill")
                }
            } header: {
                Text("LAS TUYAS").font(.caption).foregroundStyle(Theme.slate400)
            }
            .listRowBackground(Theme.slate900)
        }
        .navigationTitle("Cuenta atrás")
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .background(Theme.slate950)
        .onAppear(perform: recarga)
        .sheet(item: $editando) { c in
            EditorContador(contador: c) { guardado in
                if let guardado {
                    if guardado.origen == .carrera { ContadoresDeCarreras.guardaAspecto(guardado) }
                    else { ContadoresDeCarreras.guardaPropios(propios.map { $0.id == guardado.id ? guardado : $0 }) }
                }
                recarga()
            }
        }
        .sheet(isPresented: $nuevo) {
            EditorContador(contador: Contador(nombre: "", fecha: Date().addingTimeInterval(7 * 86_400))) { guardado in
                if let guardado, !guardado.nombre.trimmingCharacters(in: .whitespaces).isEmpty {
                    ContadoresDeCarreras.guardaPropios(propios + [guardado])
                }
                recarga()
            }
        }
    }

    private var deCarrera: [Contador] { contadores.filter { $0.origen == .carrera } }
    private var propios: [Contador] { contadores.filter { $0.origen == .propio } }

    private func recarga() {
        contadores = AlmacenContadores.lee().contadores
            .sorted { $0.fechaVigente() < $1.fechaVigente() }
    }
}

/// Una fila de la lista: la marca, el nombre y lo que falta.
private struct FilaContador: View {
    let contador: Contador

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(Color(hexContador: contador.color).opacity(0.25))
                Text(contador.emoji ?? "⏱").font(.system(size: 17))
            }
            .frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: 1) {
                Text(contador.nombre.isEmpty ? "Sin nombre" : contador.nombre)
                    .foregroundStyle(Theme.slate100)
                Text(cuando)
                    .font(.caption).foregroundStyle(Theme.slate400)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.slate400)
        }
    }

    private var cuando: String {
        let fecha = contador.fechaVigente()
        let faltan = fecha.timeIntervalSinceNow
        let dias = Int(faltan / 86_400)
        if faltan <= 0 { return "ya ha salido" }
        if dias >= 1 { return "faltan \(dias) \(dias == 1 ? "día" : "días")" }
        return "hoy, a las " + fecha.formatted(.dateTime.hour().minute())
    }
}

/// La tarjeta, igual que en el widget: es lo que se está eligiendo.
struct TarjetaContador: View {
    let contador: Contador

    var body: some View {
        let color = Color(hexContador: contador.color)
        let fecha = contador.fechaVigente()
        let faltan = max(0, fecha.timeIntervalSinceNow)
        let dias = Int(faltan / 86_400)
        let horas = Int((faltan - Double(dias) * 86_400) / 3600)
        return ZStack(alignment: .topLeading) {
            if let foto = contador.foto, let img = UIImage(contentsOfFile: AlmacenContadores.fotos.appendingPathComponent(foto).path) {
                Image(uiImage: img).resizable().scaledToFill().overlay(Color.black.opacity(0.55))
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(contador.nombre.isEmpty ? "Sin nombre" : contador.nombre)
                            .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        Text(fecha, format: contador.conHora
                            ? .dateTime.day().month(.abbreviated).hour().minute()
                            : .dateTime.day().month(.abbreviated).year())
                            .font(.system(size: 11)).foregroundStyle(.white.opacity(0.7))
                    }
                    Spacer()
                    if let emoji = contador.emoji { Text(emoji).font(.system(size: 24)) }
                }
                Spacer(minLength: 6)
                // La misma cuenta que el widget, para que elegir sea ver.
                if contador.estilo == .completo && contador.conHora && faltan > 24 * 3600 {
                    let corte = contador.diasYCorte().corte
                    NumeroCuentaAtras(
                        dias: dias, corte: corte, prefijoHoras: contador.prefijoHoras(),
                        color: color, cuerpo: 56, etiqueta: 11, colorEtiqueta: .white.opacity(0.6)
                    )
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text("\(dias)").font(.system(size: 42, weight: .heavy, design: .rounded)).foregroundStyle(color)
                        Text(dias == 1 ? "día" : "días").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                        if contador.conHora { Text("\(horas) h").font(.system(size: 13, weight: .bold)).foregroundStyle(.white.opacity(0.7)) }
                    }
                    .lineLimit(1).minimumScaleFactor(0.6)
                }
            }
            .padding(14)
        }
        .frame(height: 140)
        .background(Theme.slate900)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
