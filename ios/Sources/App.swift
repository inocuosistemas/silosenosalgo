import SwiftUI
import ActivityKit
import UIKit
import CoreLocation
import UserNotifications

@main
struct SiLoSeNoSalgoTrackerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var auth = AuthStore()
    @StateObject private var guideLibrary = GuideLibrary.shared
    /// La pantalla del viaje, abierta al tocar su tarjeta (ver `EnlaceDeViaje`).
    @State private var viajeAbierto = false
    /// La de la carrera en directo, al tocar la suya.
    @State private var carreraAbierta = false
    /// Las cuentas atrás, al tocar el widget.
    @State private var contadoresAbiertos = false

    var body: some Scene {
        WindowGroup {
            // Arranque de prueba del encuadre (ver `PruebaDeEncuadre`): solo
            // con el argumento de arranque, que pone quien lanza el proceso.
            if PruebaDeEncuadre.pedida {
                PantallaDePruebaDeEncuadre()
                    .tint(Theme.sky500)
                    .preferredColorScheme(.dark)
            } else if PruebaDeViaje.pantalla {
                // Solo la pantalla de configurar, detrás de un enlace: para
                // probar que lo escrito sigue ahí al salir y volver a entrar.
                let _ = PruebaDeViaje.siembraSiSePide()
                let _ = PruebaDeViaje.terminaLosDeAntes()
                NavigationStack {
                    List {
                        NavigationLink("Viaje en directo") { PantallaViaje() }
                        NavigationLink("Carrera en directo") { PantallaCarreraSimulada() }
                    }
                }
                .tint(Theme.sky500)
                .preferredColorScheme(.dark)
            } else if ProcessInfo.processInfo.arguments.contains("-PruebaDeNota") {
                // La hoja de añadir nota, sin entrar (para probar la foto).
                Color.black.sheet(isPresented: .constant(true)) { AddNoteView() }
                    .preferredColorScheme(.dark)
            } else if PruebaDeFotosEnRuta.pedida {
                // Añadir fotos a una salida terminada, con un recorrido y
                // unas fotos de muestra; la subida es de mentira.
                Color.black.sheet(isPresented: .constant(true)) {
                    PantallaFotosEnRuta(modelo: PruebaDeFotosEnRuta.modelo())
                }
                .preferredColorScheme(.dark)
            } else if PruebaDePantallaPrincipal.pedida {
                // La pantalla principal de verdad, sin entrar: con carreras y
                // rutas de muestra, para verla en pruebas.
                PantallaPrincipal()
                    .environmentObject(auth)
                    .preferredColorScheme(.dark)
                    .onAppear {
                        // `-WebBajando`: la pastilla de la web nueva, a medias.
                        if ProcessInfo.processInfo.arguments.contains("-WebBajando") { ProgresoDeWeb.shared.fraccion = 0.45 }
                        PruebaDePantallaPrincipal.siembra()
                        auth.siembraDePrueba(usuario: "laia", perfil: ProcessInfo.processInfo.arguments.contains("-SinMarca")
                            ? PerfilDeCuenta() : PerfilDeCuenta(favEmoji: "🦊", favColor: "orange"))
                    }
            } else if PruebaDeCarreraConTrazado.pedida {
                // La tarjeta con una ruta propia: con `-EnMarcha`, empezada
                // con una fija; si no, el formulario con dos rutas de muestra.
                NavigationStack { PantallaCarreraEnDirecto() }
                    .tint(Theme.sky500)
                    .preferredColorScheme(.dark)
                    .onAppear { PruebaDeCarreraConTrazado.prepara() }
            } else if PruebaDeCarrera.pedida {
                Text("Carrera de prueba en marcha")
                    .preferredColorScheme(.dark)
                    .onAppear { PruebaDeCarrera.empieza() }
            } else if PruebaDeViaje.pedida {
                // Arranque de prueba del viaje en directo: empieza uno fijo
                // (Madrid → Barcelona) para moverlo con una ruta GPS simulada.
                NavigationStack { PantallaViaje() }
                    .tint(Theme.sky500)
                    .preferredColorScheme(.dark)
                    .onAppear {
                        // Con `-SoloReanudar`, abrir sin empezar otro: lo que
                        // pasa al relanzar la app con un viaje en marcha.
                        if !ProcessInfo.processInfo.arguments.contains("-SoloReanudar") {
                            PruebaDeViaje.terminaLosDeAntes()
                            ViajeEnDirecto.shared.empieza(PruebaDeViaje.atributos)
                        }
                    }
            } else {
            ContentView()
                .environmentObject(auth)
                .tint(Theme.sky500)
                .preferredColorScheme(.dark)
                .task { await auth.bootstrap() }
                // «Siempre», al entrar por primera vez (ver `PermisoDeUbicacion`).
                .onChange(of: auth.status, initial: true) { _, estado in
                    if estado == .authed { PermisoDeUbicacion.shared.pideSiempreSiToca() }
                }
                // Si iOS cerró la app con un viaje en directo en marcha, se
                // vuelve a enganchar a él y a encender el GPS; y cada vez que
                // la app vuelve delante, por si iOS había parado el GPS.
                .task {
                    ViajeEnDirecto.shared.alVolver()
                    CarreraConTrazado.shared.reanuda()
                }
                .onReceive(NotificationCenter.default.publisher(
                    for: UIApplication.didBecomeActiveNotification)) { _ in
                    // Visor web nuevo también al volver, no solo al arrancar
                    // (ver `WebOTAUpdater.refreshAlVolver`).
                    Task { await WebOTAUpdater.shared.refreshAlVolver() }
                    ViajeEnDirecto.shared.alVolver()
                    CarreraConTrazado.shared.reanuda()
                }
                // Busca visor web nuevo al arrancar, nunca con el visor abierto:
                // cambiar los assets bajo un WKWebView vivo lo romperia. Si hay
                // build nuevo, entra en la siguiente apertura del visor.
                .task { await WebOTAUpdater.shared.refresh() }
                .onOpenURL { url in
                    if EnlaceDeViaje.es(url) { viajeAbierto = true; return }
                    if EnlaceDeCarrera.es(url) { carreraAbierta = true; return }
                    if EnlaceDeContadores.es(url) { contadoresAbiertos = true; return }
                    guard url.pathExtension.lowercased() == "slsnsguide" else { return }
                    Task { await guideLibrary.openImportedGuide(from: url) }
                }
                // Al tocar la tarjeta del viaje: su pantalla, esté donde esté
                // la app, para ver cómo va o terminarlo.
                .sheet(isPresented: $viajeAbierto) {
                    NavigationStack {
                        PantallaViaje()
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button("Cerrar") { viajeAbierto = false }
                                }
                            }
                    }
                    .tint(Theme.sky500)
                    .preferredColorScheme(.dark)
                }
                .sheet(isPresented: $contadoresAbiertos) {
                    NavigationStack {
                        ContadoresView()
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button("Cerrar") { contadoresAbiertos = false }
                                }
                            }
                    }
                    .tint(Theme.sky500)
                    .preferredColorScheme(.dark)
                }
                .sheet(isPresented: $carreraAbierta) {
                    NavigationStack {
                        PantallaCarreraEnDirecto()
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button("Cerrar") { carreraAbierta = false }
                                }
                            }
                    }
                    .tint(Theme.sky500)
                    .preferredColorScheme(.dark)
                }
                .fullScreenCover(item: $guideLibrary.presentedGuide) { guide in
                    LiveMapView(
                        source: .offline(token: guide.id), offlineToken: guide.id,
                        allowsEditing: false, title: "Guía offline"
                    )
                }
                .alert("Guías offline", isPresented: Binding(
                    get: { guideLibrary.importError != nil },
                    set: { if !$0 { guideLibrary.importError = nil } }
                )) {
                    Button("Aceptar", role: .cancel) { guideLibrary.importError = nil }
                } message: {
                    Text(guideLibrary.importError ?? "")
                }
            }
        }
    }
}

