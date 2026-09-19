-- Modo manual de un corredor: sus pasos por los controles, anotados por quien
-- organiza (de la app de cronometraje de la carrera) cuando su baliza no
-- funciona. [[km, epoch ms], ...]. NULL = modo normal (manda la baliza).
ALTER TABLE event_members ADD COLUMN manual_pasos TEXT;
-- Y cómo está el móvil que emite, además de su batería: modo ahorro (1/0) y
-- estado térmico ('nominal' | 'fair' | 'serious' | 'critical').
ALTER TABLE tracking_sessions ADD COLUMN power_saving INTEGER;
ALTER TABLE tracking_sessions ADD COLUMN thermal TEXT;
