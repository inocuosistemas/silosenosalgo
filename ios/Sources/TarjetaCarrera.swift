import SwiftUI
import UIKit

/// El cartel de una carrera, guardado en el móvil.
///
/// Se descarga una vez por versión (`photoAt`) y se lee de disco después: la
/// app se abre en la línea de salida, muchas veces sin cobertura, y ahí la
/// tarjeta no puede quedarse en blanco. Si no hay red y la versión nueva no
/// está, se enseña la anterior que haya.
enum FotosDeCarrera {
    private static var carpeta: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("fotos-carreras", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func carga(_ ev: EventSummary) async -> UIImage? {
        guard ev.hasPhoto == true else { return nil }
        let version = Int64(ev.photoAt ?? 0)
        let fichero = carpeta.appendingPathComponent("\(ev.id)-\(version).img")
        if let img = UIImage(contentsOfFile: fichero.path) { return img }

        var c = URLComponents(url: Config.baseURL.appendingPathComponent("api/events/\(ev.id)/photo"),
                              resolvingAgainstBaseURL: false)
        if version > 0 { c?.queryItems = [URLQueryItem(name: "v", value: String(version))] }
        if let url = c?.url,
           let (data, resp) = try? await URLSession.shared.data(from: url),
           (resp as? HTTPURLResponse)?.statusCode == 200,
           let img = UIImage(data: data) {
            // La nueva sustituye a las anteriores de esta carrera.
            for viejo in anteriores(de: ev.id) { try? FileManager.default.removeItem(at: viejo) }
            try? data.write(to: fichero, options: .atomic)
            return img
        }
        return anteriores(de: ev.id).lazy.compactMap { UIImage(contentsOfFile: $0.path) }.first
    }

    private static func anteriores(de id: String) -> [URL] {
        let todos = (try? FileManager.default.contentsOfDirectory(at: carpeta, includingPropertiesForKeys: nil)) ?? []
        return todos.filter { $0.lastPathComponent.hasPrefix("\(id)-") }
    }
}

/// Una carrera de "Mis carreras", como en la web: el cartel a lo ancho, el
/// nombre y la fecha encima sobre un degradado, y debajo el recorrido y
/// "Abrir". La elegida para la baliza lleva borde azul y "Preparada"; la
/// próxima, la cuenta atrás en grande.
struct TarjetaCarrera<Menu: View>: View {
    let ev: EventSummary
    let cuando: String
    let hoy: Bool
    let elegida: Bool
    let proxima: Bool
    let onElegir: () -> Void
    let menu: () -> Menu

    @State private var foto: UIImage?

    /// El alto del cartel: un tercio de lo que mide la tarjeta en un iPhone normal.
    static var altoCartel: CGFloat { 124 }

    /// `fotoInicial` es para pintarla sin esperar a la descarga (vistas previas).
    init(ev: EventSummary, cuando: String, hoy: Bool, elegida: Bool, proxima: Bool,
         fotoInicial: UIImage? = nil, onElegir: @escaping () -> Void,
         @ViewBuilder menu: @escaping () -> Menu) {
        self.ev = ev
        self.cuando = cuando
        self.hoy = hoy
        self.elegida = elegida
        self.proxima = proxima
        self.onElegir = onElegir
        self.menu = menu
        _foto = State(initialValue: fotoInicial)
    }

