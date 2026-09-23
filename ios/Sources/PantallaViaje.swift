import MapKit
import SwiftUI

/**
 Buscar un sitio por su nombre —una ciudad, un aeropuerto— con el buscador de
 Mapas, y quedarse con sus coordenadas.
 */
@MainActor
final class BuscadorDeLugares: NSObject, ObservableObject, MKLocalSearchCompleterDelegate {
    @Published var texto = "" { didSet { completador.queryFragment = texto } }
    @Published private(set) var resultados: [MKLocalSearchCompletion] = []

    private let completador = MKLocalSearchCompleter()

    override init() {
        super.init()
        completador.delegate = self
        completador.resultTypes = [.address, .pointOfInterest]
    }

    nonisolated func completerDidUpdateResults(_ c: MKLocalSearchCompleter) {
        let r = Array(c.results.prefix(6))
        Task { @MainActor in self.resultados = r }
    }

    nonisolated func completer(_ c: MKLocalSearchCompleter, didFailWithError error: Error) {
        Task { @MainActor in self.resultados = [] }
    }

    /// De una sugerencia a un sitio con coordenadas, y con una abreviatura
    /// propuesta que luego se puede cambiar.
    func elige(_ s: MKLocalSearchCompletion) async -> LugarDeViaje? {
        let busqueda = MKLocalSearch(request: MKLocalSearch.Request(completion: s))
        guard let item = try? await busqueda.start().mapItems.first else { return nil }
        let c = item.placemark.coordinate
        let esAeropuerto = item.pointOfInterestCategory == .airport
        // Un aeropuerto, por su nombre: su localidad es el pueblo donde está
        // («Prat de Llobregat»), no la ciudad a la que se va. Y sin abreviatura
        // propuesta: Mapas no da el código (BCN), y las tres primeras letras
        // saldrían «AER». Se deja vacía para que se escriba.
        // Una ciudad, por el nombre corto: «Barcelona», no «Barcelona, España».
        let nombre = esAeropuerto
            ? (item.name ?? s.title)
            : (item.placemark.locality ?? item.name ?? s.title)
        return LugarDeViaje(nombre: nombre,
                            abreviatura: esAeropuerto ? "" : Self.abreviatura(de: nombre),
                            latitud: c.latitude, longitud: c.longitude)
    }

    /// Las tres primeras letras, en mayúsculas y sin tildes: «Málaga» → «MAL».
    /// Es solo una propuesta: para un vuelo, lo suyo es poner el código del
    /// aeropuerto (AGP).
    nonisolated static func abreviatura(de nombre: String) -> String {
        let letras = nombre.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .filter(\.isLetter)
        return String(letras.prefix(3)).uppercased()
    }
}

/// Un extremo del viaje: buscarlo, y una vez elegido, su abreviatura.
private struct CampoDeLugar: View {
    let etiqueta: String
    @Binding var lugar: LugarDeViaje?
    /// Abrir el mapa lo hace la pantalla, no el campo (ver `PantallaViaje`).
    let abreMapa: () -> Void
    @StateObject private var buscador = BuscadorDeLugares()
    @State private var buscando = false

    var body: some View {
        campo
            // Llega un punto nuevo —del mapa— mientras se buscaba: se deja
            // de buscar y se enseña el elegido.
            .onChange(of: lugar) { _, _ in buscando = false }
    }

