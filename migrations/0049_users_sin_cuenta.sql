-- Corredores SIN BALIZA dados de alta por quien organiza: tienen una fila en
-- users para que todo lo del evento (parrilla, mapa, resultados, porra) funcione
-- igual, pero no son una cuenta de nadie y NO pueden entrar: sin contraseña
-- válida, y login, pases y restablecer contraseña los rechazan.
ALTER TABLE users ADD COLUMN sin_cuenta INTEGER NOT NULL DEFAULT 0;
