import SwiftUI

/// Compact storage meter: the user's note-media use vs their per-user budget
/// (photos/audios live in KV, whose capacity is small, so this warns before it
/// fills), plus how much the CURRENT session occupies. Read-only; refreshes the
/// server figure whenever it appears.
struct StorageMeterView: View {
    @ObservedObject private var store = TrackingStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Almacenamiento", systemImage: "internaldrive")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if let used = store.storageUsedBytes, let quota = store.storageQuotaBytes {
                    Text("\(Self.fmt(used)) / \(Self.fmt(quota))")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(tint)
                } else {
                    Text("—").foregroundStyle(.secondary)
                }
            }

            if let fraction {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.secondary.opacity(0.2))
                        Capsule().fill(tint).frame(width: max(3, geo.size.width * fraction))
                    }
                }
                .frame(height: 6)
                .accessibilityElement()
                .accessibilityLabel("Almacenamiento usado")
                .accessibilityValue("\(Int(fraction * 100)) por ciento")
            }

            if let fraction, fraction >= 0.85 {
                Text("Queda poco espacio (\(Int(fraction * 100))%). Puedes seguir añadiendo notas; si se llena, elimina fotos o audios de seguimientos antiguos.")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            sessionLine
        }
        .task { await store.refreshStorage() }
    }

    /// How much the current session's media occupies (a subset of the total).
    @ViewBuilder private var sessionLine: some View {
        let counts = store.sessionMediaCounts
        if store.sessionMediaBytes > 0 {
            Text("Esta sesión: \(Self.fmt(store.sessionMediaBytes))\(mediaSuffix(counts))")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else if store.isSharing {
            Text("Esta sesión: sin fotos ni audios todavía.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var fraction: Double? {
        guard let used = store.storageUsedBytes,
              let quota = store.storageQuotaBytes, quota > 0 else { return nil }
        return min(1, Double(used) / Double(quota))
    }

    private var tint: Color {
        switch fraction ?? 0 {
        case ..<0.7: return .green
        case ..<0.9: return .orange
        default: return .red
        }
    }

    private func mediaSuffix(_ c: (photos: Int, audios: Int)) -> String {
        var parts: [String] = []
        if c.photos > 0 { parts.append("\(c.photos) \(c.photos == 1 ? "foto" : "fotos")") }
        if c.audios > 0 { parts.append("\(c.audios) \(c.audios == 1 ? "audio" : "audios")") }
        return parts.isEmpty ? "" : " · " + parts.joined(separator: " · ")
    }

    private static func fmt(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}
