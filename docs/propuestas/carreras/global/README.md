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

## Para decidir

1. ¿Te gusta el selector en la cabecera, o prefieres otra cosa (por ejemplo,
   que cambie tocando el perfil)?
2. ¿Qué vista sale al empezar? Propuesta: la de tramo, y luego la que se haya
   elegido la última vez.
3. ¿Algo más en la global? Por ejemplo, la posición en la carrera (el 34.º de
   120), que el servidor ya sabe pero la app del corredor no.