/// Handles LAUNCH — including a headless background relaunch by iOS for a
/// significant-location-change (the SwiftUI scene/`.task` may not run then). If a
/// beacon was left active, resume it right away so it survives an app kill.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        #if DEBUG
        // Pruebas de interfaz: arrancar como recién instalada (sin sesión, sin
        // modo local, sin salidas de este móvil ni una a medias). Antes que nada:
        // lo de abajo retoma la salida que hubiera.
        if ProcessInfo.processInfo.arguments.contains("-EmpiezaSinSesion") {
            Keychain.clear()
            ModoLocal.activo = false
            for k in ["salidasLocales-v1", "baliza.altaPendiente"] { UserDefaults.standard.removeObject(forKey: k) }
        }
        #endif
        UNUserNotificationCenter.current().delegate = self
        // UIKit lifecycle callbacks run on the main thread, where TrackingStore
        // (a @MainActor singleton) is safe to touch.
        MainActor.assumeIsolated {
            // Un viaje en directo en marcha: si iOS relanza la app en segundo
            // plano por un cambio de ubicación, la vista puede no llegar a
            // montarse, así que se retoma aquí.
            ViajeEnDirecto.shared.alVolver()
            CarreraConTrazado.shared.reanuda()
            if let token = Keychain.load() {
                TrackingStore.shared.configure(token: token)
                TrackingStore.shared.restoreActiveSession()
            } else if ModoLocal.activo {
                // Sin cuenta también se retoma la salida que quedó a medias.
                TrackingStore.shared.restoreActiveSession()
            }
        }
        return true
    }

    /// El token de APNs de este aparato. Lo entrega iOS cuando le apetece —a
    /// veces al instante, a veces al segundo arranque—, así que el alta se hace
    /// aquí y no en una pantalla: es el único sitio por donde pasa siempre.
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        MainActor.assumeIsolated { PushRegistrar.shared.recibeToken(deviceToken) }
    }

    /// Sin token no hay push, y punto: el aviso local sigue funcionando mientras
    /// la baliza emite, así que no hay nada que decirle a nadie. Se registra en
    /// consola para poder mirarlo cuando alguien diga "a mí no me suena".
    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[push] no se pudo registrar: \(error.localizedDescription)")
    }

    /// Show cheer banners even while the app is frontmost (e.g. the embedded
    /// viewer is open full screen): mirror of Android, where the "ánimos"
    /// channel is allowed to interrupt — that's its whole point.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    /// Al tocar un aviso. El de la hora de salida de un viaje en directo lo
    /// arranca: Apple no deja arrancar la Actividad sin la app delante, y tocar
    /// el aviso es justo lo que la pone delante.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let id = response.notification.request.identifier
        if id == ViajeEnDirecto.idDelAviso {
            MainActor.assumeIsolated { ViajeEnDirecto.shared.empiezaElProgramado() }
        }
        // El aviso de la carrera preparada: al tocarlo, la baliza queda armada.
        if PreparacionDeCarrera.esSuyo(id) {
            Task { @MainActor in await PreparacionDeCarrera.arma() }
        }
        completionHandler()
    }
}

