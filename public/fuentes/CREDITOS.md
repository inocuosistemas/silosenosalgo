# La tipografía del canto de la maqueta

El nombre del evento va esculpido en el canto de la maqueta con **Carter One**,
de **Vernon Adams**, con licencia **SIL Open Font License 1.1** (el texto
completo, en `OFL-CarterOne.txt`, que la licencia pide repartir junto a la
fuente). Es redonda y de trazo muy grueso, que es lo que hace que las letras
saquen sombra al salir de la pared: con tipografías de asta fina el relieve se
queda soso.

No se usa como tipografía de la web —ahí seguimos con la del sistema—, solo
para esculpir las letras en tres dimensiones.

| Fichero | Qué es |
|---|---|
| `canto.typeface.json` | Los contornos de cada letra, en el formato que lee `FontLoader` de three.js |
| `OFL-CarterOne.txt` | La licencia, obligatoria para poder repartirla |

El fichero se llama `canto`, no `carterone`, a propósito: si algún día se
cambia de tipografía, el nombre sigue siendo verdad y no hay que tocar el
código que la pide.

## Cómo se hizo

Del TTF original de [google/fonts](https://github.com/google/fonts/tree/main/ofl/carterone),
pasado a contornos con `opentype.js`. Lleva **197 glifos**: el latín de uso
corriente (32–126 y 160–255) más `·–—''""€…`. Es decir, tildes, eñes,
diéresis y cedillas incluidas, porque el nombre de la carrera lo escribe quien
la crea y no podemos suponer que va sin acentos. Se quedaron fuera el guion
blando y el macron, que no pintan nada en el nombre de una carrera.

Pesa 264 KB y viaja en el trozo de la maqueta, que solo se descarga cuando
alguien la abre: no lastra el arranque de la web. Las coordenadas se guardan
**redondeadas a enteros** sobre una rejilla de mil unidades por eme; con
decimales ocupaba 428 KB y a este tamaño no se distingue ninguna diferencia.

El guion de conversión no vive en el repositorio porque es de un solo uso. Lo
que hace, por si hay que repetirlo: por cada letra pedida saca su contorno con
`glifo.getPath(0, 0, 1000)`, le da la vuelta a la Y (three la quiere hacia
arriba y `opentype` la devuelve hacia abajo) y lo escribe como una cadena de
órdenes `m`/`l`/`q`/`b`. Ojo con el orden, que engaña: en `q` y `b` va
**primero el punto de destino y después los de control**.

Una advertencia para la próxima vez: **no sirve cualquier TTF**. Las fuentes
variables (las que traen `[wght]` en el nombre del fichero) se convierten mal
—las letras se rompen en pedazos sueltos— y hay que usar la versión estática.
Se detecta rápido: cada letra debe dar **una sola silueta**; si da varias, la
fuente no vale.
