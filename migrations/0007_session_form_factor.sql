-- Runner-confirmed live "form factor": the viewer scales the projected remaining
-- time by it (1 = the plan). The owner confirms it from the app when a change of
-- form is real (not circumstantial); it propagates to followers via the public
-- track state so everyone's forecast + cut-off margins agree.
--   form_factor: current confirmed factor (default 1 = the plan).
--   form_log:    JSON array of confirmations [{ t, km, factor }] (bounded), so the
--                viewer can chart WHEN form changed along the route.
ALTER TABLE tracking_sessions ADD COLUMN form_factor REAL NOT NULL DEFAULT 1;
ALTER TABLE tracking_sessions ADD COLUMN form_log TEXT;