/// El viaje en directo de prueba: con `-PruebaDeViaje` la app arranca en su
/// pantalla y empieza uno fijo, para poder moverlo con una ruta GPS simulada
/// (`xcrun simctl location … start`). Solo responde a un argumento de arranque.
enum PruebaDeViaje {
    static var pedida: Bool { ProcessInfo.processInfo.arguments.contains("-PruebaDeViaje") }
    /// Solo la pantalla de configurar, sin arrancar ningún viaje.
    static var pantalla: Bool { ProcessInfo.processInfo.arguments.contains("-PruebaDePantallaDeViaje") }

    /// Con `-ConViajeDeEjemplo`, la pantalla se abre ya configurada: Barcelona
    /// → Estambul, como el que se estaba probando en el móvil.
    static func siembraSiSePide() {
        guard ProcessInfo.processInfo.arguments.contains("-ConViajeDeEjemplo") else { return }
        BorradorDeViaje(
            titulo: "Algo muy especial...🎁",
            origen: LugarDeViaje(nombre: "El Prat de Llobregat", abreviatura: "BCN", latitud: 41.2886, longitud: 2.0743),
            destino: LugarDeViaje(nombre: "Istanbul Airport", abreviatura: "IST", latitud: 41.2753, longitud: 28.7519),
            transporte: .avion,
            colores: ColoresDeViaje(fondo: "#1a0b2e", trayecto: "#f472b6", trayecto2: "#f59e0b"),
            conHora: false, hora: Date().addingTimeInterval(3600)
        ).guarda()
    }

