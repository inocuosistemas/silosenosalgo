-- Las notas de la carrera: lo que quien organiza tiene que contarle a todos.
--
-- Hasta ahora el evento tenía nombre, foto, recorrido y enlaces, y todo lo
-- demás —dónde está la bolsa de vida, a qué hora abre el autobús, que el
-- avituallamiento del km 42 no tiene agua caliente— acababa en el grupo de
-- chat, que es donde la información va a morir: se hunde bajo cien mensajes y
-- el día de la carrera nadie la encuentra.
--
-- Texto suelto y no campos con estructura (horarios, listas, avituallamientos)
-- a propósito: no sabemos qué necesita contar cada organización, y un formulario
-- con los campos equivocados se rellena mal o no se rellena. Un cuadro de texto
-- se adapta a cualquier carrera.
--
-- Solo lo escribe quien organiza y lo leen los participantes: no es un tablón
-- de mensajes ni un chat. Para hablar entre todos ya está el grupo de siempre.

PRAGMA foreign_keys = ON;

ALTER TABLE events ADD COLUMN notes TEXT;