    var body: some View {
        VStack(spacing: 0) {
            // El hueco del cartel manda en el tamaño: todo el ancho y un alto FIJO,
            // que en un iPhone es casi el 3:1 de la web. Con `aspectRatio` el alto
            // dependía de lo que la lista le ofreciera y, en la tarjeta con cuenta
            // atrás, el hueco se quedaba estrecho en mitad de la tarjeta.
            // Foto, degradado y nombre van en capas SEPARADAS encima: la foto
            // rellena y se sale del hueco (se recorta), y si compartiera capa con
            // el nombre, lo arrastraría fuera y lo cortaría.
            Color.clear
                .frame(maxWidth: .infinity)
                .frame(height: Self.altoCartel)
                .overlay {
                    if let foto {
                        Image(uiImage: foto).resizable().scaledToFill()
                    } else {
                        ZStack {
                            Theme.slate800
                            Text("🏁").font(.title2).opacity(0.6)
                        }
                    }
                }
                .clipped()
                .overlay {
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0.3),
                            .init(color: Theme.slate950.opacity(0.75), location: 0.7),
                            .init(color: Theme.slate950, location: 1),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                }
                .overlay(alignment: .bottomLeading) {
                    HStack(alignment: .bottom, spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ev.myEmoji.map { "\($0)  \(ev.name)" } ?? ev.name)
                                .font(.headline.weight(.bold))
                                .foregroundStyle(Theme.slate100)
                                .lineLimit(1)
                            Text(cuando)
                                .font(.caption)
                                .foregroundStyle(hoy ? Theme.sky500 : Theme.slate400)
                        }
                        Spacer(minLength: 0)
                        if ev.isOwner == true {
                            etiqueta("organizas", color: Color(red: 0.984, green: 0.749, blue: 0.141))
                        }
                        if elegida { etiqueta("Preparada", color: Theme.sky500) }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
                }

            if proxima { ContadorGrande(salidaMs: ev.startsAt) }

            HStack(spacing: 8) {
                Text(ev.planName ?? "Sin recorrido todavía")
                    .font(.caption)
                    .foregroundStyle(Theme.slate400)
                    .lineLimit(1)
                Spacer(minLength: 0)
                menu()
            }
            .padding(.leading, 12)
            .padding(.trailing, 8)
            .padding(.vertical, 6)
        }
        .background(Theme.slate900)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(elegida ? Theme.sky500 : Theme.slate800, lineWidth: elegida ? 2 : 1)
        )
        .contentShape(Rectangle())
        .onTapGesture(perform: onElegir)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(elegida ? "Quitar la carrera de la baliza" : "Preparar la baliza para esta carrera")
        .task(id: "\(ev.id)-\(ev.photoAt ?? 0)") {
            if let nueva = await FotosDeCarrera.carga(ev) { foto = nueva }
        }
    }

    private func etiqueta(_ texto: String, color: Color) -> some View {
        Text(texto)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.18), in: RoundedRectangle(cornerRadius: 5))
    }
}

/// La cuenta atrás de la próxima salida, en grande: días, horas, minutos y
/// segundos en bloques, como el cuadro de la salida del mapa de la web. Se
/// repinta sola cada segundo y desaparece al llegar la hora.
struct ContadorGrande: View {
    let salidaMs: Double?

    static func partes(salidaMs: Double?, ahora: Date) -> (d: Int, h: Int, m: Int, s: Int)? {
        guard let ms = salidaMs, ms > 0 else { return nil }
        let restan = Int((ms / 1000 - ahora.timeIntervalSince1970).rounded(.down))
        guard restan > 0 else { return nil }
        return (restan / 86_400, (restan % 86_400) / 3_600, (restan % 3_600) / 60, restan % 60)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            if let p = Self.partes(salidaMs: salidaMs, ahora: ctx.date) {
                VStack(spacing: 4) {
                    Text("SALIDA EN")
                        .font(.caption2.weight(.semibold))
                        .tracking(1.2)
                        .foregroundStyle(Theme.slate400)
                    HStack(alignment: .top, spacing: 4) {
                        bloque(p.d, "D")
                        separador
                        bloque(p.h, "H")
                        separador
                        bloque(p.m, "MIN")
                        separador
                        bloque(p.s, "S")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 10)
                .padding(.bottom, 2)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Salida en \(p.d) días, \(p.h) horas y \(p.m) minutos")
            }
        }
    }

    private var separador: some View {
        Text(":")
            .font(.system(size: 26, weight: .bold, design: .monospaced))
            .foregroundStyle(Theme.slate700)
    }

    private func bloque(_ valor: Int, _ unidad: String) -> some View {
        VStack(spacing: 0) {
            Text(String(format: "%02d", valor))
                .font(.system(size: 32, weight: .heavy, design: .monospaced))
                .foregroundStyle(Theme.slate100)
                .monospacedDigit()
            Text(unidad)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Theme.slate400)
        }
        .frame(minWidth: 44)
    }
}
