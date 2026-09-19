-- Lo que quien organiza cambia de los puntos del recorrido EN EL EVENTO, sin
-- volver a publicar la ruta: qué es cada uno (avituallamiento, bolsa…) y cuánto
-- se para. {"<km con 2 decimales>": {"aid": "liquido", "pausa": 3}}.
ALTER TABLE events ADD COLUMN puntos_ajustes TEXT;
