import CoreLocation
import SwiftUI
import UIKit
import UserNotifications

/**
 «Preparar la carrera», la noche antes: lo que hace falta para mañana, cada cosa
 con su arreglo al lado, y dejarla LISTA (ver `PreparacionDeCarrera`). No
 enciende el GPS ni arma nada: eso se hace por la mañana, al tocar el aviso.
 */
struct PantallaPrepararCarrera: View {
    let evento: EventSummary

    @Environment(\.dismiss) private var dismiss
    @State private var preparada: PreparacionDeCarrera?
    @State private var avisoMin = PreparacionDeCarrera.avisoElegido

    // Lo que se comprueba.
    @State private var ruta: [(lat: Double, lon: Double)]?
    @State private var buscandoRuta = true
    @State private var mapa: Double?
    @State private var ubicacion = CLLocationManager().authorizationStatus
    @State private var avisos: UNAuthorizationStatus = .notDetermined
    @State private var bateria: Float = -1
    @State private var cargando = false
    @State private var descargando = false
    @State private var armando = false

    private var salida: Date? {
        evento.startsAt.flatMap { $0 > 0 ? Date(timeIntervalSince1970: $0 / 1000) : nil }
    }

    /// El aviso ya no llegaría a tiempo: se ofrece armarla ya.
    private var tarde: Bool {
        guard let s = salida else { return false }
        return s.addingTimeInterval(-Double(avisoMin) * 60) <= Date()
    }

