-- De qué va la previsión: 'walk' | 'run' | 'bike'. Ya viaja dentro del blob
-- comprimido (paceConfig.activity), pero el servidor no lo abre nunca — y la
-- baliza necesita saberlo SIN descargar el recorrido entero, para heredarlo al
-- elegir la previsión igual que hereda la hora de salida.
ALTER TABLE plans ADD COLUMN activity TEXT;
