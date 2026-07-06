import SwiftUI

/// Thread-safe cancel flag shared with the background download loop (reading a
/// SwiftUI @State off the main actor would be a data race).
final class CancelBox {
    private let lock = NSLock()
    private var value = false
    var flag: Bool {
        get { lock.lock(); defer { lock.unlock() }; return value }
        set { lock.lock(); value = newValue; lock.unlock() }
    }
}

/// Offline map management: pre-download a corridor of tiles around the route at a
/// chosen detail, and inspect/clear the tile cache.
struct MapDownloadView: View {
    /// Session whose route to follow; nil → download unavailable (cache mgmt only).
    let token: String?

    @Environment(\.dismiss) private var dismiss
    private let zMin = 11
    @State private var zMax = 15
    @State private var corridorMeters: Double = 800
    @State private var tileCount = 0
    @State private var downloading = false
    @State private var done = 0
    @State private var total = 0
    @State private var cacheBytes: Int64 = 0
    @State private var cancel = CancelBox()

    private var polyline: [(lat: Double, lon: Double)]? {
        token.flatMap { PlanGeometry.routePolyline(forSession: $0) }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if polyline == nil {
                        Text("Aún no hay ruta con datos que descargar. Selecciona una previsión al compartir, o graba algo de recorrido.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    } else {
                        Picker("Detalle (zoom máx.)", selection: $zMax) {
                            ForEach([13, 14, 15, 16], id: \.self) { Text(zoomLabel($0)).tag($0) }
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text("Ancho del corredor").foregroundStyle(Theme.slate100)
                                Spacer()
                                Text("\(Int(corridorMeters)) m").foregroundStyle(Theme.slate400)
                            }
                            Slider(value: $corridorMeters, in: 250...2000, step: 50)
                        }
                        Text("≈ \(tileCount) tiles · ≈ \(sizeLabel(TileCache.estimatedBytes(tileCount: tileCount)))")
                            .font(.caption).foregroundStyle(Theme.slate400)
                        if downloading {
                            ProgressView(value: Double(done), total: Double(max(1, total)))
                                .tint(Theme.sky500)
                            Text("\(done) / \(total)").font(.caption).foregroundStyle(Theme.slate400)
                            Button("Cancelar", role: .destructive) { cancel.flag = true }
                        } else {
                            Button("Descargar corredor") { startDownload() }
                                .disabled(tileCount == 0)
                        }
                    }
                } header: {
                    Text("Descargar mapa de la ruta").foregroundStyle(Theme.slate400)
                }
                .listRowBackground(Theme.slate900)

                Section {
                    LabeledContent("Ocupa", value: sizeLabel(cacheBytes))
                    Button("Vaciar caché de mapas", role: .destructive) {
                        TileCache.shared.clear(); refreshCache()
                    }
                } header: {
                    Text("Caché de mapas").foregroundStyle(Theme.slate400)
                }
                .listRowBackground(Theme.slate900)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.slate950)
            .navigationTitle("Mapa offline")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Listo") { dismiss() }.tint(Theme.sky500)
                }
            }
            .onAppear { refreshEstimate(); refreshCache() }
            .onChange(of: zMax) { _ in refreshEstimate() }
            .onChange(of: corridorMeters) { _ in refreshEstimate() }
        }
    }

    private func startDownload() {
        guard let poly = polyline else { return }
        downloading = true; cancel.flag = false; done = 0; total = tileCount
        let box = cancel
        Task {
            await TileCache.shared.downloadCorridor(
                polyline: poly, corridorMeters: corridorMeters, zMin: zMin, zMax: zMax,
                progress: { d, t in Task { @MainActor in done = d; total = t } },
                isCancelled: { box.flag }
            )
            await MainActor.run { downloading = false; refreshCache() }
        }
    }

    /// Estimate tile count off the main thread (the set build can be sizeable).
    private func refreshEstimate() {
        guard let poly = polyline else { tileCount = 0; return }
        let (w, zx, zn) = (corridorMeters, zMax, zMin)
        Task.detached {
            let n = TileCache.corridorTiles(polyline: poly, corridorMeters: w, zMin: zn, zMax: zx).count
            await MainActor.run { tileCount = n }
        }
    }

    private func refreshCache() { cacheBytes = TileCache.shared.cacheSizeBytes() }

    private func zoomLabel(_ z: Int) -> String {
        switch z {
        case 13: return "z13 · básico"
        case 14: return "z14 · medio"
        case 15: return "z15 · alto"
        default: return "z16 · máximo"
        }
    }

    private func sizeLabel(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}
