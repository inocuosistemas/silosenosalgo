-- Ventana de arrepentimiento de los animos.
--
-- Durante unos segundos tras enviarlo, el mensaje solo lo ve quien lo escribio y
-- puede borrarlo; pasado ese plazo se publica para todos y ya no se puede
-- retirar. Sirve para cazar el mensaje a medias o el dedazo antes de que lo lea
-- nadie, sin abrir la puerta a borrar cosas que otros ya han visto (o votado).
--
-- Hacen falta dos datos:
--   viewer_id  quien lo escribio, para enseñarselo solo a el y dejarle borrar.
--              Es el id anonimo por navegador, el mismo que identifica votos: no
--              hay cuentas, asi que es lo mas parecido a "esa persona".
--   publish_at cuando pasa a ser publico. Se guarda el INSTANTE y no un booleano
--              "publicado" a proposito: asi nadie tiene que ir marcandolo luego,
--              cada consulta lo compara con la hora y ya esta.
--
-- Los animos que ya existian se dan por publicados (publish_at = created_at) y
-- sin autor conocido, que es exactamente como se han comportado hasta ahora.
ALTER TABLE track_cheers ADD COLUMN viewer_id TEXT;
ALTER TABLE track_cheers ADD COLUMN publish_at INTEGER;
UPDATE track_cheers SET publish_at = created_at WHERE publish_at IS NULL;
CREATE INDEX idx_cheers_session_publish ON track_cheers(session_id, publish_at);
