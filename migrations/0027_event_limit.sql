-- El limite de tiempo de la carrera, en minutos.
--
-- La hora de cierre (`ends_at`) sale del ultimo corte del recorrido, y eso
-- funciona cuando el recorrido lleva cortes. Pero una carrera se anuncia casi
-- siempre al reves: "sale a las 8:00, tienes 8 horas". Con la salida publicada
-- y el limite puesto, la hora de cierre es una resta — no hay por que pedirle a
-- nadie que la calcule y la escriba.
--
-- `ends_at` sigue siendo la verdad —es contra lo que se cierra— y esto es otra
-- forma de fijarla: al tocar el limite o la salida se recalcula. Al reves
-- tambien: publicar un recorrido con cortes fija la hora y de ella se deduce el
-- limite, para poder enseñarlo ("limite 8h") sin volver a abrir el payload.

PRAGMA foreign_keys = ON;

ALTER TABLE events ADD COLUMN limit_min INTEGER;
