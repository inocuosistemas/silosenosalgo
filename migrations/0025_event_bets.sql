-- La Porra: los espectadores pronostican, y no se juega dinero.
--
-- Un evento tiene dos públicos y hasta ahora solo servíamos a uno. Quien corre
-- tiene su carrera; quien mira —la familia en meta, el grupo de casa, el que se
-- quedó lesionado— tiene una pantalla de espera y tres horas por delante. La
-- porra es lo que hace esas tres horas divertidas: te mojas antes de la salida,
-- y luego cada punto que se mueve por el mapa te da o te quita razón.
--
-- Se apuesta ORGULLO. Aquí no hay dinero, ni fichas, ni nada que se parezca a
-- una casa de apuestas: hay un ranking de aciertos con corona para el primero.
-- Por eso tampoco hay cuotas ni momio: los puntos salen de acertar, no de lo
-- que arriesgue nadie.
--
-- Solo pronostican los que NO corren. Quien está en la parrilla decide con sus
-- piernas lo que los demás solo pueden adivinar, y una porra donde un jugador
-- controla el resultado deja de tener gracia. Y solo antes de la salida: a las
-- dos horas de carrera acertar quién acaba ya no tiene mérito.
--
-- Cada fila es UN pronóstico. `target_id` es el participante al que apunta;
-- vacío en las apuestas de la carrera entera (quién gana). La clave primaria
-- hace que repronosticar sea sobrescribir, no acumular.

PRAGMA foreign_keys = ON;

ALTER TABLE events ADD COLUMN bets_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE event_bets (
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  -- A quién apunta el pronóstico. '' = a la carrera entera (el ganador).
  target_id  TEXT NOT NULL DEFAULT '',
  -- 'winner' | 'finish' | 'finish_time'
  kind       TEXT NOT NULL,
  -- Texto siempre: 'si'/'no' o un epoch en ms. Lo interpreta quien puntúa.
  value      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id, kind, target_id)
) WITHOUT ROWID;

CREATE INDEX idx_event_bets_event ON event_bets(event_id);
