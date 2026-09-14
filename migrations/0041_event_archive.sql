-- Guardar un evento: cuándo se archivó por última vez lo que caduca —el replay
-- de todos, el recorrido y la foto—. NULL = nunca. Ver functions/lib/archivo.ts.
ALTER TABLE events ADD COLUMN archived_at INTEGER;
