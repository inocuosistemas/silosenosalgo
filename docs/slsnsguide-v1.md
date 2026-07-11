# `.slsnsguide` format · version 1

An `.slsnsguide` file is a ZIP archive whose root contains a versioned manifest
and the data needed to view one completed tracking session offline. Map tiles are
deliberately excluded.

## Layout

```text
manifest.json
trail.json
notes.json
plan.gz          # optional planned-route SharePayload
media/           # optional
  <note-id>_photo.jpg
  <note-id>_audio.m4a
```

`trail.json` is a JSON array of `TrailPoint` and `notes.json` is a JSON array of
`TrackNote`, using the shapes in `shared/wireTypes.ts`. `plan.gz`, when present,
is the same gzipped `SharePayload` used by shared plans.

## Manifest

```json
{
  "format": "slsnsguide",
  "version": 1,
  "id": "source-session-id",
  "title": "Trip title",
  "startedAt": 1710000000000,
  "endedAt": 1710003600000,
  "exportedAt": 1710007200000,
  "trailPath": "trail.json",
  "notesPath": "notes.json",
  "planPath": "plan.gz",
  "media": [
    {
      "noteId": "note-id",
      "kind": "photo",
      "path": "media/note-id_photo.jpg",
      "mimeType": "image/jpeg"
    }
  ]
}
```

All timestamps are Unix epoch milliseconds. `endedAt` and `planPath` may be
`null`. Importers must reject absolute paths and `..` path components, and must
ignore unknown files. A reader must reject unsupported major `version` values.

## Portability

The archive contains the planned route, recorded trail, notes, photos and voice
notes as actual files. It does not depend on public tracking URLs or media URLs.
Tiles remain an external cache managed by each viewer.
