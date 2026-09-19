-- La hora de META OFICIAL de cada participante, la del cronometraje de la
-- organización (epoch ms, al segundo). Manda sobre la de la baliza y la del
-- paso manual: cuando dos llegan pegados, el GPS no sabe quién entró antes y
-- la alfombra sí. NULL = no hay tiempo oficial.
ALTER TABLE event_members ADD COLUMN oficial_meta_at INTEGER;
