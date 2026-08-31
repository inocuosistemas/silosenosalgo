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

    /// Straight-line metres between two coordinates.
    static func distanceMeters(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        CLLocation(latitude: lat1, longitude: lon1)
            .distance(from: CLLocation(latitude: lat2, longitude: lon2))
    }

    /// How far you must move before we believe it: **1.5× the WORSE of the two
    /// declared errors**, not their sum. The sum was too harsh at the start of a
    /// route (a warming-up GPS at ±50 m demanded 100 m before the first point);
    /// the worst error responds sooner when one reading is good, and the 1.5
    /// factor keeps out the noise measured with bad signal (jumps of up to
    /// 118 m between ±99 m readings: 1.5 × 99 = 148, still out).
    static func movementThreshold(_ accuracyA: Double?, _ accuracyB: Double?) -> Double {
        max(accuracyA ?? 0, accuracyB ?? 0) * 1.5
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
