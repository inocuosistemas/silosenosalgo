import CoreLocation
import MapKit
import SwiftUI

/**
 Elegir el punto EXACTO de un extremo del viaje en un mapa: se mueve el mapa
 bajo una cruz fija en el centro, y lo que queda debajo de la cruz es el punto.

 Hace falta porque el buscador da un punto por sitio —el centro de la ciudad,
 el del aeropuerto— y a veces se quiere otro: una terminal concreta, la casa de
 destino, la salida de una carrera. Y el viaje se da por llegado a una distancia
 de ESE punto, así que cuanto más fino, mejor.

 Arriba, el mismo buscador de la pantalla del viaje, para llegar rápido a la
 zona; después se afina a mano.
 */
struct SelectorEnMapa: View {
    /// Lo que había, si había: se empieza ahí y se conserva su abreviatura.
    let inicial: LugarDeViaje?
    let alElegir: (LugarDeViaje) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var buscador = BuscadorDeLugares()
    @State private var posicion: MapCameraPosition
    @State private var centro: CLLocationCoordinate2D
    @State private var nombre: String?
    @State private var buscandoNombre = false
    /// El próximo movimiento del mapa no lo ha hecho el dedo —es el de abrir,
    /// o el salto a un resultado del buscador— y el nombre que ya hay es mejor
    /// que el que se deduce del punto: «Aeropuerto de Barcelona-El Prat» se
    /// convertía en «El Prat de Llobregat».
    @State private var respetaNombre = true
    @FocusState private var escribiendo: Bool

    init(inicial: LugarDeViaje?, alElegir: @escaping (LugarDeViaje) -> Void) {
        self.inicial = inicial
        self.alElegir = alElegir
        // Donde estaba el punto, cerca; si no había, en el mapa entero de
        // España, que es desde donde se sale casi siempre.
        let c = inicial?.coordenada ?? CLLocationCoordinate2D(latitude: 40.2, longitude: -3.7)
        let zoom = inicial == nil ? 8.0 : 0.05
        _centro = State(initialValue: c)
        _nombre = State(initialValue: inicial?.nombre)
        _posicion = State(initialValue: .region(MKCoordinateRegion(
            center: c, span: MKCoordinateSpan(latitudeDelta: zoom, longitudeDelta: zoom))))
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                Map(position: $posicion) {
                    UserAnnotation()
                }
                .mapControls {
                    MapUserLocationButton()
                    MapCompass()
                    MapScaleView()
                }
                // Los botones del mapa, por debajo del buscador: arriba a la
                // derecha, el de «mi ubicación» quedaba tapado por él.
                .safeAreaPadding(.top, 60)
                .onMapCameraChange(frequency: .onEnd) { ctx in
                    centro = ctx.region.center
                    if respetaNombre {
                        respetaNombre = false
                    } else {
                        Task { await ponNombre() }
                    }
                }
                // La cruz, fija en el centro: el punto es lo que queda debajo.
                .overlay {
                    Image(systemName: "plus")
                        .font(.system(size: 26, weight: .light))
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.8), radius: 2)
                        .allowsHitTesting(false)
                }
                .ignoresSafeArea(edges: .bottom)

                buscadorArriba
            }
            .safeAreaInset(edge: .bottom) { pie }
            .navigationTitle("Punto exacto")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
            }
        }
    }

    /// El buscador, flotando sobre el mapa, con sus sugerencias debajo.
    private var buscadorArriba: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.slate400)
                TextField("Ciudad, o «Aeropuerto de …»", text: $buscador.texto)
                    .autocorrectionDisabled()
                    .focused($escribiendo)
                    .accessibilityIdentifier("buscadorDelMapa")
                if !buscador.texto.isEmpty {
                    Button { buscador.texto = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.slate400)
                    }
                }
            }
            .padding(10)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
            if escribiendo && !buscador.resultados.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(buscador.resultados, id: \.self) { r in
                        Button {
                            Task { await ve(a: r) }
                        } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(r.title).foregroundStyle(Theme.slate100)
                                if !r.subtitle.isEmpty {
                                    Text(r.subtitle).font(.caption).foregroundStyle(Theme.slate400)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                        Divider().opacity(0.3)
                    }
                }
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                .padding(.top, 4)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    /// Qué hay debajo de la cruz, y el botón para quedárselo.
    private var pie: some View {
        VStack(spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(nombre ?? (buscandoNombre ? "Buscando…" : "Punto elegido"))
                        .font(.body.weight(.semibold))
                        .lineLimit(1)
                    Text(String(format: "%.5f, %.5f", centro.latitude, centro.longitude))
                        .font(.caption.monospaced())
                        .foregroundStyle(Theme.slate400)
                        .accessibilityIdentifier("coordenadasDelMapa")
                }
                Spacer()
            }
            Button {
                alElegir(lugar)
                dismiss()
            } label: {
                Label("Usar este punto", systemImage: "mappin.and.ellipse")
                    .frame(maxWidth: .infinity)
                    .font(.headline)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("usarEstePunto")
        }
        .padding(14)
        .background(.ultraThinMaterial)
    }

    /// Lo elegido. Si se estaba afinando uno que ya tenía abreviatura, se
    /// queda la suya: lo que se mueve es el punto, no el nombre del sitio.
    private var lugar: LugarDeViaje {
        let n = nombre ?? inicial?.nombre ?? "Punto elegido"
        let abreviatura = inicial?.abreviatura.isEmpty == false
            ? inicial!.abreviatura : BuscadorDeLugares.abreviatura(de: n)
        return LugarDeViaje(nombre: n, abreviatura: abreviatura,
                            latitud: centro.latitude, longitud: centro.longitude)
    }

    /// Llevar el mapa a una sugerencia del buscador, de cerca.
    private func ve(a s: MKLocalSearchCompletion) async {
        guard let l = await buscador.elige(s) else { return }
        escribiendo = false
        buscador.texto = ""
        centro = l.coordenada
        nombre = l.nombre
        respetaNombre = true
        withAnimation {
            posicion = .region(MKCoordinateRegion(
                center: l.coordenada, span: MKCoordinateSpan(latitudeDelta: 0.03, longitudeDelta: 0.03)))
        }
    }

    /// El nombre de lo que hay debajo de la cruz: un aeropuerto o un parque si
    /// lo es, si no, la localidad.
    private func ponNombre() async {
        buscandoNombre = true
        defer { buscandoNombre = false }
        let aqui = CLLocation(latitude: centro.latitude, longitude: centro.longitude)
        guard let p = try? await CLGeocoder().reverseGeocodeLocation(aqui).first else { return }
        nombre = p.areasOfInterest?.first ?? p.locality ?? p.name
    }
}
