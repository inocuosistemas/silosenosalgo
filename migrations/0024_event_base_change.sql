-- Cuándo cambió el recorrido del evento, y qué cambió.
--
-- Republicar la base no invalida la planificación de nadie: las horas de paso
-- no se guardan, se calculan, así que un punto que pasa del km 42 al 44,3
-- recibe su hora nueva solo. Lo que cambia es el VEREDICTO —ese corte está
-- ahora 2,3 km más lejos— y eso le pasa a todo el mundo, incluido quien nunca
-- tocó un objetivo por tramo.
--
-- Así que no se borra nada de nadie: se DESCRIBE el cambio y cada uno decide.
-- Con dos columnas basta:
--   · `plan_updated_at` dice si la previsión que alguien guardó es anterior al
--     recorrido actual, que es toda la señal que hace falta para avisarle;
--   · `plan_change` guarda el resumen ("Paules Altas: 42,0 → 44,3") para poder
--     contarlo sin recalcular nada.
--
-- El resumen lo calcula el cliente que publica, que es quien tiene delante las
-- dos versiones del recorrido; aquí se guarda como texto y no se abre nunca,
-- igual que los payloads. Es dato de otra persona: quien lo pinta lo valida.

PRAGMA foreign_keys = ON;

ALTER TABLE events ADD COLUMN plan_updated_at INTEGER;  -- epoch ms de la última publicación
ALTER TABLE events ADD COLUMN plan_change     TEXT;     -- resumen JSON del último cambio
