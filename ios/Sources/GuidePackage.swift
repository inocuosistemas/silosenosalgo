import Foundation
import SwiftUI
import UniformTypeIdentifiers
import ZIPFoundation
import UIKit

extension UTType {
    static let slsnsGuide = UTType(exportedAs: "app.silosenosalgo.slsnsguide", conformingTo: .zip)
}

struct LocalGuide: Codable, Identifiable, Hashable {
    let id: String
    let sourceSessionId: String
    var title: String
    let startedAt: Double
    let endedAt: Double?
    let importedAt: Double
    let noteCount: Int
    let mediaCount: Int
}

private struct GuideMediaEntry: Codable {
    let noteId: String
    let kind: String
    let path: String
    let mimeType: String
}

private struct GuideManifest: Codable {
    let format: String
    let version: Int
    let id: String
    let title: String
    let startedAt: Double
    let endedAt: Double?
    let exportedAt: Double
    let trailPath: String
    let notesPath: String
    let planPath: String?
    let media: [GuideMediaEntry]
}

enum GuidePackageError: LocalizedError {
    case noLocalTrail
    case invalidPackage
    case unsupportedVersion

    var errorDescription: String? {
        switch self {
        case .noLocalTrail:
            return "Este seguimiento no tiene una traza local disponible para exportar."
        case .invalidPackage:
            return "El archivo no es una guía SiLoSeNoSalgo válida."
        case .unsupportedVersion:
            return "La versión de esta guía todavía no es compatible con la app."
        }
    }
}

enum GuideArchive {
    static let format = "slsnsguide"
    static let version = 1

    static func export(session: TrackSessionSummary) throws -> URL {
        let fm = FileManager.default
        let trailURL = LocalStore.trailURL(session.id)
        guard fm.fileExists(atPath: trailURL.path) else { throw GuidePackageError.noLocalTrail }

        let temp = fm.temporaryDirectory.appendingPathComponent("guide-export-\(UUID().uuidString)", isDirectory: true)
        let staging = temp.appendingPathComponent("contents", isDirectory: true)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: temp) }

        try fm.copyItem(at: trailURL, to: staging.appendingPathComponent("trail.json"))
        let notes: [Note]
        if let data = try? Data(contentsOf: LocalStore.notesURL(session.id)),
           let decoded = try? JSONDecoder().decode([Note].self, from: data) {
            notes = decoded
            try data.write(to: staging.appendingPathComponent("notes.json"), options: .atomic)
        } else {
            notes = []
            try JSONEncoder().encode(notes).write(to: staging.appendingPathComponent("notes.json"), options: .atomic)
        }

        var planPath: String?
        let planURL = LocalStore.planURL(session.id)
        if fm.fileExists(atPath: planURL.path) {
            planPath = "plan.gz"
            try fm.copyItem(at: planURL, to: staging.appendingPathComponent("plan.gz"))
        }

        var media: [GuideMediaEntry] = []
        let sourceMedia = LocalStore.mediaDir(session.id)
        let targetMedia = staging.appendingPathComponent("media", isDirectory: true)
        let files = (try? fm.contentsOfDirectory(at: sourceMedia, includingPropertiesForKeys: [.isRegularFileKey])) ?? []
        for file in files {
            let name = file.lastPathComponent
            let kind: String
            let noteId: String
            if name.hasSuffix("_photo.jpg") {
                kind = "photo"; noteId = String(name.dropLast("_photo.jpg".count))
            } else if name.hasSuffix("_audio.m4a") {
                kind = "audio"; noteId = String(name.dropLast("_audio.m4a".count))
            } else {
                continue
            }
            if !fm.fileExists(atPath: targetMedia.path) {
                try fm.createDirectory(at: targetMedia, withIntermediateDirectories: true)
            }
            try fm.copyItem(at: file, to: targetMedia.appendingPathComponent(name))
            media.append(GuideMediaEntry(
                noteId: noteId,
                kind: kind,
                path: "media/\(name)",
                mimeType: kind == "photo" ? "image/jpeg" : "audio/mp4"
            ))
        }

        let manifest = GuideManifest(
            format: format,
            version: version,
            id: session.id,
            title: session.title ?? "Guía sin nombre",
            startedAt: session.startedAt,
            endedAt: session.endedAt ?? session.updatedAt,
            exportedAt: Date().timeIntervalSince1970 * 1000,
            trailPath: "trail.json",
            notesPath: "notes.json",
            planPath: planPath,
            media: media
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(manifest).write(to: staging.appendingPathComponent("manifest.json"), options: .atomic)

        let filename = safeFilename(session.title ?? "guia") + ".slsnsguide"
        let destination = fm.temporaryDirectory.appendingPathComponent(filename)
        try? fm.removeItem(at: destination)
        try fm.zipItem(at: staging, to: destination, shouldKeepParent: false)
        return destination
    }

    static func importPackage(from sourceURL: URL) throws -> LocalGuide {
        let fm = FileManager.default
        let temp = fm.temporaryDirectory.appendingPathComponent("guide-import-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: temp) }
        try fm.unzipItem(at: sourceURL, to: temp)

        let manifestURL = temp.appendingPathComponent("manifest.json")
        guard let manifestData = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(GuideManifest.self, from: manifestData),
              manifest.format == format else { throw GuidePackageError.invalidPackage }
        guard manifest.version == version else { throw GuidePackageError.unsupportedVersion }
        guard isSafeRelativePath(manifest.trailPath), isSafeRelativePath(manifest.notesPath) else {
            throw GuidePackageError.invalidPackage
        }

        let trailSource = temp.appendingPathComponent(manifest.trailPath)
        let notesSource = temp.appendingPathComponent(manifest.notesPath)
        guard let trailData = try? Data(contentsOf: trailSource),
              (try? JSONDecoder().decode([TrailPoint].self, from: trailData)) != nil,
              let notesData = try? Data(contentsOf: notesSource),
              var notes = try? JSONDecoder().decode([Note].self, from: notesData) else {
            throw GuidePackageError.invalidPackage
        }

        let localId = "guide_" + manifest.id.replacingOccurrences(
            of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression
        )
        LocalStore.remove(localId)
        try trailData.write(to: LocalStore.trailURL(localId), options: .atomic)

        var copiedMedia = 0
        for item in manifest.media where (item.kind == "photo" || item.kind == "audio") {
            guard isSafeRelativePath(item.path), isSafeFileComponent(item.noteId) else {
                throw GuidePackageError.invalidPackage
            }
            let source = temp.appendingPathComponent(item.path)
            guard fm.fileExists(atPath: source.path) else { continue }
            let expectedName = "\(item.noteId)_\(item.kind).\(item.kind == "photo" ? "jpg" : "m4a")"
            try fm.copyItem(at: source, to: LocalStore.mediaFileURL(localId, expectedName))
            if let index = notes.firstIndex(where: { $0.id == item.noteId }) {
                if item.kind == "photo" { notes[index].photoKey = expectedName }
                else { notes[index].audioKey = expectedName }
            }
            copiedMedia += 1
        }
        try JSONEncoder().encode(notes).write(to: LocalStore.notesURL(localId), options: .atomic)

        if let planPath = manifest.planPath {
            guard isSafeRelativePath(planPath) else { throw GuidePackageError.invalidPackage }
            let source = temp.appendingPathComponent(planPath)
            if fm.fileExists(atPath: source.path) {
                try fm.copyItem(at: source, to: LocalStore.planURL(localId))
            }
        }

        return LocalGuide(
            id: localId,
            sourceSessionId: manifest.id,
            title: manifest.title,
            startedAt: manifest.startedAt,
            endedAt: manifest.endedAt,
            importedAt: Date().timeIntervalSince1970 * 1000,
            noteCount: notes.count,
            mediaCount: copiedMedia
        )
    }

    private static func safeFilename(_ value: String) -> String {
        let clean = value.folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^A-Za-z0-9_-]+", with: "_", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        return clean.isEmpty ? "guia" : String(clean.prefix(80))
    }

    private static func isSafeRelativePath(_ path: String) -> Bool {
        !path.isEmpty && !path.hasPrefix("/") && !path.split(separator: "/").contains("..")
    }

    private static func isSafeFileComponent(_ value: String) -> Bool {
        !value.isEmpty && value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    }
}

