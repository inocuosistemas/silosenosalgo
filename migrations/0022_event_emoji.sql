-- La marca de cada participante: un emoji suyo, y el color como grupo.
--
-- El color era el identificador y la BD impedía repetirlo, así que un evento se
-- quedaba sin sitio en el participante número trece. Para cien corredores el
-- eje tiene que cambiar: identifica el EMOJI —único de verdad, y encima con
-- gracia— y el color pasa a separar grupos de un vistazo, pudiendo repetirse.
-- La pareja sigue siendo única porque el emoji lo es por sí solo.
--
-- Se guardan DOS columnas para una sola cosa, y es a propósito: `emoji` es lo
-- que se ve, tal cual lo eligió su dueño, y `emoji_key` es lo que se compara,
-- sin tono de piel ni selector de variación (ver shared/emoji.ts). 👍 y 👍🏽 son
-- códigos distintos y el mismo dibujo a tamaño de mapa: sin plegarlos, dos
-- personas llevarían la misma marca creyendo cada una que la suya era única.
--
-- Los favoritos viven en `users` y no en el evento: quien es 🦊 en su club
-- quiere ser 🦊 en todas las carreras, y tener que elegirlo otra vez en cada
-- evento es justo la clase de trámite que se salta la gente. Al entrar se
-- intentan; si el emoji ya lo lleva otro en ESE evento, se entra con otro y el
-- lobby lo dice.

PRAGMA foreign_keys = ON;

ALTER TABLE event_members ADD COLUMN emoji     TEXT;  -- lo que se ve; NULL = sin marca todavía
ALTER TABLE event_members ADD COLUMN emoji_key TEXT;  -- lo que se compara (foldEmoji)

-- Dos participantes del mismo evento no pueden llevar el mismo emoji: es lo que
-- distingue un punto de otro en el mapa. Lo impone la BD y no solo la interfaz,
-- porque dos personas pueden elegir el mismo en el mismo segundo. SQLite trata
-- los NULL como distintos entre sí, así que caben todos los "sin marca" que
-- hagan falta.
CREATE UNIQUE INDEX idx_event_members_emoji ON event_members(event_id, emoji_key);

-- Y el color deja de ser exclusivo. Es un índice, no datos: no se pierde nada.
DROP INDEX idx_event_members_color;

-- Reservar los colores: por defecto los elige cada uno (0). Con esto en 1 solo
-- los reparte el organizador, que es lo que hace falta cuando el color deja de
-- ser un gusto y pasa a significar algo —el club, el relevo, la categoría— y no
-- puede depender de que a nadie se le antoje cambiárselo la víspera.
ALTER TABLE events ADD COLUMN colors_locked INTEGER NOT NULL DEFAULT 0;

-- La marca favorita, la que se intenta al entrar en cualquier evento.
ALTER TABLE users ADD COLUMN fav_emoji TEXT;
ALTER TABLE users ADD COLUMN fav_color TEXT;