    var body: some View {
        Form {
            Section {
                HStack(spacing: 12) {
                    Text(evento.myEmoji ?? "🏁").font(.system(size: 34))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(evento.name).font(.title3.weight(.bold)).foregroundStyle(Theme.slate100)
                        Text(cuando).font(.subheadline).foregroundStyle(Theme.slate400)
                    }
                }
                .listRowBackground(Color.clear)
            }

            Section {
                if evento.planShareId != nil {
                    item(.hecho, "Recorrido y cortes", "Los del evento")
                } else {
                    item(.aviso, "Recorrido", "La organización aún no lo ha publicado")
                }
                filaMapa
                filaUbicacion
                filaAvisos
                filaBateria
            } header: {
                Text("LA NOCHE ANTES").font(.caption).foregroundStyle(Theme.slate400)
            } footer: {
                Text("Lo que falta se arregla aquí mismo. Nada de esto enciende todavía el GPS.")
                    .font(.caption).foregroundStyle(Theme.slate400)
            }
            .listRowBackground(Theme.slate900)

            Section {
                Picker("Aviso para armarla", selection: $avisoMin) {
                    ForEach(PreparacionDeCarrera.opcionesDeAviso, id: \.self) { m in
                        Text(m % 60 == 0 ? "\(m / 60) h antes" : m > 60 ? "\(m / 60) h \(m % 60) min antes" : "\(m) min antes")
                            .tag(m)
                    }
                }
                .disabled(preparada != nil)
            } header: {
                Text("EL DÍA DE LA CARRERA").font(.caption).foregroundStyle(Theme.slate400)
            } footer: {
                Text("Te llega un aviso: al tocarlo, la baliza queda armada y sale sola a la hora. Mejor así que dejarla armada toda la noche, que iOS puede dormir la app.")
                    .font(.caption).foregroundStyle(Theme.slate400)
            }
            .listRowBackground(Theme.slate900)

            Section { accion }
                .listRowBackground(Theme.slate900)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.slate950)
        .navigationTitle("Preparar la carrera")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { dismiss() } }
        }
        .task { await compruebaTodo() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            // Al volver de Ajustes, lo que se haya cambiado allí.
            Task { await compruebaPermisos() }
        }
        .sheet(isPresented: $descargando, onDismiss: { Task { await compruebaMapa() } }) {
            MapDownloadView(routeName: evento.name, polyline: ruta)
        }
    }

    private var cuando: String {
        guard let s = salida else { return "Sin hora de salida todavía" }
        let dia = Calendar.current.isDateInToday(s) ? "hoy"
            : Calendar.current.isDateInTomorrow(s) ? "mañana"
            : s.formatted(.dateTime.weekday(.wide).day().month())
        return "\(dia) · salida \(s.formatted(date: .omitted, time: .shortened))"
    }

    // MARK: Filas

    @ViewBuilder
    private var filaMapa: some View {
        if buscandoRuta {
            item(.buscando, "Mapa sin cobertura", "Comprobando…")
        } else if ruta == nil {
            item(.aviso, "Mapa sin cobertura", "Sin recorrido que descargar (o sin red para bajarlo)")
        } else if let m = mapa, m >= 0.95 {
            item(.hecho, "Mapa sin cobertura", "Descargado")
        } else {
            item(.falta, "Mapa sin cobertura",
                 mapa.map { $0 > 0 ? "Descargado un \(Int($0 * 100)) %" : "Para verte en el mapa en la montaña" }
                    ?? "Para verte en el mapa en la montaña",
                 boton: "Descargar") { descargando = true }
        }
    }

    @ViewBuilder
    private var filaUbicacion: some View {
        switch ubicacion {
        case .authorizedAlways:
            item(.hecho, "Ubicación «Siempre»", "Para seguir con la pantalla apagada")
        case .notDetermined:
            item(.falta, "Ubicación «Siempre»", "Para seguir con la pantalla apagada",
                 boton: "Permitir") { TrackingStore.shared.pideUbicacion() }
        default:
            item(.falta, "Ubicación «Siempre»", "Ahora: \(ubicacion == .authorizedWhenInUse ? "al usar la app" : "desactivada")",
                 boton: "Ajustes") { abreAjustes() }
        }
    }

    @ViewBuilder
    private var filaAvisos: some View {
        switch avisos {
        case .authorized, .provisional, .ephemeral:
            item(.hecho, "Avisos", "El de la mañana y el de la salida")
        case .notDetermined:
            item(.falta, "Avisos", "Sin ellos no llega el aviso para armarla", boton: "Permitir") {
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in
                    Task { await compruebaPermisos() }
                }
            }
        default:
            item(.falta, "Avisos", "Desactivados: no llegaría el aviso para armarla", boton: "Ajustes") { abreAjustes() }
        }
    }

    @ViewBuilder
    private var filaBateria: some View {
        let pct = Int((bateria * 100).rounded())
        if bateria < 0 {
            item(.hecho, "Batería", "No se puede saber en este aparato")
        } else if cargando {
            item(.hecho, "Batería", "Cargando · \(pct) %")
        } else if bateria >= 0.8 {
            item(.hecho, "Batería", "\(pct) %")
        } else {
            item(.aviso, "Batería \(pct) %", "Déjalo cargando esta noche")
        }
    }

    @ViewBuilder
    private var accion: some View {
        if salida == nil {
            Text("La carrera no tiene hora de salida todavía: cuando la organización la ponga, podrás prepararla.")
                .font(.footnote).foregroundStyle(Theme.slate400)
        } else if let p = preparada {
            VStack(alignment: .leading, spacing: 6) {
                Label("Todo listo", systemImage: "checkmark.seal.fill")
                    .font(.headline).foregroundStyle(Theme.emerald300)
                Text("A las \(p.avisoA.formatted(date: .omitted, time: .shortened)) te llega un aviso: tócalo y la baliza queda armada para salir sola a las \(p.salida.formatted(date: .omitted, time: .shortened)). Si no lo tocas, te volvemos a avisar a las \(p.recordatorioA.formatted(date: .omitted, time: .shortened)).")
                    .font(.footnote).foregroundStyle(Theme.slate400)
            }
            .padding(.vertical, 4)
            if tarde {
                botonArmar
            }
            Button("Quitar la preparación", role: .destructive) {
                PreparacionDeCarrera.olvida()
                preparada = nil
            }
            .font(.footnote)
        } else if tarde {
            botonArmar
        } else if let s = salida {
            Button {
                let p = PreparacionDeCarrera(eventoId: evento.id, nombre: evento.name, salida: s, avisoMin: avisoMin)
                p.guarda()
                preparada = p
                Vibra.exito()
            } label: {
                Text("Dejar lista para las \(s.formatted(date: .omitted, time: .shortened))")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Theme.sky600).foregroundStyle(.white).cornerRadius(12)
            }
            .buttonStyle(.plain)
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
        }
    }

    /// Ya es la hora del aviso (o pasada): armarla ahora mismo.
    private var botonArmar: some View {
        Button {
            guard let s = salida else { return }
            armando = true
            let p = preparada ?? PreparacionDeCarrera(eventoId: evento.id, nombre: evento.name, salida: s, avisoMin: avisoMin)
            p.guarda()
            Task {
                await PreparacionDeCarrera.arma()
                armando = false
                dismiss()
            }
        } label: {
            HStack {
                if armando { ProgressView().tint(.white) }
                Text("Armar ya · sale sola a las \(salida?.formatted(date: .omitted, time: .shortened) ?? "")")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 14)
            .background(Theme.sky600).foregroundStyle(.white).cornerRadius(12)
        }
        .buttonStyle(.plain)
        .disabled(armando)
        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
    }

    enum Estado { case hecho, falta, aviso, buscando }

    private func item(_ e: Estado, _ t: String, _ s: String, boton: String? = nil,
                      accion: (() -> Void)? = nil) -> some View {
        HStack(spacing: 12) {
            Group {
                if e == .buscando {
                    ProgressView()
                } else {
                    Image(systemName: e == .hecho ? "checkmark.circle.fill"
                          : e == .falta ? "circle" : "exclamationmark.triangle.fill")
                        .foregroundStyle(e == .hecho ? Theme.emerald300 : e == .falta ? Theme.slate400 : Color.orange)
                }
            }
            .font(.title3)
            .frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(t).foregroundStyle(Theme.slate100)
                Text(s).font(.caption).foregroundStyle(Theme.slate400)
            }
            Spacer()
            if let boton, let accion {
                Button(boton, action: accion)
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(Capsule().fill(Theme.sky600)).foregroundStyle(.white)
                    .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 2)
    }

    private func abreAjustes() {
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    }

    // MARK: Comprobar

    private func compruebaTodo() async {
        preparada = PreparacionDeCarrera.de(evento: evento.id)
        if let p = preparada { avisoMin = p.avisoMin }
        await compruebaPermisos()
        await compruebaMapa()
    }

    private func compruebaPermisos() async {
        ubicacion = CLLocationManager().authorizationStatus
        avisos = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        UIDevice.current.isBatteryMonitoringEnabled = true
        bateria = UIDevice.current.batteryLevel
        cargando = UIDevice.current.batteryState == .charging || UIDevice.current.batteryState == .full
    }

    /// Cuánto del corredor del recorrido está ya en el móvil (el mismo que
    /// descarga «Preparar el mapa»).
    private func compruebaMapa() async {
        buscandoRuta = true
        defer { buscandoRuta = false }
        if ruta == nil, let id = evento.planShareId,
           let gz = try? await API.fetchSharePayload(shareId: id) {
            ruta = PlanGeometry.polyline(fromGzip: gz)
        }
        guard let r = ruta else { mapa = nil; return }
        let fraccion = await Task.detached {
            // Hasta el 13: con eso ya se ve por dónde se va. Se puede haber
            // bajado con más o menos detalle («Preparar el mapa» deja elegir),
            // y exigir el 15 daba por a medias un mapa que sirve.
            let tiles = TileCache.corridorTiles(polyline: r, corridorMeters: 800, zMin: 12, zMax: OfmCache.zoomMax)
            guard !tiles.isEmpty else { return 0.0 }
            return Double(OfmCache.shared.cachedTiles(in: tiles)) / Double(tiles.count)
        }.value
        mapa = fraccion
    }
}
