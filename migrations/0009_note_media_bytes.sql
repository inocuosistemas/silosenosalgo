-- Byte sizes of a note's uploaded media (audio/photo), so per-user storage use
-- can be summed cheaply for the app's storage meter (KV holds the bytes, D1 the
-- accounting). NULL until the media is uploaded; the media PUT sets them, and
-- the note/session DELETE (ON DELETE CASCADE) drops the row — so the SUM tracks
-- what's actually stored. Nullable INTEGER, added like the other note media cols.
ALTER TABLE track_notes ADD COLUMN audio_bytes INTEGER;
ALTER TABLE track_notes ADD COLUMN photo_bytes INTEGER;
