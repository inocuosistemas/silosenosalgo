-- Enlace público del evento: para quien espera en meta.
--
-- El mapa del evento es solo para participantes, y eso deja fuera justo a
-- quien más mira: la familia. Hasta ahora la única salida era pasarles el
-- enlace individual de cada corredor, uno a uno, y que fueran saltando entre
-- pestañas para saber quién va dónde.
--
-- Es un token APARTE del id del evento, y no el id a secas, para que compartir
-- se pueda deshacer: se revoca poniéndolo a NULL o regenerándolo, y el lobby
-- —donde se eligen colores, se ve el código de invitación y se administra—
-- sigue sin abrirse a nadie. NULL = el evento no está publicado.
--
-- Lo que se sirve por ese enlace es un recorte: nombres, colores y posiciones,
-- sin ids de cuenta y sin los tokens de las balizas de cada uno. Publicar el
-- evento lo decide el organizador; publicar la baliza propia sigue siendo
-- decisión de cada participante, y una cosa no debe arrastrar a la otra.

ALTER TABLE events ADD COLUMN public_token TEXT;
CREATE UNIQUE INDEX idx_events_public_token ON events(public_token);
