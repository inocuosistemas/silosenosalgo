import Foundation
import CoreLocation

/// Pure GPS-quality rules, mirroring `android/.../TrackingRules.kt` (which was
/// itself tuned with data from real outings). Same thresholds on both platforms,
/// so the two apps never disagree about what counts as movement.
enum TrackingRules {

    /// Below this declared accuracy a reading is believed as-is. 10 m is where
    /// noise stops looking like a step: walking covers ~12 m between 10 s
    /// readings, so above that the filter would confuse walking with standing.
    static let reliableAccuracyM = 10.0

    /**
     Cuánto antes de la salida arranca sola una baliza armada.

     Cinco minutos, y no dos: el GPS recién despertado tarda en enganchar y sus
     primeras lecturas son las malas —las de cientos de metros—. Con dos
     minutos, la primera posición que veía la carrera era todavía una posición de
     antena; con cinco, para cuando suena el disparo la baliza lleva un rato
     dando metros de precisión y la salida sale afinada.

     Lo que se emite en esos cinco minutos es la línea de salida, que no estorba:
     lo que había que evitar es emitir desde el aparcamiento una hora antes, y
     eso lo sigue evitando. Espejo de `ANTELACION_SALIDA_SEGUNDOS` en Android.
     */
    static let startLeadSeconds: TimeInterval = 300

