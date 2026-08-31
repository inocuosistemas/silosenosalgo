-- Cuándo se subió la foto del evento, para poder versionar su URL.
--
-- La foto vive siempre bajo la misma clave (`eventphoto:<id>`), así que al
-- reencuadrarla la URL no cambia y las cachés siguen sirviendo la anterior.
-- Se vio en carne propia: el organizador reencuadró el cartel y él lo veía
-- bien —su navegador saltaba la caché con un parámetro puesto a mano tras
-- subirla— mientras los participantes seguían viendo el encuadre viejo. La
-- misma pantalla enseñando dos imágenes distintas según quién mire.
--
-- Con esta marca la URL lleva `?v=<photo_at>` para TODO EL MUNDO: cambia
-- exactamente cuando cambia la foto, así que la caché deja de ser una lotería
-- y además puede ser larga, que es lo que se quiere para una imagen que casi
-- nunca cambia.
--
-- Aditiva y nullable: los eventos con foto anterior a esto se quedan sin
-- marca, y su URL va sin versión —caché corta— hasta que se reencuadren.

ALTER TABLE events ADD COLUMN photo_at INTEGER;
