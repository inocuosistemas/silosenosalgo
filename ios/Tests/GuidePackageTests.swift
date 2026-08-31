import XCTest
import ZIPFoundation
@testable import SiLoSeNoSalgo

final class GuidePackageTests: XCTestCase {
    func testPackageRoundTripPreservesRouteNotesPlanAndMedia() throws {
        let sourceId = "test_\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        let importedId = "guide_\(sourceId)"
        defer {
            LocalStore.remove(sourceId)
            LocalStore.remove(importedId)
        }

        let trail = [
            TrailPoint(t: 1_720_000_000_000, lat: 42.12, lon: -8.42, a: 4),
            TrailPoint(t: 1_720_000_060_000, lat: 42.13, lon: -8.41, a: 5),
        ]
        let noteId = "note_1"
        let notes = [Note(
            id: noteId,
            createdAt: 1_720_000_030_000,
            fixAt: 1_720_000_030_000,
            lat: 42.125,
            lon: -8.415,
            accuracy: 4,
            altitude: 320,
            trackKm: 1.25,
            distM: 1_250,
            title: "Mirador",
            body: "Parada de prueba",
            poiType: "viewpoint",
            poiSym: nil,
            audioKey: "\(noteId)_audio.m4a",
            photoKey: "\(noteId)_photo.jpg"
        )]
        let plan = Data([0x1f, 0x8b, 0x08, 0x00])
        let photo = Data("fake-jpeg".utf8)
        let audio = Data("fake-m4a".utf8)

        try JSONEncoder().encode(trail).write(to: LocalStore.trailURL(sourceId), options: .atomic)
        try JSONEncoder().encode(notes).write(to: LocalStore.notesURL(sourceId), options: .atomic)
        try plan.write(to: LocalStore.planURL(sourceId), options: .atomic)
        try photo.write(to: LocalStore.mediaFileURL(sourceId, "\(noteId)_photo.jpg"), options: .atomic)
        try audio.write(to: LocalStore.mediaFileURL(sourceId, "\(noteId)_audio.m4a"), options: .atomic)

        let session = TrackSessionSummary(
            id: sourceId,
            title: "Guía de prueba",
            planName: "Ruta de prueba",
            status: "ended",
            startedAt: trail[0].t,
            expiresAt: trail[1].t,
            updatedAt: trail[1].t,
            endedAt: trail[1].t,
            pinned: true,
            activity: nil
        )

        let packageURL = try GuideArchive.export(session: session)
        defer { try? FileManager.default.removeItem(at: packageURL) }
        XCTAssertEqual(packageURL.pathExtension, "slsnsguide")

        let guide = try GuideArchive.importPackage(from: packageURL)
        XCTAssertEqual(guide.id, importedId)
        XCTAssertEqual(guide.title, "Guía de prueba")
        XCTAssertEqual(guide.noteCount, 1)
        XCTAssertEqual(guide.mediaCount, 2)

        let importedTrail = try JSONDecoder().decode(
            [TrailPoint].self,
            from: Data(contentsOf: LocalStore.trailURL(importedId))
        )
        let importedNotes = try JSONDecoder().decode(
            [Note].self,
            from: Data(contentsOf: LocalStore.notesURL(importedId))
        )
        XCTAssertEqual(importedTrail.count, trail.count)
        XCTAssertEqual(importedTrail.last?.lat, trail.last?.lat)
        XCTAssertEqual(importedNotes.first?.photoKey, "\(noteId)_photo.jpg")
        XCTAssertEqual(importedNotes.first?.audioKey, "\(noteId)_audio.m4a")
        XCTAssertEqual(try Data(contentsOf: LocalStore.planURL(importedId)), plan)
        XCTAssertEqual(
            try Data(contentsOf: LocalStore.mediaFileURL(importedId, "\(noteId)_photo.jpg")),
            photo
        )
        XCTAssertEqual(
            try Data(contentsOf: LocalStore.mediaFileURL(importedId, "\(noteId)_audio.m4a")),
            audio
        )
    }

    func testImportRejectsUnsafeMediaNoteId() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("unsafe-guide-\(UUID().uuidString)")
        let packageURL = fm.temporaryDirectory.appendingPathComponent("unsafe-\(UUID().uuidString).slsnsguide")
        defer {
            try? fm.removeItem(at: root)
            try? fm.removeItem(at: packageURL)
        }
        try fm.createDirectory(at: root.appendingPathComponent("media"), withIntermediateDirectories: true)
        try Data("[]".utf8).write(to: root.appendingPathComponent("trail.json"))
        try Data("[]".utf8).write(to: root.appendingPathComponent("notes.json"))
        try Data("photo".utf8).write(to: root.appendingPathComponent("media/photo.jpg"))
        let manifest = """
        {
          "format": "slsnsguide",
          "version": 1,
          "id": "unsafe-test",
          "title": "Unsafe",
          "startedAt": 1720000000000,
          "endedAt": null,
          "exportedAt": 1720000000000,
          "trailPath": "trail.json",
          "notesPath": "notes.json",
          "planPath": null,
          "media": [{
            "noteId": "../../escape",
            "kind": "photo",
            "path": "media/photo.jpg",
            "mimeType": "image/jpeg"
          }]
        }
        """
        try Data(manifest.utf8).write(to: root.appendingPathComponent("manifest.json"))
        try fm.zipItem(at: root, to: packageURL, shouldKeepParent: false)

        XCTAssertThrowsError(try GuideArchive.importPackage(from: packageURL)) { error in
            guard let packageError = error as? GuidePackageError else {
                return XCTFail("Unexpected error: \(error)")
            }
            guard case .invalidPackage = packageError else {
                return XCTFail("Expected invalidPackage, got \(packageError)")
            }
        }
    }
}
