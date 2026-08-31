-- Dorsal de cada participante, y los enlaces oficiales de la carrera.
--
-- EL DORSAL es el número por el que te conocen ese día: es lo que grita la
-- familia, lo que sale en la clasificación oficial y lo que hay que teclear en
-- la web de la organización para buscarte. Sin él, cruzar lo que se ve aquí con
-- lo que publica la carrera obliga a acordarse de memoria de quién llevaba qué.
--
-- Lo pone cada uno para sí, y el organizador para cualquiera: los dorsales
-- suelen repartirse todos juntos en la recogida, y quien los tiene delante en
-- una lista es quien organiza. Va como TEXTO y no como número: hay carreras que
-- los reparten con letra de categoría ("A-142", "M35-07").
--
-- LOS ENLACES son de la organización, no nuestros: el seguimiento oficial (esas
-- webs de dorsales con los tiempos de cada control) y la web de la carrera. No
-- competimos con ellos — hacen cosas distintas —, y tener que buscarlos aparte
-- cuando ya estás mirando este mapa es un trabajo tonto. Solo los pone el
-- organizador, y solo se guardan si son http(s): un enlace es algo que otros
-- van a tocar.

ALTER TABLE event_members ADD COLUMN bib TEXT;
ALTER TABLE events ADD COLUMN tracking_url TEXT;
ALTER TABLE events ADD COLUMN website_url TEXT;
