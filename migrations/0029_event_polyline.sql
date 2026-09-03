-- El trazado del recorrido, simplificado, para poder medir avance de verdad.
--
-- Los resultados median los kilometros de cada uno sumando su traza de GPS, y
-- eso mide otra cosa: el ruido del receptor infla —en una carrera de 7,46 km
-- salian 8,69— y a quien pierde cobertura en el ultimo tramo le sale corta. Con
-- eso, quien completo el recorrido podia figurar como que no llego a meta
-- mientras otro que paro antes figuraba como llegado, solo porque su GPS
-- temblo mas. Paso de verdad.
--
-- Lo que hay que medir es AVANCE SOBRE EL RECORRIDO: proyectar cada posicion
-- sobre el trazado y quedarse con el kilometro mas lejano alcanzado. Para eso
-- hace falta el trazado aqui, y por eso se guarda: puntos y kilometro
-- acumulado, remuestreados, como JSON.
--
-- No es abrir el payload —eso lo sigue haciendo solo el cliente, que es quien
-- entiende su formato— sino guardar un dato DERIVADO que el cliente calcula y
-- manda, igual que ya manda la distancia total y la hora del ultimo cierre.

ALTER TABLE events ADD COLUMN plan_polyline TEXT;
