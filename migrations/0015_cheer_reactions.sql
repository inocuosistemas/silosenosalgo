-- Reacciones con emoji sobre los animos, en vez de un unico corazon.
--
-- Se añade el emoji a la fila que ya existia: la clave primaria sigue siendo
-- (mensaje, seguidor), asi que cada persona sigue teniendo UNA reaccion por
-- mensaje. Tocar otro emoji la cambia, tocar el mismo la quita. Es el modelo de
-- WhatsApp, y ademas conserva la propiedad que hacia que el contador
-- significara algo: nadie puede sumar de mas.
--
-- Los "me gusta" que ya habia pasan a corazon, que es lo que eran.
ALTER TABLE cheer_likes ADD COLUMN emoji TEXT NOT NULL DEFAULT '❤️';
