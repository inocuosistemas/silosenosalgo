-- Los dispositivos a los que se puede avisar de verdad.
--
-- Hasta ahora los ánimos solo sonaban si la app estaba viva: el aviso lo ponía
-- el propio móvil después de preguntar al servidor cada 30 s, y ese sondeo
-- cuelga del reloj de la baliza. Sin baliza —o con la app cerrada— quien te
-- animaba no llegaba a ninguna parte, que es justo lo contrario de la gracia de
-- un ánimo: llegar cuando llega.
--
-- Una fila por DISPOSITIVO y no por usuario: la misma cuenta puede tener el
-- móvil y el iPad, y los dos tienen que sonar. El token es la clave primaria
-- porque es lo que identifica al aparato de cara a Apple, y porque reinstalar
-- la app da un token nuevo: el viejo deja de valer y se borra solo en cuanto
-- Apple lo rechaza (ver `functions/lib/apns.ts`).
--
-- `platform` se guarda aunque hoy solo haya iOS: el día que Android entre por
-- FCM, el envío tiene que saber a qué puerta llamar, y añadir la columna
-- entonces obligaría a migrar filas vivas.
CREATE TABLE IF NOT EXISTS push_devices (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL DEFAULT 'ios',
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- El envío pregunta siempre lo mismo: "¿qué aparatos tiene este usuario?".
CREATE INDEX IF NOT EXISTS push_devices_by_user ON push_devices(user_id);