    @ViewBuilder
    private var campo: some View {
        if let l = lugar, !buscando {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    // Editable: lo que sale debajo del código en la tarjeta.
                    // De un aeropuerto sale su nombre entero, y quizá se
                    // prefiere la ciudad.
                    TextField("Nombre", text: Binding(
                        get: { l.nombre },
                        set: { lugar?.nombre = $0 }
                    ))
                    .font(.body.weight(.semibold))
                    Text(String(format: "%.3f, %.3f", l.latitud, l.longitud))
                        .font(.caption2.monospaced()).foregroundStyle(Theme.slate400)
                }
                Spacer()
                // La abreviatura, que es lo que va en grande en la tarjeta.
                TextField("ABC", text: Binding(
                    get: { l.abreviatura },
                    set: { lugar?.abreviatura = String($0.uppercased().prefix(4)) }
                ))
                .font(.system(size: 20, weight: .heavy))
                .multilineTextAlignment(.center)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .frame(width: 80)
                .padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.slate800))
            }
            HStack {
                Button("Cambiar \(etiqueta.lowercased())") {
                    buscador.texto = ""
                    buscando = true
                }
                Spacer()
                // El punto que da el buscador es el centro del sitio; aquí se
                // afina: una terminal, una calle, la puerta de casa.
                Button(action: abreMapa) {
                    Label("Afinar en el mapa", systemImage: "scope")
                }
            }
            .font(.footnote)
            .buttonStyle(.borderless)
        } else {
            TextField("Ciudad, o «Aeropuerto de …»", text: $buscador.texto)
                .autocorrectionDisabled()
            Button(action: abreMapa) {
                Label("Elegir el punto exacto en el mapa", systemImage: "map")
                    .font(.footnote)
            }
            .buttonStyle(.borderless)
            ForEach(buscador.resultados, id: \.self) { r in
                Button {
                    Task {
                        if let l = await buscador.elige(r) {
                            lugar = l
                            buscando = false
                        }
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(r.title).foregroundStyle(Theme.slate100)
                        if !r.subtitle.isEmpty {
                            Text(r.subtitle).font(.caption).foregroundStyle(Theme.slate400)
                        }
                    }
                }
            }
            if lugar != nil {
                Button("Dejarlo como estaba") { buscando = false }.font(.footnote)
            }
        }
    }
}

/// Qué extremo se está eligiendo en el mapa.
private enum ExtremoDelViaje: String, Identifiable {
    case origen, destino
    var id: String { rawValue }
}

/// Una fila de muestras de color y el selector libre, como en las cuentas atrás.
private struct FilaDeColores: View {
    let muestras: [String]
    @Binding var elegido: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(muestras, id: \.self) { hex in
                    Button { elegido = hex } label: {
                        Circle()
                            .fill(Color(hexContador: hex))
                            .overlay(Circle().stroke(Color.white.opacity(0.25), lineWidth: 1))
                            .frame(width: 28, height: 28)
                            // El elegido, con un aro POR FUERA: pegado al borde
                            // no se veía en los colores claros.
                            .padding(4)
                            .overlay(Circle().stroke(.white,
                                lineWidth: elegido.lowercased() == hex.lowercased() ? 2 : 0))
                    }
                    .buttonStyle(.plain)
                }
                ColorPicker("Otro", selection: Binding(
                    get: { Color(hexContador: elegido) },
                    set: { elegido = ColoresContador.hex(de: $0) }
                ), supportsOpacity: false)
                .labelsHidden()
                .padding(.leading, 4)
            }
            .padding(.vertical, 4)
        }
    }
}

/**
 Configurar un VIAJE EN DIRECTO: de dónde a dónde, cómo se va, cómo se ve y
 cuándo empieza.

 Arriba, la tarjeta tal como va a salir en la pantalla de bloqueo, que cambia
 mientras se toca: se elige mirando, no leyendo nombres de colores.
 */
struct PantallaViaje: View {
    @ObservedObject private var viaje = ViajeEnDirecto.shared

    @State private var titulo = ""
    @State private var origen: LugarDeViaje?
    @State private var destino: LugarDeViaje?
    @State private var transporte: TransporteDeViaje = .avion
    @State private var colores = ColoresDeViaje.porDefecto
    @State private var conHora = false
    @State private var hora = Date().addingTimeInterval(3600)
    /// Hasta haber leído lo guardado no se guarda nada: si no, el primer
    /// cambio de estado —la carga misma— podía pisar lo guardado con vacío.
    @State private var cargado = false
    /// Por dónde va la simulación de la vista previa: empieza a un tercio del
    /// camino, que es donde mejor se ve el trayecto.
    @State private var simulado = 0.35
    /// El extremo que se está eligiendo en el mapa, si se está.
    @State private var mapaPara: ExtremoDelViaje?