    /// La carrera que se corre HOY, si la hay: la que la baliza deja puesta
    /// sola al abrirla. Espejo de `TrackingRules.eventoDeHoy` en Android, donde
    /// está la explicación larga y las pruebas.
    ///
    /// El día de la carrera nadie abre la baliza para otra cosa. Obligar a
    /// elegir el evento a mano ese día es pedir justo el paso que se olvida —con
    /// el dorsal puesto y con prisa—, y olvidarlo deja la salida fuera del mapa
    /// común: quien te sigue no te encuentra donde te busca. De regalo viene la
    /// hora oficial, que es lo que deja la baliza ARMADA y en silencio hasta el
    /// disparo en vez de emitiendo desde el aparcamiento.
    ///
    /// Mismo día natural (el del móvil) o, si no, que salga en las próximas
    /// `proposeAheadSeconds` (18 h): la víspera por la noche se arma la baliza
    /// antes de dormir, y es justo cuando se olvida elegir la carrera.
    /// Sin terminar, con hora puesta, y si hay
    /// dos, la más cercana a este momento —antes o después de su hora—.
    static func todaysEvent(
        _ events: [EventSummary],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> EventSummary? {
        events
            .filter { !$0.isOver }
            .compactMap { ev -> (EventSummary, Date)? in
                guard let ms = ev.startsAt, ms > 0 else { return nil }
                return (ev, Date(timeIntervalSince1970: ms / 1000))
            }
            .filter {
                calendar.isDate($0.1, inSameDayAs: now)
                    || ($0.1 > now && $0.1.timeIntervalSince(now) <= proposeAheadSeconds)
            }
            .min { abs($0.1.timeIntervalSince(now)) < abs($1.1.timeIntervalSince(now)) }?
            .0
    }

    /// Cuánto antes de la salida se propone ya la carrera sola.
    static let proposeAheadSeconds: TimeInterval = 18 * 3_600
    /// Hasta dónde, antes o después de la salida, se pregunta al compartir.
    static let nearbySeconds: TimeInterval = 48 * 3_600

    /// La carrera por la que PREGUNTAR al pulsar "Compartir" sin carrera elegida.
    ///
    /// Es fácil salir sin elegirla: la app no la propuso (quedaba más lejos) o se
    /// quitó la propuesta. Y sin carrera, la salida no aparece en su mapa. Así
    /// que si hay una en marcha o que sale en las próximas 48 h, se pregunta
    /// antes de empezar; si no hay ninguna, un entrenamiento sigue siendo un
    /// toque. Sin terminar y con hora puesta; si hay varias, la más cercana.
    /// Espejo de `TrackingRules.carreraCercana` en Android.
    static func nearbyEvent(_ events: [EventSummary], now: Date = Date()) -> EventSummary? {
        events
            .filter { !$0.isOver }
            .compactMap { ev -> (EventSummary, Date)? in
                guard let ms = ev.startsAt, ms > 0 else { return nil }
                return (ev, Date(timeIntervalSince1970: ms / 1000))
            }
            .filter { abs($0.1.timeIntervalSince(now)) <= nearbySeconds }
            .min { abs($0.1.timeIntervalSince(now)) < abs($1.1.timeIntervalSince(now)) }?
            .0
    }

    /// Lo que falta para la salida, en palabras: `2 d 03 h 04 m 05 s`. Espejo de
    /// `TrackingRules.cuentaAtras` en Android, donde están las pruebas.
    ///
    /// Nulo sin hora puesta y nulo pasada la hora: lo que toca entonces no es un
    /// número creciente, sino "ya ha salido", que lo pone la pantalla. Las
    /// unidades en cero de delante no se escriben; las de detrás van con dos
    /// cifras para que el número no baile de ancho cada segundo.
    static func countdown(startsAtMs: Double?, now: Date = Date()) -> String? {
        guard let ms = startsAtMs, ms > 0 else { return nil }
        let remaining = Int((ms / 1000 - now.timeIntervalSince1970).rounded(.down))
        guard remaining > 0 else { return nil }
        let d = remaining / 86_400
        let h = (remaining % 86_400) / 3_600
        let m = (remaining % 3_600) / 60
        let s = remaining % 60
        if d > 0 { return String(format: "%d d %02d h %02d m %02d s", d, h, m, s) }
        if h > 0 { return String(format: "%d h %02d m %02d s", h, m, s) }
        if m > 0 { return String(format: "%d m %02d s", m, s) }
        return "\(s) s"
    }

    /// Straight-line metres between two coordinates.
    static func distanceMeters(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        CLLocation(latitude: lat1, longitude: lon1)
            .distance(from: CLLocation(latitude: lat2, longitude: lon2))
    }

    /**
     Por encima de este error, una lectura ya no sirve NI PARA MEDIR.

     Es el tope de la vara, y sin él pasó esto en la CanFranc: la primera
     lectura de una baliza traía ±1447 m —una posición de antena, del modo
     espera— y el umbral de movimiento salía a 1447 × 1,5 = **2,17 km**. Hasta
     que su dueño no se alejó dos kilómetros de aquel punto inventado, todas sus
     lecturas buenas —de dos y tres metros— se descartaron y en su lugar se
     grabó el ancla: una hora entera clavado en un sitio donde no estaba,
     mientras cruzaba el primer control.

     Cien metros es generoso para lo que tiene que dejar pasar (un valle
     cerrado, un bosque) y corta en seco lo que no puede medirse.
     */
    static let anchorMaxAccuracyM = 100.0

    /// How far you must move before we believe it: **1.5× the WORSE of the two
    /// declared errors**, not their sum. The sum was too harsh at the start of a
    /// route (a warming-up GPS at ±50 m demanded 100 m before the first point);
    /// the worst error responds sooner when one reading is good, and the 1.5
    /// factor keeps out the noise measured with bad signal (jumps of up to
    /// 118 m between ±99 m readings: 1.5 × 99 = 148, still out).
    ///
    /// Y con TOPE: un error de un kilómetro no es una vara de medir, es una
    /// lectura que no sabe dónde está. Ver `anchorMaxAccuracyM`.
    static func movementThreshold(_ accuracyA: Double?, _ accuracyB: Double?) -> Double {
        min(max(accuracyA ?? 0, accuracyB ?? 0), anchorMaxAccuracyM) * 1.5
    }

    /**
     ¿Hay que rehacer el ancla porque ha llegado algo mucho mejor?

     El ancla es la posición que se da por buena, y todo lo demás se mide contra
     ella. Si se fija con una lectura mala —y se fija, porque al principio "un
     punto malo es mejor que ninguno"— arrastra el error hasta que alguien la
     sustituya. Nadie lo hacía: solo se cambiaba al detectar movimiento, y el
     movimiento se medía contra ella misma.

     Así que en cuanto llega una lectura FIABLE y el ancla no lo era, manda la
     nueva. Sin discutir y sin mirar la distancia: no es que se haya movido, es
     que ahora sí se sabe dónde está.
     */
    static func shouldReanchor(anchor: Fix?, new: Fix) -> Bool {
        guard let anchor else { return false }
        guard let nueva = new.accuracy, nueva <= anchorMaxAccuracyM else { return false }
        let vieja = anchor.accuracy ?? 0
        return vieja > anchorMaxAccuracyM
    }

    /// Did we really move relative to the ANCHOR — the last position taken as
    /// good — or is the GPS just wandering? Compared against the anchor (not the
    /// previous reading) on purpose: a slow real advance accumulates until it
    /// crosses the uncertainty, instead of being lost step by step.
    static func hasMovement(anchor: Fix?, new: Fix) -> Bool {
        guard let anchor else { return true }
        // With good signal the reading is believed as-is: the anchor exists for
        // ±50 m readings inside a building, and at ±4 m it does more harm than
        // good (the ~6 m threshold gets close to what you walk between fixes).
        let worst = max(anchor.accuracy ?? 0, new.accuracy ?? 0)
        if worst <= reliableAccuracyM { return true }
        let d = distanceMeters(anchor.lat, anchor.lon, new.lat, new.lon)
        return d >= movementThreshold(anchor.accuracy, new.accuracy)
    }

    /// What gets recorded when there is NO movement: the anchor's position with
    /// the new reading's time and accuracy — "still here, and still alive" —
    /// instead of drawing followers a walk that never happened. Speed and
    /// heading of a reading that didn't clear the noise mean nothing: omitted.
    static func holdPosition(anchor: Fix, new: Fix) -> Fix {
        var held = anchor
        held.fixAt = new.fixAt
        held.accuracy = new.accuracy
        held.speed = nil
        held.heading = nil
        held.altitude = new.altitude
        return held
    }

    /// Is this reading good enough to record? A freshly woken GPS first emits
    /// positions with hundreds of metres of error that draw a scribble leaving
    /// and returning. Dropped unless there is nothing else yet: a bad point
    /// beats no point.
    static func acceptableAccuracy(_ accuracy: Double?, hasAny: Bool) -> Bool {
        guard let accuracy else { return true }
        if accuracy <= 100 { return true }
        return !hasAny
    }

    /// Same reading delivered twice (normal subscription + heartbeat one-shot
    /// can both hand us the same fix). The fix instant is the right signature:
    /// the GPS never produces two distinct readings with the same timestamp,
    /// while coordinates legitimately repeat when standing still.
    static func isRepeated(previous: Fix?, new: Fix) -> Bool {
        guard let t0 = previous?.fixAt, let t1 = new.fixAt else { return false }
        return t0 == t1
    }

    /// How much slack the activity's max speed gets before a jump is called
    /// impossible. **Declared: 1.5** — if you say you're walking, 18 km/h is
    /// not walking (a real 78.6 m / 11 s jump at ±3 m slipped through a looser
    /// margin and alone added 26% of a route's distance). **Inferred: 3** — the
    /// activity is deduced FROM the trail, so discarding aggressively on a guess
    /// bites its own tail; data isn't thrown away over a conjecture.
    static func speedMargin(declared: Bool) -> Double { declared ? 1.5 : 3.0 }

    /// Two consecutive readings that would require going faster than the
    /// movement type allows. The viewer already filters these when drawing; we
    /// also filter here so the offline backlog doesn't fill with junk. With the
    /// activity on "Automático" (nil) nothing is dropped: without knowing
    /// whether it's a bike or a car, any cap would be made up.
    static func impossibleJump(previous: Fix?, new: Fix, activity: BeaconActivity?, declared: Bool) -> Bool {
        guard let activity, let previous,
              let t0 = previous.fixAt, let t1 = new.fixAt else { return false }
        let hours = (t1 - t0) / 3_600_000
        guard hours > 0 else { return false }
        let km = distanceMeters(previous.lat, previous.lon, new.lat, new.lon) / 1000
        return km / hours > activity.maxSpeedKmh * speedMargin(declared: declared)
    }

    /// Cumulative trail distance (metres), **discarding GPS noise**: a segment
    /// only counts if it's longer than the movement threshold of its two
    /// readings. Sounds conservative and isn't — measured on-device, eleven
    /// consecutive readings with the phone STILL inside a building summed 449 m.
    /// The price is undercounting slow walking under bad signal, and that's
    /// accepted: a slightly low number is an honest error; an inflated one is a
    /// lie that also ruins paces and arrival predictions. A reading without a
    /// declared accuracy is trusted (no basis to doubt it).
    static func trailDistanceMeters(_ trail: [TrailPoint]) -> Double {
        guard trail.count >= 2 else { return 0 }
        var total = 0.0
        for i in 1..<trail.count {
            let d = distanceMeters(trail[i - 1].lat, trail[i - 1].lon, trail[i].lat, trail[i].lon)
            // The same threshold that decides whether there was movement: if a
            // segment can't move the position, it can't add kilometres either.
            if d >= movementThreshold(trail[i - 1].a.map(Double.init), trail[i].a.map(Double.init)) {
                total += d
            }
        }
        return total
    }
}
