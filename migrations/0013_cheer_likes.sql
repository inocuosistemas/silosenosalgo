-- "Me gusta" sobre los mensajes de animo.
--
-- Una fila por (mensaje, seguidor) en vez de un contador suelto: con un simple
-- INTEGER que se incrementa no hay forma de saber quien ha votado, asi que
-- cualquiera podria pulsar cien veces y el contador dejaria de significar nada.
-- La clave primaria compuesta hace que el segundo like del mismo seguidor sobre
-- el mismo mensaje sea un conflicto y no un voto nuevo, y ademas permite quitar
-- el like (borrar la fila).
--
-- viewer_id es el id anonimo por navegador que ya se usa para contar seguidores
-- presentes: no hay cuentas, asi que es lo mas parecido a "una persona" de que
-- se dispone. Es del cliente y se puede rotar, por eso se guarda tambien el
-- hash de la IP y el endpoint limita por IP: rotar el id no da votos infinitos.
CREATE TABLE cheer_likes (
  cheer_id   TEXT NOT NULL REFERENCES track_cheers(id) ON DELETE CASCADE,
  viewer_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash    TEXT,
  PRIMARY KEY (cheer_id, viewer_id)
);
CREATE INDEX idx_cheer_likes_cheer ON cheer_likes(cheer_id);
