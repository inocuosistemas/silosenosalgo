-- Las salidas de carrera que nacieron sin nombre se llaman como su carrera.
--
-- Hasta ahora la sesión solo guardaba el `event_id`, y el nombre lo resolvía
-- cada app mirando su lista de eventos. Eso se rompe justo cuando más falta
-- hace: la lista no trae los eventos terminados, así que al cerrar la carrera
-- las salidas de ese día pasaban a leerse "Sin nombre" en "Mis seguimientos".
--
-- Desde ahora el nombre se hereda al crear la sesión (functions/api/track);
-- esto arregla las que ya estaban. Solo toca las que no tienen título propio:
-- un nombre puesto a mano es del dueño y no se pisa.
UPDATE tracking_sessions
   SET title = (SELECT e.name FROM events e WHERE e.id = tracking_sessions.event_id)
 WHERE title IS NULL
   AND event_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM events e WHERE e.id = tracking_sessions.event_id);
