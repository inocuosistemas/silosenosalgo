import SwiftUI
import MapKit
import Photos
import PhotosUI

/**
 Añadir fotos a una salida YA TERMINADA, cada una en su sitio del recorrido.

 Se vuelve de la ruta con las fotos en el carrete y la salida cerrada: aquí se
 buscan las que se hicieron durante ella (por la hora), se eligen otras si se
 quiere, se repasan en el mapa y se suben como notas con foto, las mismas que
 se hacen en marcha. Cómo se decide el sitio de cada una: `ColocaFotos`.
 */
@MainActor
final class FotosEnRutaModelo: ObservableObject {
    struct Foto: Identifiable {
        let id = UUID()
        /// El id de la nota, fijo desde el principio: si la subida se corta y se
        /// reintenta, el servidor reconoce la misma nota y no la duplica.
        let notaId = TrackingStore.genId()
        var miniatura: UIImage
        /// El JPEG ya reducido, el que se sube.
        var datos: Data
        var fecha: Date?
        var gps: CLLocationCoordinate2D?
        var sitio: ColocaFotos.Sitio?
        /// El de la fototeca, para no añadir dos veces la misma.
        var assetId: String?
    }

    enum Fase: Equatable { case cargando, sinTrazado(String), eligiendo, repaso, subiendo, hecho }

    let sesion: TrackSessionSummary
    @Published var fase: Fase = .cargando
    @Published var fotos: [Foto] = []
    @Published var seleccionada: UUID?
    /// Las de la fototeca hechas durante la salida (nil = aún no se ha buscado).
    @Published var halladas: [PHAsset]?
    /// Las halladas que se han marcado para añadir (por su id de la fototeca).
    @Published var elegidasDeLaRuta: Set<String> = []
    /// Las halladas que ya están en alguna nota de la salida (ver
    /// `ColocaFotos.yaAnadidas`): se enseñan, pero marcadas.
    @Published var yaEstan: Set<String> = []
    /// Las notas con foto que ya tiene la salida: su `createdAt` y su `fixAt`.
    var notasConFoto: [(createdAt: Double, fixAt: Double?)] = []
    @Published var sinPermiso = false
    @Published var preparando = 0
    @Published var subidas: Set<UUID> = []
    @Published var error: String?
    @Published var fijar = true

    private(set) var trail: [TrailPoint] = []
    private var acum: [Double] = []
    /// Cómo se sube una foto; en la pantalla de prueba, de mentira.
    var subidor: (Foto, ColocaFotos.Sitio) async throws -> Void

    static let tope = 50

    init(sesion: TrackSessionSummary) {
        self.sesion = sesion
        subidor = { _, _ in }
        subidor = { [unowned self] foto, sitio in try await self.subeDeVerdad(foto, sitio) }
    }