    /// Quitar los viajes que haya dejado en marcha otra prueba: con uno en
    /// marcha, la pantalla enseña «En marcha» y no el formulario, y en la
    /// pantalla de bloqueo hay dos tarjetas.
    static func terminaLosDeAntes() {
        for a in Activity<ViajeAtributos>.activities {
            Task { await a.end(nil, dismissalPolicy: .immediate) }
        }
        // Y la de la carrera de prueba, que se ponía encima y tapaba la del viaje.
        for a in Activity<CarreraAtributos>.activities {
            Task { await a.end(nil, dismissalPolicy: .immediate) }
        }
    }

    /// Con `-ViajeEnCoche`, uno por carretera, Barcelona → Andorra, para ver
    /// la ruta dibujada; si no, el de avión.
    static var atributos: ViajeAtributos {
        ProcessInfo.processInfo.arguments.contains("-ViajeEnCoche") ? enCoche : enAvion
    }

    static let enCoche = ViajeAtributos(
        titulo: "Esquí en Grandvalira",
        origen: LugarDeViaje(nombre: "Barcelona", abreviatura: "BCN", latitud: 41.3874, longitud: 2.1686),
        destino: LugarDeViaje(nombre: "Andorra la Vella", abreviatura: "AND", latitud: 42.5063, longitud: 1.5218),
        transporte: .coche)

    static let enAvion = ViajeAtributos(
        titulo: "Prueba de viaje",
        origen: LugarDeViaje(nombre: "Madrid", abreviatura: "MAD", latitud: 40.4168, longitud: -3.7038),
        destino: LugarDeViaje(nombre: "Barcelona", abreviatura: "BCN", latitud: 41.3874, longitud: 2.1686),
        transporte: .avion)
}


/// La carrera en directo de prueba: con `-PruebaDeCarrera` la app arranca una
/// tarjeta de tramo con una hoja fija —20 km, sube hasta el 10 y baja—, para
/// ver lo que pinta el sistema sin salir a correr.
enum PruebaDeCarrera {
    static var pedida: Bool { ProcessInfo.processInfo.arguments.contains("-PruebaDeCarrera") }

    @MainActor
    static func empieza() {
        PruebaDeViaje.terminaLosDeAntes()
        let ahora = Date()
        let salida = ahora.addingTimeInterval(-(3 * 3600 + 42 * 60))
        let perfil = stride(from: 0.0, through: 20.0, by: 0.05).map { km in
            HojaDeTramos.Muestra(km: km, ele: (km <= 10 ? 2000 + 40 * km : 2400 - 30 * (km - 10))
                                 + 15 * sin(km * 3))
        }
        // El plan: 30 min por km (en montaña, y contando que sube).
        let previsto = stride(from: 0.0, through: 20.0, by: 0.25).map { HojaDeTramos.Previsto(km: $0, min: $0 * 30) }
        let hoja = HojaDeTramos(
            version: 1, salida: salida.timeIntervalSince1970 * 1000, totalKm: 20,
            perfil: perfil, previsto: previsto,
            puntos: [
                .init(nombre: "Font del Gel", km: 5, tipo: "liquido", corte: nil),
                .init(nombre: "Refugi del Rebost", km: 12, tipo: "solido",
                      // Del 7,4 al 12 el plan prevé 4,6 × 30 = 138 min: con el
                      // corte 21 min después, sale un margen justo, en ámbar.
                      corte: ahora.addingTimeInterval((4.6 * 30 + 21) * 60).timeIntervalSince1970 * 1000),
                .init(nombre: "Meta", km: 20, tipo: "meta", corte: nil),
            ])
        // Y quién va cerca, como si hubiera llegado del servidor.
        let corredores = DatosCorredores(posicion: 34, de: 120, actualizado: ahora, corredores: [
            .init(km: 17.8, emoji: "🦅", nombre: "Aitor", lider: true),
            .init(km: 8.9, emoji: "🐺", nombre: "Pau"),
            .init(km: 7.8, emoji: "🦊", nombre: "Marta"),
            .init(km: 7.1, emoji: "🐢", nombre: "Jon"),
            .init(km: 5.9, emoji: "🦔", nombre: "Laia"),
        ])
        CarreraEnDirecto.shared.empiezaDePrueba(hoja: hoja, carrera: "Matxicots 26", km: 7.4, ahora: ahora,
                                                corredores: corredores)
    }
}


