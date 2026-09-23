# Vista global de la carrera y selector Tramo / Carrera — propuesta

La tarjeta de la carrera con **dos vistas** y un selector en la cabecera para
cambiar entre ellas. En la Actividad el selector sería un **botón** (las
tarjetas admiten botones desde iOS 17): un toque cambia de vista sin abrir la
app. Valdría igual para quien corre y, más adelante, para quien le sigue.

Pintadas con las vistas de verdad (`ios/Sources/Compartido/VistaGlobalDeCarrera.swift`)
por `LaminaGlobalTests`. Datos inventados: 42 km de montaña con dos subidas y
siete puntos que cierran tramo. Todavía **no** lo usa la Actividad.

| | |
|---|---|
| `00-tramo-y-carrera.png` | Las dos vistas en el mismo momento, con el selector |
| `01-carrera-tres-momentos.png` | La vista global en el km 6 (+52), el 21,3 (+18) y el 26 (−8) |
| `02-sin-mas-cortes.png` | Pasado el último corte: la fila del corte desaparece |
| `03-corredores-y-antes-de-salir.png` | La vista de corredores, y la global antes de la salida con la cuenta atrás |

## La vista global

- **El perfil de la carrera entera**, con lo corrido en color y el punto donde
  se va. Debajo, una marca por cada punto que cierra tramo: **azul** los
  avituallamientos, **ámbar** los que tienen corte; las ya pasadas, apagadas.
- **Lo hecho de lo total** (21,3 de 42,0 km, siempre con un decimal) y **lo que
  queda por subir hasta meta**.
- **La llegada prevista a meta**, con el ritmo real (la misma cuenta que la del
  tramo).
- **El próximo corte** con su hora y el margen en color. Pasado el último, la
  fila no sale.

Alto: 148 puntos la global y 158 la de tramo con el selector (el máximo es 160),
también con la letra grande de accesibilidad.

## Para montarlo

- **El botón** es una intención de la app (`LiveActivityIntent`): cambia la
  vista y repinta la tarjeta sin abrir la app. La vista elegida se recuerda.
- **Las dos vistas en cada actualización**, para que el cambio sea instantáneo
  y no dependa de la red. Cabe en los 4 KB del sistema, pero hay que
  compactar los perfiles: solo las altitudes, en metros enteros, con los km
  implícitos (repartidos a lo parejo). Así un perfil de 60 muestras ocupa unos
  300 bytes en vez de 2 KB.
- **Los datos globales** salen de la misma hoja de tramos que ya calcula la
  web: el perfil entero, los puntos y el horario del plan.

## Decidido (23/09/2026)

- **El selector de arriba cambia la vista; tocar el resto de la tarjeta abre la
  app.** Tres partes: «Tramo 5/7 · Carrera · 👥» (la tercera, solo el icono:
  tres palabras no caben junto al nombre y el reloj).
- **Antes de la salida, la vista global**, con la cuenta atrás en grande
  («Salida en 25:11») en vez de en la cabecera. **A la hora de salida pasa sola a
  la de tramo**, una vez: si luego se cambia a mano, se respeta.
- **La vista de corredores**: la zona de alrededor (4 km por detrás y 4 por
  delante) con el emoji de cada uno en su km, y el primero en la esquina con lo
  que lleva de ventaja («👑🦅 +9,9 km →»). Debajo, la posición («34.º de 120») y
  quién va justo delante y justo detrás, con la distancia. A escala de la
  carrera entera no servía: cuatro corredores en kilómetro y medio caían en
  trece puntos de pantalla, uno encima de otro.

## Para montar la vista de corredores

- Las posiciones las da el servidor (`/api/events/:id/live` ya tiene el km, el
  emoji y el nombre de cada uno), así que **necesita cobertura**: se piden cada
  3 minutos cuando hay red, y la tarjeta dice de qué hora son. Solo salen quienes
  llevan baliza.
- Hace falta una consulta más ligera que la del mapa (que manda las trazas y
  apunta quién mira): solo km, emoji, nombre y posición.
