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

/// Offline map management: pre-download a corridor of tiles around a route at a
/// chosen detail, SEE what's already cached (green layer on a preview map + a
/// count), and inspect/clear the cache. Reachable before sharing (from the route
/// picker) so you can prepare the map the night before.
struct MapDownloadView: View {
    let routeName: String?
    /// Route to follow; nil → download unavailable (cache management only).
    let polyline: [(lat: Double, lon: Double)]?

    @Environment(\.dismiss) private var dismiss
    private let zMin = 11
    @State private var zMax = 15
    @State private var corridorMeters: Double = 800
    @State private var tileCount = 0
    @State private var cachedCount = 0
    @State private var coverage: [TileKey] = []
    @State private var downloading = false
    @State private var done = 0
    @State private var total = 0
    @State private var cacheBytes: Int64 = 0
    @State private var cancel = CancelBox()

    private var complete: Bool { tileCount > 0 && cachedCount >= tileCount }
    private var remaining: Int { max(0, tileCount - cachedCount) }

    var body: some View {
        NavigationStack {
            Form {
                if let poly = polyline {
                    Section {
                        CoverageMap(polyline: poly, coverage: coverage)
                            .frame(height: 200)
                            .listRowInsets(EdgeInsets())
                    } footer: {
                        Text("Verde = mapa ya descargado (offline). La línea azul es tu ruta.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    }
                    .listRowBackground(Theme.slate900)
                }

                Section {
                    if polyline == nil {
                        Text("No hay ruta que descargar. Elige una previsión (con conexión) para preparar su mapa.")
                            .font(.caption).foregroundStyle(Theme.slate400)
                    } else {
                        if let n = routeName {
                            LabeledContent("Ruta", value: n)
                        }
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
                        if complete {
                            Label("Corredor descargado · \(tileCount) tiles", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        } else {
                            Text("≈ \(tileCount) tiles · ≈ \(sizeLabel(TileCache.estimatedBytes(tileCount: tileCount))) · en caché: \(cachedCount) de \(tileCount)")
                                .font(.caption).foregroundStyle(Theme.slate400)
                        }
                        if downloading {
                            ProgressView(value: Double(done), total: Double(max(1, total))).tint(Theme.sky500)
                            Text("\(done) / \(total)").font(.caption).foregroundStyle(Theme.slate400)
                            Button("Cancelar", role: .destructive) { cancel.flag = true }
                        } else {
                            Button(complete ? "Volver a descargar" : (remaining > 0 && remaining < tileCount ? "Descargar (faltan \(remaining))" : "Descargar corredor")) {
                                startDownload()
                            }
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
                        TileCache.shared.clear(); refreshCache(); refreshEstimate()
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
            await MainActor.run { downloading = false; refreshCache(); refreshEstimate() }
        }
    }

    /// Recompute the corridor size, how much is already cached, and the coverage
    /// layer — off the main thread (the set build + disk checks can be sizeable).
    private func refreshEstimate() {
        guard let poly = polyline else { tileCount = 0; cachedCount = 0; coverage = []; return }
        let (w, zx, zn) = (corridorMeters, zMax, zMin)
        Task.detached {
            let set = TileCache.corridorTiles(polyline: poly, corridorMeters: w, zMin: zn, zMax: zx)
            let cached = TileCache.shared.cachedTiles(in: set)
            let cov = TileCache.shared.cachedCoverage(polyline: poly)
            await MainActor.run { tileCount = set.count; cachedCount = cached; coverage = cov }
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