/// La carrera en directo con una ruta propia, de prueba: `-PruebaDeCarreraConTrazado`.
enum PruebaDeCarreraConTrazado {
    static var pedida: Bool { ProcessInfo.processInfo.arguments.contains("-PruebaDeCarreraConTrazado") }

    @MainActor
    static func prepara() {
        PruebaDeViaje.terminaLosDeAntes()
        TrackingStore.shared.plans = [
            PlanSummary(id: "p1", name: "Vuelta al Montseny", routeName: nil, distanceKm: 42,
                        startTime: nil, eventId: nil, activity: "run"),
            PlanSummary(id: "p2", name: "Tirada larga domingo", routeName: nil, distanceKm: 21.1,
                        startTime: nil, eventId: nil, activity: "run"),
        ]
        guard ProcessInfo.processInfo.arguments.contains("-EnMarcha") else { return }
        // 42 km hacia el norte, en línea recta: la hoja de ejemplo por encima.
        let n = 421
        let pts = (0..<n).map { i in (lat: 41.7 + Double(i) * 0.1 / 111.195, lon: 2.4) }
        let cum = (0..<n).map { Double($0) * 0.1 }
        CarreraConTrazado.shared.empiezaDePrueba(
            hoja: .ejemplo(salida: Date().addingTimeInterval(-90 * 60)),
            ruta: PlanGeometry.Route(points: pts, cumKm: cum), nombre: "Vuelta al Montseny")
    }
}


/// «Añadir fotos» a una salida terminada, sin entrar: `-PruebaDeFotosEnRuta`.
/// Un recorrido de dos horas en el Montseny y seis fotos: cuatro con la hora de
/// la salida, una con solo GPS y una sin nada (va a mano).
enum PruebaDeFotosEnRuta {
    static var pedida: Bool { ProcessInfo.processInfo.arguments.contains("-PruebaDeFotosEnRuta") }

    @MainActor
    static func modelo() -> FotosEnRutaModelo {
        // `-InicioDePrueba <epoch ms>`: la hora fija de la salida, para que
        // coincida con la de las fotos que se meten en el simulador.
        let args = ProcessInfo.processInfo.arguments
        let fijo = args.firstIndex(of: "-InicioDePrueba").flatMap { i in i + 1 < args.count ? Double(args[i + 1]) : nil }
        let inicio = fijo ?? (Date().timeIntervalSince1970 - 86_400) * 1000
        let sesion = TrackSessionSummary(
            id: "pruebafotos0001", title: "Vuelta al Montseny", planName: nil, status: "ended",
            startedAt: inicio, expiresAt: inicio + 30 * 86_400_000, updatedAt: nil,
            endedAt: inicio + 7_200_000, pinned: false, activity: .run, eventId: nil, device: nil)
        let m = FotosEnRutaModelo(sesion: sesion)
        // Un bucle: 120 puntos, uno por minuto.
        let trail = (0...120).map { i -> TrailPoint in
            let a = Double(i) / 120 * 2 * .pi
            return TrailPoint(t: inicio + Double(i) * 60_000,
                              lat: 41.77 + 0.02 * sin(a), lon: 2.43 + 0.03 * (1 - cos(a)), a: 5)
        }
        m.ponTrazado(trail)
        // Con `-SinFotos`, vacía: para probar «Buscar las fotos de la ruta» con
        // las del carrete del simulador.
        if ProcessInfo.processInfo.arguments.contains("-SinFotos") {
            // Una nota con foto ya subida, con la hora de la primera foto del
            // carrete de prueba (20 min después de salir): debe salir «Ya está».
            m.notasConFoto = [(inicio + 20 * 60_000, inicio + 20 * 60_000)]
            m.subidor = { _, _ in try await Task.sleep(for: .milliseconds(300)) }
            return m
        }
        let colores: [UIColor] = [.systemTeal, .systemOrange, .systemGreen, .systemPink, .systemIndigo, .systemYellow]
        let minutos: [Double?] = [8, 31, 55, 94, nil, nil]
        for (i, color) in colores.enumerated() {
            let img = UIGraphicsImageRenderer(size: CGSize(width: 180, height: 180)).image { c in
                color.setFill(); c.fill(CGRect(x: 0, y: 0, width: 180, height: 180))
                ("\(i + 1)" as NSString).draw(at: CGPoint(x: 70, y: 55), withAttributes: [
                    .font: UIFont.boldSystemFont(ofSize: 60), .foregroundColor: UIColor.white])
            }
            let fecha = minutos[i].map { Date(timeIntervalSince1970: (inicio + $0 * 60_000) / 1000) }
            let gps = i == 4 ? CLLocationCoordinate2D(latitude: 41.757, longitude: 2.475) : nil
            m.anade(.init(miniatura: img, datos: img.jpegData(compressionQuality: 0.6)!, fecha: fecha, gps: gps, sitio: nil, assetId: nil))
        }
        m.subidor = { _, _ in try await Task.sleep(for: .milliseconds(300)) }
        return m
    }
}

