import Foundation
import UserNotifications

/**
 PREPARAR una carrera la noche antes y dejarla ARMADA el mismo día.

 Armar la baliza por la noche para que salga sola por la mañana depende de que
 iOS deje viva la app toda la noche, y no siempre lo hace: en la CanFranc una
 baliza armada arrancó con más de una hora de retraso. Así que la noche antes no
 se arma nada: se comprueba que está todo (ver `PantallaPrepararCarrera`) y se
 programa un AVISO para la mañana, un rato antes de la salida. Al tocarlo se
 abre la app y la baliza queda armada con la carrera elegida, con el móvil en la
 mano: eso ya no depende de nada. Si no se toca, un recordatorio poco antes.

 Una carrera preparada a la vez: es la de mañana.
 */
struct PreparacionDeCarrera: Codable, Equatable {
    var eventoId: String
    var nombre: String
    var salida: Date
    /// Cuánto antes de la salida llega el aviso para armarla.
    var avisoMin: Int

    var avisoA: Date { salida.addingTimeInterval(-Double(avisoMin) * 60) }
    /// El recordatorio, por si el primero no se tocó.
    var recordatorioA: Date { salida.addingTimeInterval(-Double(Self.recordatorioMin) * 60) }

    static let recordatorioMin = 10
    /// Lo que se puede elegir para el aviso, en minutos antes de la salida.
    static let opcionesDeAviso = [30, 60, 90, 120]
    static let avisoPorDefecto = 60

    // MARK: Guardado

    private static let clave = "carrera.preparada"
    private static let claveAviso = "carrera.avisoMin"

    static func lee() -> PreparacionDeCarrera? {
        guard let d = UserDefaults.standard.data(forKey: clave),
              let p = try? JSONDecoder().decode(PreparacionDeCarrera.self, from: d) else { return nil }
        // Una de una salida que ya pasó hace rato no vale para nada.
        guard p.salida.timeIntervalSinceNow > -6 * 3600 else { olvida(); return nil }
        return p
    }

    static func de(evento id: String) -> PreparacionDeCarrera? {
        lee().flatMap { $0.eventoId == id ? $0 : nil }
    }

    /// El último aviso elegido: se propone el mismo la próxima vez.
    static var avisoElegido: Int {
        get {
            let v = UserDefaults.standard.integer(forKey: claveAviso)
            return opcionesDeAviso.contains(v) ? v : avisoPorDefecto
        }
        set { UserDefaults.standard.set(newValue, forKey: claveAviso) }
    }

    /// Dejarla lista: se guarda y se programan el aviso y el recordatorio.
    func guarda() {
        if let d = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(d, forKey: Self.clave)
        }
        Self.avisoElegido = avisoMin
        programaAvisos()
    }

    static func olvida() {
        UserDefaults.standard.removeObject(forKey: clave)
        quitaAvisos()
    }

    // MARK: Avisos

    static let idAviso = "carrera-preparada"
    static let idRecordatorio = "carrera-preparada-recordatorio"

    static func esSuyo(_ id: String) -> Bool { id == idAviso || id == idRecordatorio }

    private func programaAvisos() {
        Self.quitaAvisos()
        let hora = salida.formatted(date: .omitted, time: .shortened)
        pon(Self.idAviso, cuando: avisoA,
            titulo: "Hoy corres \(nombre)",
            cuerpo: "Salida a las \(hora). Toca para dejar la baliza armada: saldrá sola.")
        pon(Self.idRecordatorio, cuando: recordatorioA,
            titulo: "⏳ \(nombre) sale en \(Self.recordatorioMin) min",
            cuerpo: "La baliza aún no está armada. Toca para armarla.")
    }

    private func pon(_ id: String, cuando: Date, titulo: String, cuerpo: String) {
        guard cuando > Date() else { return }
        let c = UNMutableNotificationContent()
        c.title = titulo
        c.body = cuerpo
        c.sound = .default
        c.interruptionLevel = .timeSensitive
        let cuandoC = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: cuando)
        UNUserNotificationCenter.current().add(UNNotificationRequest(
            identifier: id, content: c,
            trigger: UNCalendarNotificationTrigger(dateMatching: cuandoC, repeats: false)))
    }

    static func quitaAvisos() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [idAviso, idRecordatorio])
    }

    // MARK: Armar

    /**
     Armar la baliza con la carrera preparada: lo que pasa al tocar el aviso (o
     al pulsar «Armar ya» si el aviso ya pasó). La carrera se elige, la hora de
     salida es la suya —la oficial si la lista de carreras ya ha llegado; si no,
     la guardada, que es la misma— y se empieza: con la salida por delante, la
     baliza queda ARMADA y arranca sola a su hora.
     */
    @MainActor
    static func arma() async {
        guard let p = lee() else { return }
        let t = TrackingStore.shared
        PantallaPrincipal.Navegacion.shared.pestana = .baliza
        guard !t.isSharing else { quitaAvisos(); return }
        if t.events.isEmpty { await t.loadEvents() }
        if t.selectedEventId != p.eventoId { t.setEvent(p.eventoId) }
        // Puesta a mano, aunque la carrera ya la haya puesto: solo una hora
        // «tocada» se respeta al empezar (ver `horaHeredadaValida`).
        t.setStartAt(p.salida)
        await t.startSharing(title: nil)
        if t.isSharing { quitaAvisos() }
    }
}
