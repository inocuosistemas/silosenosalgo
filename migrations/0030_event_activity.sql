-- De que va la carrera: caminata, carrera o bicicleta.
--
-- No se puede deducir del TRAZADO —un circuito de 7 km se anda, se corre y se
-- pedalea igual— pero si del PLAN con el que se publico: el planificador ya
-- pregunta la actividad para calcular ritmos, y ese dato viaja dentro del
-- recorrido. Asi que se coge de ahi al publicar y quien organiza puede
-- corregirlo.
--
-- Importa mas de lo que parece. Los resultados aplican filtros de velocidad
-- para descartar saltos de GPS, y el umbral no puede ser el mismo: 12 km/h
-- andando es imposible pero en bici es ir de paseo, y un kilometro en dos
-- minutos es un salto del receptor a pie y una bajada normal sobre ruedas. Con
-- un solo umbral, o se cuelan los saltos de unos o se recortan las marcas
-- buenas de otros.

ALTER TABLE events ADD COLUMN activity TEXT;