/// La pantalla principal sin entrar, con datos de muestra: `-PruebaDePantallaPrincipal`.
enum PruebaDePantallaPrincipal {
    static var pedida: Bool { ProcessInfo.processInfo.arguments.contains("-PruebaDePantallaPrincipal") }

    @MainActor
    static func siembra() {
        let t = TrackingStore.shared
        t.cargaDeCarreras = .cargadas
        // Sin lista todavía (`-CarrerasCargando`) o sin poder traerla (`-CarrerasFallo`).
        let args = ProcessInfo.processInfo.arguments
        // El archivo sin lista todavía (`-SalidasCargando`) o sin poder traerla (`-SalidasFallo`).
        t.cargaDeSalidas = .cargadas
        if args.contains("-SalidasCargando") || args.contains("-SalidasFallo") {
            t.sessions = []
            t.cargaDeSalidas = args.contains("-SalidasFallo") ? .fallo : .cargando
        }
        if args.contains("-CarrerasCargando") || args.contains("-CarrerasFallo") {
            t.events = []
            t.pastEvents = []
            t.cargaDeCarreras = args.contains("-CarrerasFallo") ? .fallo : .cargando
            return
        }
        let dia: Double = 86_400_000
        let ahora = Date().timeIntervalSince1970 * 1000
        let a = ProcessInfo.processInfo.arguments
        // La primera: mañana a las 7:24 (`-CarreraManana`), dentro de 50 min
        // (`-CarreraEnUnRato`) o en nueve días.
        var manana = Calendar.current.date(byAdding: .day, value: 1, to: Date())!
        manana = Calendar.current.date(bySettingHour: 7, minute: 24, second: 0, of: manana)!
        let primera = a.contains("-CarreraManana") ? manana.timeIntervalSince1970 * 1000
            : a.contains("-CarreraEnUnRato") ? ahora + 50 * 60_000
            : ahora + 9 * dia
        if a.contains("-SinPreparar") { PreparacionDeCarrera.olvida() }
        t.events = [
            EventSummary(id: "e1", name: "Matxicots 26", planShareId: nil, planName: nil,
                         startsAt: primera, endedAt: nil, myEmoji: "🦊", myColor: "orange", activity: "run"),
            EventSummary(id: "e2", name: "Ultra Pirineu", planShareId: "y", planName: nil,
                         startsAt: ahora + 40 * dia, endedAt: nil, myEmoji: "🦊", myColor: "orange", activity: "run"),
        ]
        t.pastEvents = [
            EventSummary(id: "e0", name: "Matxicots 25", planShareId: "z", planName: nil,
                         startsAt: ahora - 340 * dia, endedAt: ahora - 339 * dia, myEmoji: "🦊", myColor: "orange", activity: "run"),
        ]
        t.plans = [
            PlanSummary(id: "p1", name: "Vuelta al Montseny", routeName: nil, distanceKm: 42,
                        startTime: nil, eventId: nil, activity: "run"),
        ]
    }
}
