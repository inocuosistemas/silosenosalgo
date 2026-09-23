import SwiftUI
import UIKit
import UserNotifications

@main
struct SiLoSeNoSalgoTrackerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var auth = AuthStore()
    @StateObject private var guideLibrary = GuideLibrary.shared

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
                NavigationStack {
                    List { NavigationLink("Viaje en directo") { PantallaViaje() } }
                }
                .tint(Theme.sky500)
                .preferredColorScheme(.dark)
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
                    .onAppear { ViajeEnDirecto.shared.empieza(PruebaDeViaje.atributos) }
            } else {
            ContentView()
                .environmentObject(auth)
                .tint(Theme.sky500)
                .preferredColorScheme(.dark)
                .task { await auth.bootstrap() }
                // Si iOS cerró la app con un viaje en directo en marcha, se
                // vuelve a enganchar a él y a encender el GPS.
                .task { ViajeEnDirecto.shared.reanuda() }
                // Busca visor web nuevo al arrancar, nunca con el visor abierto:
                // cambiar los assets bajo un WKWebView vivo lo romperia. Si hay
                // build nuevo, entra en la siguiente apertura del visor.
                .task { await WebOTAUpdater.shared.refresh() }
                .onOpenURL { url in
                    guard url.pathExtension.lowercased() == "slsnsguide" else { return }
                    Task { await guideLibrary.openImportedGuide(from: url) }
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
        UNUserNotificationCenter.current().delegate = self
        // UIKit lifecycle callbacks run on the main thread, where TrackingStore
        // (a @MainActor singleton) is safe to touch.
        MainActor.assumeIsolated {
            if let token = Keychain.load() {
                TrackingStore.shared.configure(token: token)
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
        if response.notification.request.identifier == ViajeEnDirecto.idDelAviso {
            MainActor.assumeIsolated { ViajeEnDirecto.shared.empiezaElProgramado() }
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

    static let atributos = ViajeAtributos(
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
        CarreraEnDirecto.shared.empiezaDePrueba(hoja: hoja, carrera: "Matxicots 26", km: 7.4, ahora: ahora)
    }
}