    var colocadas: [Foto] { fotos.filter { $0.sitio != nil } }
    var sinSitio: [Foto] { fotos.filter { $0.sitio == nil } }
    var bytes: Int { colocadas.reduce(0) { $0 + $1.datos.count } }
    var coordenadas: [CLLocationCoordinate2D] { trail.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) } }
    var desde: Date? { trail.first.map { Date(timeIntervalSince1970: $0.t / 1000) } }
    var hasta: Date? { trail.last.map { Date(timeIntervalSince1970: $0.t / 1000) } }

    // MARK: El trazado

    /// El del móvil si lo guarda (entero), si no el del servidor.
    func cargaTrazado() async {
        var t: [TrailPoint] = []
        if LocalStore.hasTrail(sesion.id), let d = try? Data(contentsOf: LocalStore.trailURL(sesion.id)) {
            t = (try? JSONDecoder().decode([TrailPoint].self, from: d)) ?? []
        }
        if t.count < 2 {
            do { t = try await API.trazado(sessionId: sesion.id) } catch {
                fase = .sinTrazado("No se ha podido traer el recorrido de esta salida. Comprueba la conexión.")
                return
            }
        }
        ponTrazado(t.sorted { $0.t < $1.t })
        // Las que ya tiene, para no ofrecer otra vez lo que ya está. Del
        // servidor, que las tiene todas (también las de otro móvil); sin red,
        // las que guarde este.
        var notas = (try? await API.notasDe(sessionId: sesion.id)) ?? []
        if notas.isEmpty, let d = try? Data(contentsOf: LocalStore.notesURL(sesion.id)) {
            notas = (try? JSONDecoder().decode([Note].self, from: d)) ?? []
        }
        notasConFoto = notas.filter { $0.photoKey != nil }.map { ($0.createdAt, $0.fixAt) }
    }

    func ponTrazado(_ t: [TrailPoint]) {
        guard t.count >= 2 else {
            fase = .sinTrazado("Esta salida no tiene recorrido guardado: no hay dónde poner las fotos.")
            return
        }
        trail = t
        acum = ColocaFotos.acumulado(t)
        fase = .eligiendo
    }

    // MARK: Buscar y elegir

    /// Las fotos del carrete hechas durante la salida (con el margen de antes
    /// de salir y de después de llegar).
    func buscaEnLaFototeca() async {
        let estado = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        guard estado == .authorized || estado == .limited else { sinPermiso = true; return }
        guard let a = trail.first?.t, let b = trail.last?.t else { return }
        let opciones = PHFetchOptions()
        opciones.predicate = NSPredicate(
            format: "mediaType == %d AND creationDate >= %@ AND creationDate <= %@",
            PHAssetMediaType.image.rawValue,
            Date(timeIntervalSince1970: (a - ColocaFotos.margenMs) / 1000) as NSDate,
            Date(timeIntervalSince1970: (b + ColocaFotos.margenMs) / 1000) as NSDate
        )
        opciones.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        let r = PHAsset.fetchAssets(with: opciones)
        var lista: [PHAsset] = []
        r.enumerateObjects { a, _, _ in lista.append(a) }
        let ya = Set(fotos.compactMap(\.assetId))
        let resto = lista.filter { !ya.contains($0.localIdentifier) }
        yaEstan = ColocaFotos.yaAnadidas(
            resto.compactMap { a in a.creationDate.map { (a.localIdentifier, $0.timeIntervalSince1970 * 1000) } },
            notas: notasConFoto
        )
        halladas = resto
    }

    /// Las halladas que aún no están en la salida.
    var halladasNuevas: Int { (halladas ?? []).filter { !yaEstan.contains($0.localIdentifier) }.count }

    /// Cuántas caben todavía.
    var huecos: Int { max(0, Self.tope - fotos.count) }

    func alternaHallada(_ id: String) {
        if elegidasDeLaRuta.contains(id) { elegidasDeLaRuta.remove(id) }
        else if elegidasDeLaRuta.count < huecos { elegidasDeLaRuta.insert(id) }
    }

    /// Todas las que quepan, o ninguna.
    func eligeTodasLasHalladas(_ todas: Bool) {
        // «Todas» son las que faltan: las que ya están no se repiten.
        let nuevas = (halladas ?? []).filter { !yaEstan.contains($0.localIdentifier) }
        elegidasDeLaRuta = todas ? Set(nuevas.prefix(huecos).map(\.localIdentifier)) : []
    }

    /// Añade las marcadas; las demás siguen ahí por si se quieren luego.
    func anadeHalladas() async {
        let lista = (halladas ?? []).filter { elegidasDeLaRuta.contains($0.localIdentifier) }
        halladas = (halladas ?? []).filter { !elegidasDeLaRuta.contains($0.localIdentifier) }
        elegidasDeLaRuta = []
        for a in lista {
            guard fotos.count < Self.tope else { break }
            if fotos.contains(where: { $0.assetId == a.localIdentifier }) { continue }
            preparando += 1
            if let datos = await Self.datosDe(a) {
                await anade(datos: datos, fecha: a.creationDate, gps: a.location?.coordinate, assetId: a.localIdentifier)
            }
            preparando -= 1
        }
    }

    func anadeDelSelector(_ items: [PhotosPickerItem]) async {
        for item in items {
            guard fotos.count < Self.tope else { break }
            if let id = item.itemIdentifier, fotos.contains(where: { $0.assetId == id }) { continue }
            preparando += 1
            if let datos = try? await item.loadTransferable(type: Data.self) {
                // El selector no dice nada de la foto, pero entrega el fichero
                // entero: la hora y el GPS van dentro.
                let m = ColocaFotos.metadatos(datos)
                await anade(datos: datos, fecha: m.fecha, gps: m.gps, assetId: item.itemIdentifier)
            }
            preparando -= 1
        }
    }

    /// Reducida como las de las notas en marcha, fuera del hilo principal.
    private func anade(datos: Data, fecha: Date?, gps: CLLocationCoordinate2D?, assetId: String?) async {
        let listo = await Task.detached(priority: .userInitiated) { () -> (Data, UIImage)? in
            guard let img = Imagen.reducida(datos, lado: 1600) else { return nil }
            let jpeg = AddNoteView.reducida(img)
            let mini = UIImage(data: jpeg)?.preparingThumbnail(of: CGSize(width: 180, height: 180)) ?? img
            return (jpeg, mini)
        }.value
        guard let (jpeg, mini) = listo else { return }
        anade(Foto(miniatura: mini, datos: jpeg, fecha: fecha, gps: gps, sitio: nil, assetId: assetId))
    }

    func anade(_ f: Foto) {
        var f = f
        f.sitio = ColocaFotos.coloca(fecha: f.fecha.map { $0.timeIntervalSince1970 * 1000 }, gps: f.gps, trail, acum)
        fotos.append(f)
        fotos.sort { ($0.sitio?.distM ?? .infinity) < ($1.sitio?.distM ?? .infinity) }
    }

    private static func datosDe(_ a: PHAsset) async -> Data? {
        await withCheckedContinuation { c in
            let o = PHImageRequestOptions()
            o.isNetworkAccessAllowed = true   // las que están solo en iCloud
            o.deliveryMode = .highQualityFormat
            o.version = .current
            PHImageManager.default().requestImageDataAndOrientation(for: a, options: o) { d, _, _, _ in
                c.resume(returning: d)
            }
        }
    }

    // MARK: Repaso

    /// Tocado en el mapa: la seleccionada va ahí, pegada al trazado.
    func mueve(_ id: UUID, a c: CLLocationCoordinate2D) {
        guard let i = fotos.firstIndex(where: { $0.id == id }),
              let s = ColocaFotos.aMano(lat: c.latitude, lon: c.longitude, trail, acum) else { return }
        fotos[i].sitio = s
        // La siguiente sin sitio, para colocarlas seguidas.
        seleccionada = sinSitio.first?.id ?? id
    }

    func quita(_ id: UUID) {
        fotos.removeAll { $0.id == id }
        if seleccionada == id { seleccionada = sinSitio.first?.id }
    }

    // MARK: Subir

    func sube() async {
        fase = .subiendo
        error = nil
        var fallos = 0
        for f in colocadas where !subidas.contains(f.id) {
            guard let s = f.sitio else { continue }
            do {
                try await subidor(f, s)
                subidas.insert(f.id)
            } catch {
                fallos += 1
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
        if fallos == 0 {
            if fijar && !sesion.isPinned { await TrackingStore.shared.setPinned(sesion.id, true) }
            fase = .hecho
        } else {
            error = "\(fallos) no se han podido subir. \(error ?? "")"
            fase = .repaso
        }
    }

    private func subeDeVerdad(_ f: Foto, _ s: ColocaFotos.Sitio) async throws {
        let token = TrackingStore.shared.token
        // En orden con el resto de la salida: la hora de la foto si es la que
        // la puso ahí; si no, la del trazado en ese punto.
        let cuando = s.modo == .porHora ? (f.fecha.map { $0.timeIntervalSince1970 * 1000 } ?? s.t) : s.t
        var nota = Note(
            // La hora exacta de la foto: es lo que permite reconocerla luego
            // como ya añadida (ver `ColocaFotos.yaAnadidas`).
            id: f.notaId, createdAt: cuando, fixAt: f.fecha.map { $0.timeIntervalSince1970 * 1000 },
            lat: s.lat, lon: s.lon, accuracy: nil, altitude: nil,
            trackKm: nil, distM: s.distM, title: nil, body: nil,
            poiType: PoiTypes.defaultSlug, poiSym: nil, audioKey: nil, photoKey: nil
        )
        try await API.createNote(token: token, sessionId: sesion.id, note: nota)
        try await API.uploadNoteMedia(token: token, sessionId: sesion.id, noteId: f.notaId,
                                      kind: "photo", data: f.datos, contentType: "image/jpeg")
        // Si el móvil guarda la salida, también aquí: su mapa sin conexión
        // (y la guía que se exporte) las enseña.
        if LocalStore.hasTrail(sesion.id) {
            let nombre = "\(f.notaId)_photo.jpg"
            try? f.datos.write(to: LocalStore.mediaFileURL(sesion.id, nombre), options: .atomic)
            nota.photoKey = nombre
            let url = LocalStore.notesURL(sesion.id)
            var notas = (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode([Note].self, from: $0) } ?? []
            notas.removeAll { $0.id == nota.id }
            notas.append(nota)
            notas.sort { $0.createdAt < $1.createdAt }
            if let d = try? JSONEncoder().encode(notas) { try? d.write(to: url, options: .atomic) }
        }
    }
}

struct PantallaFotosEnRuta: View {
    @StateObject var modelo: FotosEnRutaModelo
    @Environment(\.dismiss) private var dismiss
    @State private var elegidas: [PhotosPickerItem] = []
    @State private var eligiendoDeLaRuta = false

    var body: some View {
        NavigationStack {
            Group {
                switch modelo.fase {
                case .cargando:
                    ProgressView("Cargando el recorrido…").frame(maxWidth: .infinity, maxHeight: .infinity)
                case .sinTrazado(let motivo):
                    Text(motivo).foregroundStyle(Theme.slate400).multilineTextAlignment(.center).padding(30)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .eligiendo:
                    eligiendo
                case .repaso, .subiendo:
                    repaso
                case .hecho:
                    hecho
                }
            }
            .background(Theme.slate950)
            .navigationTitle(modelo.fase == .repaso || modelo.fase == .subiendo ? "Repasa dónde va cada una" : "Añadir fotos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if modelo.fase == .repaso {
                        Button("Atrás") { modelo.fase = .eligiendo }
                    } else if modelo.fase != .hecho {
                        Button("Cancelar") { dismiss() }.disabled(modelo.fase == .subiendo)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if modelo.fase == .hecho { Button("Hecho") { dismiss() } }
                }
            }
            .task { if modelo.fase == .cargando { await modelo.cargaTrazado() } }
        }
        .tint(Theme.sky500)
        .preferredColorScheme(.dark)
        .interactiveDismissDisabled(modelo.fase == .subiendo)
    }

    private static func hora(_ d: Date?) -> String { d?.formatted(date: .omitted, time: .shortened) ?? "?" }

    // MARK: Elegir

    private var eligiendo: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(TrackingStore.shared.labelForSession(modelo.sesion))
                        .font(.headline).foregroundStyle(Theme.slate100).lineLimit(1)
                    Text("De \(Self.hora(modelo.desde)) a \(Self.hora(modelo.hasta)) · \(modelo.desde?.formatted(.dateTime.day().month(.wide)) ?? "")")
                        .font(.caption).foregroundStyle(Theme.slate400)
                }
                tarjetaDeLaRuta
                PhotosPicker(selection: $elegidas, maxSelectionCount: max(1, modelo.huecos), matching: .images, photoLibrary: .shared()) {
                    Label("Elegir otras de la galería", systemImage: "photo.on.rectangle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .onChange(of: elegidas) { _, items in
                    guard !items.isEmpty else { return }
                    Task { await modelo.anadeDelSelector(items); elegidas = [] }
                }
                if modelo.preparando > 0 {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Preparando \(modelo.preparando == 1 ? "una foto" : "\(modelo.preparando) fotos")…")
                            .font(.footnote).foregroundStyle(Theme.slate400)
                    }
                }
                if !modelo.fotos.isEmpty { cuadricula }
            }
            .padding(16)
        }
        .navigationDestination(isPresented: $eligiendoDeLaRuta) {
            ElegirDeLaRuta(modelo: modelo) {
                eligiendoDeLaRuta = false
                Task { await modelo.anadeHalladas() }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !modelo.fotos.isEmpty {
                Button {
                    modelo.seleccionada = modelo.sinSitio.first?.id
                    modelo.fase = .repaso
                } label: {
                    Text("Ver en el mapa (\(modelo.fotos.count))").fontWeight(.semibold).frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(modelo.preparando > 0)
                .padding(16)
                .background(Theme.slate950)
                .accessibilityIdentifier("verEnElMapa")
            }
        }
    }

    /// Lo que se ofrece primero: las del carrete de esas horas.
    @ViewBuilder
    private var tarjetaDeLaRuta: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Las de la ruta", systemImage: "clock.arrow.circlepath")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.slate100)
            if modelo.sinPermiso {
                Text("Sin permiso para ver la galería no se pueden buscar. Elígelas abajo, o dale permiso en Ajustes.")
                    .font(.footnote).foregroundStyle(Theme.slate400)
            } else if let halladas = modelo.halladas {
                if halladas.isEmpty {
                    Text(modelo.fotos.contains { $0.assetId != nil }
                         ? "Ya están todas las de esas horas."
                         : "En tu galería no hay fotos de esas horas. Si las hizo otra cámara, elígelas abajo: se colocan por su GPS.")
                        .font(.footnote).foregroundStyle(Theme.slate400)
                } else {
                    let ya = halladas.count - modelo.halladasNuevas
                    Text((modelo.fotos.contains { $0.assetId != nil }
                          ? (halladas.count == 1 ? "Queda una de esas horas sin añadir." : "Quedan \(halladas.count) de esas horas sin añadir.")
                          : "Hay \(halladas.count == 1 ? "una foto hecha" : "\(halladas.count) fotos hechas") durante la salida.")
                         + (ya == 0 ? "" : ya == 1 ? " Una ya está en la salida." : " \(ya) ya están en la salida."))
                        .font(.footnote).foregroundStyle(Theme.slate400)
                    // Elegir primero: un día de ruta son fácilmente cien fotos,
                    // y no todas van al mapa.
                    Button {
                        modelo.elegidasDeLaRuta = []
                        eligiendoDeLaRuta = true
                    } label: {
                        Text(halladas.count == 1 ? "Verla" : "Elegir cuáles").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("elegirHalladas")
                }
            } else {
                Text("Busca en tu galería las que hiciste entre la salida y la llegada, y las pone donde estabas a esa hora.")
                    .font(.footnote).foregroundStyle(Theme.slate400)
                Button {
                    Task { await modelo.buscaEnLaFototeca() }
                } label: {
                    Text("Buscar las fotos de la ruta").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("buscarFotos")
            }
        }
        .padding(14)
        .background(Theme.slate900)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var cuadricula: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(modelo.fotos.count) \(modelo.fotos.count == 1 ? "foto" : "fotos")" +
                 (modelo.sinSitio.isEmpty ? "" : " · \(modelo.sinSitio.count) sin sitio (se ponen en el mapa)"))
                .font(.caption).foregroundStyle(Theme.slate400)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(modelo.fotos) { f in
                    Image(uiImage: f.miniatura)
                        .resizable().scaledToFill()
                        .frame(minWidth: 0, maxWidth: .infinity).aspectRatio(1, contentMode: .fit)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(alignment: .bottomLeading) { insignia(f).padding(5) }
                        .overlay(alignment: .topTrailing) {
                            Button { modelo.quita(f.id) } label: {
                                Image(systemName: "xmark.circle.fill").font(.title3)
                                    .symbolRenderingMode(.palette).foregroundStyle(.white, .black.opacity(0.6))
                            }
                            .padding(4)
                            .accessibilityLabel("Quitar")
                        }
                }
            }
        }
    }

    /// Cómo se ha colocado: por la hora, por su GPS, a mano, o sin sitio.
    private func insignia(_ f: FotosEnRutaModelo.Foto) -> some View {
        let (icono, texto): (String, String) = switch f.sitio?.modo {
        case .porHora: ("clock", Self.hora(f.fecha))
        case .porGPS: ("location.fill", "GPS")
        case .aMano: ("hand.point.up.left.fill", "a mano")
        case nil: ("questionmark", "sin sitio")
        }
        return Label(texto, systemImage: icono)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(f.sitio == nil ? Color.orange.opacity(0.9) : Color.black.opacity(0.6))
            .foregroundStyle(.white)
            .clipShape(Capsule())
    }

    // MARK: Repaso

    private var repaso: some View {
        VStack(spacing: 0) {
            MapReader { proxy in
                Map(initialPosition: .automatic) {
                    MapPolyline(coordinates: modelo.coordenadas).stroke(Theme.sky500, lineWidth: 4)
                    ForEach(modelo.colocadas) { f in
                        if let s = f.sitio {
                            Annotation("", coordinate: CLLocationCoordinate2D(latitude: s.lat, longitude: s.lon)) {
                                Image(uiImage: f.miniatura)
                                    .resizable().scaledToFill()
                                    .frame(width: 40, height: 40)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                    .overlay(RoundedRectangle(cornerRadius: 8)
                                        .stroke(modelo.seleccionada == f.id ? Theme.sky500 : .white, lineWidth: modelo.seleccionada == f.id ? 3 : 2))
                                    .shadow(radius: 3)
                                    .onTapGesture { modelo.seleccionada = f.id }
                            }
                        }
                    }
                }
                .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
                .onTapGesture { p in
                    guard modelo.fase == .repaso, let id = modelo.seleccionada,
                          let c = proxy.convert(p, from: .local) else { return }
                    modelo.mueve(id, a: c)
                }
            }
            panelDeRepaso
        }
    }

    private var panelDeRepaso: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(modelo.fotos) { f in
                        Image(uiImage: f.miniatura)
                            .resizable().scaledToFill()
                            .frame(width: 58, height: 58)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8)
                                .stroke(modelo.seleccionada == f.id ? Theme.sky500 : .clear, lineWidth: 3))
                            .overlay(alignment: .bottomTrailing) {
                                if f.sitio == nil {
                                    Image(systemName: "questionmark.circle.fill").foregroundStyle(.white, .orange)
                                        .symbolRenderingMode(.palette).padding(2)
                                } else if modelo.subidas.contains(f.id) {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.white, .green)
                                        .symbolRenderingMode(.palette).padding(2)
                                }
                            }
                            .onTapGesture { modelo.seleccionada = f.id }
                    }
                }
                .padding(.horizontal, 16)
            }
            .padding(.top, 12)

            Group {
                if let id = modelo.seleccionada, let f = modelo.fotos.first(where: { $0.id == id }) {
                    HStack {
                        Text(descripcion(f)).font(.footnote).foregroundStyle(Theme.slate400)
                        Spacer()
                        Button("Quitar", role: .destructive) { modelo.quita(f.id) }.font(.footnote)
                            .disabled(modelo.fase == .subiendo)
                    }
                } else {
                    Text("Toca una foto y luego el mapa para cambiarla de sitio.")
                        .font(.footnote).foregroundStyle(Theme.slate400)
                }
                if !modelo.sesion.isPinned {
                    Toggle("Fijar la salida para que no caduque", isOn: $modelo.fijar)
                        .font(.footnote).foregroundStyle(Theme.slate100)
                }
                if let e = modelo.error {
                    Text(e).font(.footnote).foregroundStyle(Theme.rose300)
                }
                if modelo.fase == .subiendo {
                    ProgressView(value: Double(modelo.subidas.count), total: Double(max(1, modelo.colocadas.count))) {
                        Text("Subiendo \(min(modelo.subidas.count + 1, modelo.colocadas.count)) de \(modelo.colocadas.count)…")
                            .font(.footnote).foregroundStyle(Theme.slate100)
                    }
                } else {
                    Button {
                        Task { await modelo.sube() }
                    } label: {
                        Text(textoSubir).fontWeight(.semibold).frame(maxWidth: .infinity).padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(modelo.colocadas.isEmpty)
                    .accessibilityIdentifier("subirFotos")
                    if !modelo.sinSitio.isEmpty {
                        Text("\(modelo.sinSitio.count) sin sitio: toca en el mapa dónde va, o no se subirá\(modelo.sinSitio.count == 1 ? "" : "n").")
                            .font(.caption).foregroundStyle(.orange)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.bottom, 12)
        .background(Theme.slate900)
    }

    private var textoSubir: String {
        let n = modelo.colocadas.count - modelo.subidas.count
        let tam = ByteCountFormatter.string(fromByteCount: Int64(modelo.bytes), countStyle: .file)
        return "Subir \(n == 1 ? "1 foto" : "\(n) fotos") · \(tam)"
    }

    private func descripcion(_ f: FotosEnRutaModelo.Foto) -> String {
        guard let s = f.sitio else { return "Sin sitio: toca el mapa donde la hiciste." }
        let km = (s.distM / 1000).formatted(.number.precision(.fractionLength(1)))
        switch s.modo {
        case .porHora: return "\(Self.hora(f.fecha)) · km \(km) · por la hora"
        case .porGPS: return "km \(km) · por el GPS de la foto"
        case .aMano: return "km \(km) · puesta a mano"
        }
    }

    // MARK: Hecho

    private var hecho: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 54)).foregroundStyle(.green)
            Text(modelo.subidas.count == 1 ? "Foto añadida" : "\(modelo.subidas.count) fotos añadidas")
                .font(.title3.weight(.semibold)).foregroundStyle(Theme.slate100)
            Text("Se ven en el mapa de la salida, cada una en su sitio del recorrido.")
                .font(.footnote).foregroundStyle(Theme.slate400).multilineTextAlignment(.center)
        }
        .padding(30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/**
 Elegir entre las fotos del carrete hechas durante la salida: en una salida
 larga son fácilmente cien, y al mapa van unas pocas. Agrupadas por hora, que
 es como se recuerda una ruta («las del mirador, sobre las cuatro»); mantener
 pulsada una la enseña en grande.
 */
private struct ElegirDeLaRuta: View {
    @ObservedObject var modelo: FotosEnRutaModelo
    let alAnadir: () -> Void

    private var grupos: [(hora: String, fotos: [PHAsset])] {
        let f = DateFormatter()
        f.dateFormat = "HH:00"
        var orden: [String] = []
        var por: [String: [PHAsset]] = [:]
        for a in modelo.halladas ?? [] {
            let h = a.creationDate.map { f.string(from: $0) } ?? "?"
            if por[h] == nil { orden.append(h) }
            por[h, default: []].append(a)
        }
        return orden.map { ($0, por[$0] ?? []) }
    }

    var body: some View {
        let n = modelo.elegidasDeLaRuta.count
        let total = modelo.halladas?.count ?? 0
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 4), spacing: 3,
                      pinnedViews: [.sectionHeaders]) {
                ForEach(grupos, id: \.hora) { g in
                    Section {
                        ForEach(g.fotos, id: \.localIdentifier) { a in celda(a) }
                    } header: {
                        Text(g.hora)
                            .font(.caption.weight(.bold)).foregroundStyle(Theme.slate100)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(Theme.slate950.opacity(0.95))
                    }
                }
            }
        }
        .background(Theme.slate950)
        .navigationTitle(n == 0 ? "Elige las de la ruta" : "\(n) elegida\(n == 1 ? "" : "s")")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(n == 0 ? "Todas" : "Ninguna") { modelo.eligeTodasLasHalladas(n == 0) }
            }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 6) {
                if n >= modelo.huecos && total > n {
                    Text("Caben \(FotosEnRutaModelo.tope) por vez; el resto, en otra tanda.")
                        .font(.caption).foregroundStyle(.orange)
                }
                Button(action: alAnadir) {
                    Text(n == 0 ? "Toca las que quieras" : "Añadir \(n == 1 ? "1 foto" : "\(n) fotos")")
                        .fontWeight(.semibold).frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(n == 0)
                .accessibilityIdentifier("anadirElegidas")
            }
            .padding(16)
            .background(Theme.slate950)
        }
    }

    private func celda(_ a: PHAsset) -> some View {
        let elegida = modelo.elegidasDeLaRuta.contains(a.localIdentifier)
        // Ya en la salida: apagada y dicho, pero se puede elegir igual (el
        // reconocimiento de las hechas en marcha es por cercanía, y puede fallar).
        let yaEsta = modelo.yaEstan.contains(a.localIdentifier) && !elegida
        return MiniaturaDeAsset(asset: a)
            .frame(minWidth: 0, maxWidth: .infinity).aspectRatio(1, contentMode: .fit)
            .clipped()
            .opacity(yaEsta ? 0.4 : 1)
            .overlay {
                if yaEsta {
                    Label("Ya está", systemImage: "checkmark")
                        .font(.caption2.weight(.bold)).foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Color.green.opacity(0.85)).clipShape(Capsule())
                }
            }
            .overlay(elegida ? Theme.sky500.opacity(0.18) : .clear)
            .overlay(RoundedRectangle(cornerRadius: 2).stroke(elegida ? Theme.sky500 : .clear, lineWidth: 3))
            .overlay(alignment: .topTrailing) {
                Image(systemName: elegida ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, elegida ? Theme.sky500 : .black.opacity(0.25))
                    .padding(5)
            }
            .overlay(alignment: .bottomLeading) {
                if let d = a.creationDate {
                    Text(d.formatted(date: .omitted, time: .shortened))
                        .font(.caption2.weight(.semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(.black.opacity(0.5)).clipShape(Capsule())
                        .padding(4)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { modelo.alternaHallada(a.localIdentifier) }
            .contextMenu {
                Button(elegida ? "Quitar" : "Elegir") { modelo.alternaHallada(a.localIdentifier) }
            } preview: {
                MiniaturaDeAsset(asset: a, lado: 700).frame(width: 340, height: 340)
            }
            .accessibilityElement()
            .accessibilityLabel((a.creationDate?.formatted(date: .omitted, time: .shortened) ?? "Foto")
                                + (modelo.yaEstan.contains(a.localIdentifier) ? ", ya está" : ""))
            .accessibilityAddTraits(elegida ? [.isButton, .isSelected] : .isButton)
            .accessibilityIdentifier("hallada")
    }
}

/// La miniatura de una foto de la fototeca, pedida a su tamaño.
private struct MiniaturaDeAsset: View {
    let asset: PHAsset
    var lado: CGFloat = 240
    @State private var imagen: UIImage?

    var body: some View {
        ZStack {
            Theme.slate800
            if let imagen { Image(uiImage: imagen).resizable().scaledToFill() }
        }
        .task(id: asset.localIdentifier) {
            imagen = await withCheckedContinuation { c in
                let o = PHImageRequestOptions()
                o.deliveryMode = .highQualityFormat   // una sola respuesta
                o.resizeMode = .fast
                o.isNetworkAccessAllowed = true
                PHImageManager.default().requestImage(
                    for: asset, targetSize: CGSize(width: lado, height: lado),
                    contentMode: .aspectFill, options: o
                ) { img, _ in c.resume(returning: img) }
            }
        }
    }
}
