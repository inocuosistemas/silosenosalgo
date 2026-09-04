-- Cuándo se calcularon los resultados que hay guardados.
--
-- Hace falta para poder ir haciendo FOTOS provisionales mientras la carrera
-- está viva sin recalcularlas en cada visita: la parrilla se refresca cada
-- pocos segundos y leer las trazas de todos para no cambiar nada sería tirar
-- trabajo. Con la hora a mano, la comprobación es un número.
ALTER TABLE events ADD COLUMN stats_at INTEGER;
