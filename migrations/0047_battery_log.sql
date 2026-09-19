-- La batería de la baliza a lo largo de la sesión: [[epoch ms, %], ...], una
-- entrada cada vez que el porcentaje CAMBIA. Con solo el último valor se sabe
-- cuánto le queda, pero no a qué ritmo se gasta, que es lo que dice si le va a
-- durar la carrera.
ALTER TABLE tracking_sessions ADD COLUMN battery_log TEXT;
