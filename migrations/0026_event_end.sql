-- Que una carrera se acabe.
--
-- `events.ended_at` existia desde el principio y la leia medio mundo —quien
-- intenta unirse con el codigo, las dos apps para no ofrecer una carrera
-- pasada— pero NADIE la escribia nunca: no habia forma de terminar un evento,
-- ni a mano ni sola. Un evento de hace tres meses seguia admitiendo gente y
-- pidiendole a la app que emitiera.
--
-- Se cierra de dos maneras y las dos hacen falta:
--
--   · SOLA, cuando pasa `ends_at` — la hora a la que cierra meta. Sale del
--     ultimo cierre del recorrido, que es lo que define hasta cuando hay
--     carrera, y la calcula quien publica la base (el servidor no abre nunca
--     el payload). Sin cierres no hay hora limite y entonces no se cierra
--     sola: una quedada de los martes no termina a ninguna hora.
--
--   · A MANO, por quien organiza, que es lo unico que vale cuando no hay hora
--     limite —o cuando la carrera se suspende a mitad—.
--
-- No hay cron: se cierra al primer vistazo posterior a la hora, igual que las
-- sesiones caducadas se dan por terminadas cuando alguien las mira. Un evento
-- que nadie mira da igual que siga abierto un rato mas.
--
-- Al cerrarse se congelan las ESTADISTICAS en `stats`. No es un adorno: las
-- trazas se purgan a las 48 h de la ultima posicion, asi que sin congelarlas
-- el lunes ya no se sabria quien gano el sabado —ni la porra podria resolverse,
-- que se puntua contra lo que llego a meta—.

PRAGMA foreign_keys = ON;

-- Epoch ms de cierre de meta. NULL = esta carrera no tiene hora limite.
ALTER TABLE events ADD COLUMN ends_at INTEGER;

-- Resultados congelados al cerrar (JSON; ver functions/lib/eventStats.ts).
ALTER TABLE events ADD COLUMN stats TEXT;

-- Distancia del recorrido en km. Con ella se decide quien llego a META —el 97%,
-- que el GPS no clava el ultimo metro— sin abrir el payload: la calcula quien
-- publica la base y viaja por cabecera, como la salida. NULL = no se sabe, y
-- entonces no se declara finisher a nadie: mejor no decir nada que dar por
-- llegado a quien se quedo en el km 30.
ALTER TABLE events ADD COLUMN plan_total_km REAL;