@MainActor
final class GuideLibrary: ObservableObject {
    static let shared = GuideLibrary()
    @Published private(set) var guides: [LocalGuide] = []
    @Published var presentedGuide: LocalGuide?
    @Published var importError: String?

    private let key = "localGuides-v1"

    var storageIds: Set<String> { Set(guides.map(\.id)) }

    private init() {
        if let data = UserDefaults.standard.data(forKey: key),
           let decoded = try? JSONDecoder().decode([LocalGuide].self, from: data) {
            guides = decoded.sorted { $0.importedAt > $1.importedAt }
        }
    }

    func export(session: TrackSessionSummary) async throws -> URL {
        try await Task.detached(priority: .userInitiated) {
            try GuideArchive.export(session: session)
        }.value
    }

    func importGuide(from url: URL) async throws -> LocalGuide {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let guide = try await Task.detached(priority: .userInitiated) {
            try GuideArchive.importPackage(from: url)
        }.value
        guides.removeAll { $0.id == guide.id }
        guides.insert(guide, at: 0)
        persist()
        return guide
    }

    func openImportedGuide(from url: URL) async {
        do {
            let guide = try await importGuide(from: url)
            try prepareForViewing(guide)
            presentedGuide = guide
        } catch {
            importError = error.localizedDescription
        }
    }

    func delete(_ guide: LocalGuide) {
        LocalStore.remove(guide.id)
        guides.removeAll { $0.id == guide.id }
        persist()
    }

    func prepareForViewing(_ guide: LocalGuide) throws {
        let trailData = try Data(contentsOf: LocalStore.trailURL(guide.id))
        let trail = try JSONDecoder().decode([TrailPoint].self, from: trailData)
        let notes = (try? Data(contentsOf: LocalStore.notesURL(guide.id)))
            .flatMap { try? JSONDecoder().decode([Note].self, from: $0) } ?? []
        let last = trail.last
        let fix = last.map {
            TrackFixWire(lat: $0.lat, lon: $0.lon, trackKm: nil, speed: nil, heading: nil,
                         accuracy: $0.a.map(Double.init), altitude: nil, fixAt: $0.t, updatedAt: $0.t)
        }
        ViewerDataProvider.shared.register(
            token: guide.id, title: guide.title, startedAt: guide.startedAt,
            expiresAt: .greatestFiniteMagnitude, status: "ended"
        )
        ViewerDataProvider.shared.update(token: guide.id, fix: fix, reportedFix: nil, trail: trail)
        ViewerDataProvider.shared.setNotes(token: guide.id, notes: notes)
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(guides) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}

struct GuideShareItem: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

struct GuideShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
