-- Las correcciones a mano de los tramos por medio de transporte de una salida
-- en «Automático» (ver src/lib/tramosDeTransporte.ts): JSON con
-- [{ desde, hasta, modo }], por horas y no por tramo, porque los tramos se
-- recalculan y la hora no cambia. NULL = ninguna.
ALTER TABLE tracking_sessions ADD COLUMN tramos_ajustes TEXT;