    /// Fondos oscuros que casan con la pantalla de bloqueo, y un par de claros.
    private let fondos = ["#0f1729", "#000000", "#1e1b4b", "#052e16", "#450a0a", "#3b0764", "#f8fafc", "#fef3c7"]

    var body: some View {
        List {
            Section {
                vistaPrevia
                    .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                if !viaje.enMarcha {
                    simulacion
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
            } header: {
                Text("EN LA PANTALLA DE BLOQUEO").font(.caption).foregroundStyle(Theme.slate400)
            }

            if viaje.enMarcha {
                enMarcha
            } else {
                formulario
            }
        }
        .navigationTitle("Viaje en directo")
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .background(Theme.slate950)
        // El mapa cuelga de la LISTA y no del campo: colgado de una fila, se
        // abría y se cerraba al instante, porque al ponerse a buscar la fila
        // cambia y SwiftUI la rehace, llevándose lo que colgaba de ella.
        .sheet(item: $mapaPara) { extremo in
            SelectorEnMapa(inicial: extremo == .origen ? origen : destino) { l in
                if extremo == .origen { origen = l } else { destino = l }
            }
        }
        .onAppear(perform: carga)
        // Lo que se va eligiendo se guarda al momento: la pantalla se cierra en
        // cuanto se vuelve atrás, y con el estado solo en memoria, al volver a
        // entrar estaba todo vacío.
        .onChange(of: borrador) { _, nuevo in
            if cargado { nuevo.guarda() }
        }
        .alert("Viaje en directo", isPresented: Binding(
            get: { viaje.error != nil }, set: { if !$0 { viaje.error = nil } }
        )) {
            Button("Aceptar", role: .cancel) { viaje.error = nil }
        } message: {
            Text(viaje.error ?? "")
        }
    }

    // MARK: Vista previa

    /// Lo que se está configurando, o el viaje en marcha tal como va.
    private var datosDeMuestra: DatosDeViaje? {
        if let a = viaje.actividad?.attributes, let e = viaje.estado {
            return DatosDeViaje(titulo: a.titulo, origen: a.origen, destino: a.destino,
                                transporte: a.transporte, colores: a.colores,
                                restanteKm: e.restanteKm, progreso: e.progreso,
                                llegada: e.llegada, llegado: e.llegado, actualizado: e.actualizado)
        }
        let o = origen ?? LugarDeViaje(nombre: "Origen", abreviatura: "ORI", latitud: 41.39, longitud: 2.17)
        let d = destino ?? LugarDeViaje(nombre: "Destino", abreviatura: "DES", latitud: 35.68, longitud: 139.69)
        let total = Trayecto.km(o.coordenada, d.coordenada)
        // Donde diga el deslizador de la simulación (ver `simulacion`), con los
        // km que de verdad faltarían desde ahí: la distancia real entre los dos
        // puntos, no un número de muestra.
        return DatosDeViaje(titulo: titulo, origen: o, destino: d, transporte: transporte,
                            colores: colores, restanteKm: total * (1 - simulado),
                            // Llegado desde el 99 %: con el dedo, el deslizador
                            // casi nunca se queda en el 100 % exacto.
                            progreso: simulado, llegado: simulado >= 0.99)
    }

    /// Mover la vista previa por todo el recorrido, para ver cómo va a quedar
    /// en cada punto: la salida, lo alto del arco, la llegada. Solo mientras se
    /// configura; con el viaje en marcha la vista previa es la de verdad.
    private var simulacion: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Image(systemName: transporte.simbolo)
                    .scaleEffect(x: transporte.miraALaIzquierda ? -1 : 1)
                    .foregroundStyle(Theme.slate400)
                Slider(value: $simulado, in: 0...1)
                    .accessibilityIdentifier("simulacionDelRecorrido")
                Image(systemName: "flag.checkered")
                    .foregroundStyle(Theme.slate400)
            }
            Text("Simulación del recorrido: no es tu posición. Los km son los reales desde ese punto.")
                .font(.caption2)
                .foregroundStyle(Theme.slate400)
        }
    }

    @ViewBuilder
    private var vistaPrevia: some View {
        if let d = datosDeMuestra {
            TarjetaDelViaje(datos: d)
                .background(Color(hexContador: d.colores.fondo))
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
    }

    // MARK: Formulario

    @ViewBuilder
    private var formulario: some View {
        Section {
            TextField("Viaje a Japón", text: $titulo)
        } header: {
            Text("TÍTULO").font(.caption).foregroundStyle(Theme.slate400)
        } footer: {
            Text("Opcional. Sale encima, en una línea.").font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)

        Section {
            CampoDeLugar(etiqueta: "Origen", lugar: $origen) { mapaPara = .origen }
        } header: {
            Text("ORIGEN").font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)

        Section {
            CampoDeLugar(etiqueta: "Destino", lugar: $destino) { mapaPara = .destino }
        } header: {
            Text("DESTINO").font(.caption).foregroundStyle(Theme.slate400)
        } footer: {
            Text("Para un vuelo, elige el AEROPUERTO, no la ciudad: el viaje se da por llegado a 2 km del punto elegido, y el centro de una ciudad puede estar a decenas de kilómetros del aeropuerto. Búscalo por su nombre («Aeropuerto de Barcelona»); por el código (BCN) Mapas no lo encuentra. El código se escribe después, en el recuadro: es lo que sale en grande.")
                .font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)

        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(TransporteDeViaje.allCases, id: \.self) { t in
                        Button { transporte = t } label: {
                            VStack(spacing: 4) {
                                Image(systemName: t.simbolo)
                                    .font(.system(size: 18, weight: .semibold))
                                    .scaleEffect(x: t.miraALaIzquierda ? -1 : 1)
                                    .frame(width: 44, height: 36)
                                    .background(RoundedRectangle(cornerRadius: 10)
                                        .fill(transporte == t ? Theme.sky600 : Theme.slate800))
                                Text(t.nombre).font(.caption2)
                                    .foregroundStyle(transporte == t ? Theme.slate100 : Theme.slate400)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text("CÓMO SE VA").font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)

        Section {
            VStack(alignment: .leading, spacing: 4) {
                Text("Fondo").font(.subheadline)
                FilaDeColores(muestras: fondos, elegido: $colores.fondo)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Trayecto").font(.subheadline)
                FilaDeColores(muestras: ["#0284c7"] + ColoresContador.paleta, elegido: $colores.trayecto)
                // El degradado: un color en cada punta de lo recorrido.
                HStack(spacing: 10) {
                    ColorPicker("Inicio", selection: Binding(
                        get: { Color(hexContador: colores.trayecto) },
                        set: { colores.trayecto = ColoresContador.hex(de: $0) }
                    ), supportsOpacity: false).labelsHidden()
                    Capsule()
                        .fill(LinearGradient(
                            colors: [Color(hexContador: colores.trayecto),
                                     Color(hexContador: colores.trayecto2 ?? colores.trayecto)],
                            startPoint: .leading, endPoint: .trailing))
                        .frame(height: 8)
                    ColorPicker("Fin", selection: Binding(
                        get: { Color(hexContador: colores.trayecto2 ?? colores.trayecto) },
                        set: { colores.trayecto2 = ColoresContador.hex(de: $0) }
                    ), supportsOpacity: false).labelsHidden()
                }
                HStack {
                    if colores.trayecto2 != nil {
                        Button("Un solo color") { colores.trayecto2 = nil }
                    }
                    Spacer()
                    if colores != .porDefecto {
                        Button("Los de siempre") { colores = .porDefecto }
                    }
                }
                .font(.footnote)
                .buttonStyle(.borderless)
            }
        } header: {
            Text("COLORES").font(.caption).foregroundStyle(Theme.slate400)
        } footer: {
            Text("El texto se pone solo, claro u oscuro según el fondo. En la Isla Dinámica el fondo es siempre negro: ahí manda el color del trayecto.")
                .font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)

        Section {
            Toggle("Avisarme a la hora de salida", isOn: $conHora)
            if conHora {
                DatePicker("Salida", selection: $hora, in: Date()...)
            }
            if let p = viaje.programado {
                HStack {
                    Label {
                        Text("Aviso para las ") + Text(p.hora, format: .dateTime.weekday().day().month().hour().minute())
                    } icon: { Image(systemName: "bell.fill") }
                    .font(.footnote)
                    Spacer()
                    Button("Quitar", role: .destructive) { viaje.cancelaElProgramado() }
                        .font(.footnote).buttonStyle(.borderless)
                }
            }
        } header: {
            Text("CUÁNDO").font(.caption).foregroundStyle(Theme.slate400)
        } footer: {
            Text("Apple no deja que empiece sola: a esa hora te llega un aviso y, al tocarlo, empieza. También puedes empezar ahora y cerrar la app: sigue avanzando con el GPS.")
                .font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)

        Section {
            if conHora {
                Button {
                    guard let a = atributos else { return }
                    Task { await viaje.programa(a, a: hora) }
                } label: {
                    Label("Programar el aviso", systemImage: "bell.badge")
                        .frame(maxWidth: .infinity)
                }
                .disabled(atributos == nil)
            }
            Button {
                if let a = atributos { viaje.empieza(a) }
            } label: {
                Label("Empezar ahora", systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
                    .font(.headline)
            }
            .disabled(atributos == nil)
        } footer: {
            if origen == nil || destino == nil {
                Text("Elige el origen y el destino para poder empezar.")
                    .font(.caption).foregroundStyle(Theme.slate400)
            } else if atributos == nil {
                // Pasa con los aeropuertos: su código no lo da Mapas.
                Text("Falta el código de algún extremo (el recuadro de al lado del nombre): es lo que sale en grande.")
                    .font(.caption).foregroundStyle(Theme.amber200)
            }
        }
        .listRowBackground(Theme.slate900)
    }

    private var enMarcha: some View {
        Section {
            if let e = viaje.estado {
                LabeledContent("Quedan", value: "\(ColoresViaje.km(e.restanteKm)) km")
                LabeledContent("Hecho", value: e.progreso.formatted(.percent.precision(.fractionLength(0))))
                LabeledContent("Última posición") {
                    Text(e.actualizado, style: .time)
                }
            }
            gps
            Button(role: .destructive) { viaje.termina() } label: {
                Label("Terminar el viaje", systemImage: "stop.fill")
                    .frame(maxWidth: .infinity)
                    // Todo en rojo: con el papel de «destructivo» el texto salía
                    // rojo pero el icono cogía el azul de la app.
                    .foregroundStyle(.red)
            }
        } header: {
            Text("EN MARCHA").font(.caption).foregroundStyle(Theme.slate400)
        } footer: {
            Text("Puedes cerrar la app: la tarjeta sigue avanzando con el GPS. Al llegar a destino se marca sola y se quita al rato.")
                .font(.caption).foregroundStyle(Theme.slate400)
        }
        .listRowBackground(Theme.slate900)
    }

    /// Qué está pasando con el GPS: el permiso, si es exacto, y cuántas
    /// posiciones llegan. En un viaje que no avanzaba no había forma de saber
    /// por qué; así se ve en la propia pantalla.
    @ViewBuilder
    private var gps: some View {
        let d = viaje.diagnostico
        LabeledContent("Ubicación") {
            Text(nombreDelPermiso + (viaje.exacta ? ", exacta" : ", aproximada"))
                .foregroundStyle(permisoMalo || !viaje.exacta ? Color.orange : Theme.slate400)
        }
        LabeledContent("Posiciones del GPS") {
            Text(d.descartadas > 0 ? "\(d.recibidas) buenas · \(d.descartadas) con mucho error"
                                   : "\(d.recibidas)")
                .monospacedDigit()
        }
        if let cuando = d.ultimaRecibida {
            LabeledContent("La última") {
                (Text(cuando, style: .time)
                 + Text(d.ultimoError.map { " · ±\(Int($0)) m" } ?? ""))
                    .monospacedDigit()
            }
        }
        if let e = d.encendido {
            LabeledContent("GPS encendido") { Text(e, style: .time).monospacedDigit() }
        }
        if let f = d.ultimoFallo {
            LabeledContent("Último fallo") {
                (Text(f) + Text(d.ultimoFalloA.map { " · " + $0.formatted(date: .omitted, time: .shortened) } ?? ""))
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.trailing)
            }
        }
        Button {
            viaje.pidePosicionAhora()
        } label: {
            Label("Pedir posición ahora", systemImage: "location.fill.viewfinder")
        }
        .font(.footnote)
        if permisoMalo || !viaje.exacta {
            Button {
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            } label: {
                Label(permisoMalo ? "Permitir la ubicación en Ajustes" : "Activar la ubicación exacta en Ajustes",
                      systemImage: "location.circle")
            }
            .font(.footnote)
        }
    }

    private var permisoMalo: Bool {
        viaje.permiso == .denied || viaje.permiso == .restricted || viaje.permiso == .notDetermined
    }

    private var nombreDelPermiso: String {
        switch viaje.permiso {
        case .authorizedAlways: return "Siempre"
        case .authorizedWhenInUse: return "Mientras se usa"
        case .denied: return "Denegada"
        case .restricted: return "Restringida"
        default: return "Sin decidir"
        }
    }

    /// Lo que se arranca, si ya está todo lo necesario.
    private var atributos: ViajeAtributos? {
        guard let o = origen, let d = destino,
              !o.abreviatura.isEmpty, !d.abreviatura.isEmpty else { return nil }
        let t = titulo.trimmingCharacters(in: .whitespaces)
        return ViajeAtributos(titulo: t.isEmpty ? nil : t, origen: o, destino: d,
                              transporte: transporte, colores: colores)
    }

    /// Lo que hay en pantalla, para guardarlo.
    private var borrador: BorradorDeViaje {
        BorradorDeViaje(titulo: titulo, origen: origen, destino: destino, transporte: transporte,
                        colores: colores, conHora: conHora, hora: hora)
    }

    /// Al entrar: lo que se dejó la última vez. Si hay un viaje programado,
    /// manda ese, que es el que va a salir.
    private func carga() {
        guard !cargado else { return }
        defer { cargado = true }
        if let p = viaje.programado {
            titulo = p.atributos.titulo ?? ""
            origen = p.atributos.origen
            destino = p.atributos.destino
            transporte = p.atributos.transporte
            colores = p.atributos.colores
            conHora = true
            hora = p.hora
        } else if let b = BorradorDeViaje.lee() {
            titulo = b.titulo
            origen = b.origen
            destino = b.destino
            transporte = b.transporte
            colores = b.colores
            conHora = b.conHora
            // Una hora que ya pasó no se puede elegir: se propone dentro de una.
            hora = b.hora > Date() ? b.hora : Date().addingTimeInterval(3600)
        }
    }
}

/**
 Lo último que se configuró en la pantalla del viaje, guardado en el móvil para
 encontrarlo igual al volver.

 Aparte de la pantalla para poder probar que se guarda y se lee: sin esto, al
 volver a la pantalla principal y entrar otra vez, todo estaba vacío.
 */
struct BorradorDeViaje: Codable, Equatable {
    var titulo: String
    var origen: LugarDeViaje?
    var destino: LugarDeViaje?
    var transporte: TransporteDeViaje
    var colores: ColoresDeViaje
    var conHora: Bool
    var hora: Date

    static let clave = "viaje.borrador"

    func guarda(en d: UserDefaults = .standard) {
        guard let datos = try? JSONEncoder().encode(self) else { return }
        d.set(datos, forKey: Self.clave)
    }

    static func lee(de d: UserDefaults = .standard) -> BorradorDeViaje? {
        guard let datos = d.data(forKey: clave) else { return nil }
        return try? JSONDecoder().decode(BorradorDeViaje.self, from: datos)
    }
}
