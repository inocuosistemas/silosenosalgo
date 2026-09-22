# Arco para los vuelos — propuesta

En avión, el trayecto como un arco en vez de una barra: cuenta el despegue y el
aterrizaje sin palabras. El avión gira siguiendo la curva: el morro arriba al
salir, recto en lo alto y abajo al llegar.

Pintadas con las vistas de verdad (`ios/Sources/Compartido/ArcoDeViaje.swift`)
por `LaminaArcoTests`. Todavía **no** las usa la Actividad: están para decidir.

| | |
|---|---|
| `00-las-tres.png` | La barra de ahora, el arco tendido y el semicírculo, a medio vuelo y con título |
| `01-arco-tendido.png` | El arco tendido: despegando, en crucero, aterrizando, sin señal y llegado |
| `02-semicirculo.png` | El semicírculo, en los mismos momentos |

## Las dos formas

- **Arco tendido.** Un arco bajo entre los dos códigos, en la misma fila; los km
  debajo, como ahora. Es la más baja (112 puntos, 136 con título).
- **Semicírculo.** Un semicírculo de verdad entre los códigos, con los km y la
  hora de llegada **dentro** de la cúpula. Sin línea de pie: lo que iba debajo va
  dentro. 116 puntos, 139 con título.

Un semicírculo a todo lo ancho no cabe: la tarjeta de la pantalla de bloqueo no
puede pasar de 160 puntos de alto, y medio círculo de 330 de ancho mide 165.

## Decisiones tomadas

- **El avión no se inclina más de 35°.** En las puntas de un semicírculo la
  curva cae a plomo, y sin tope el avión llegaba en picado: más de accidente
  que de aterrizaje.
- **Solo para el avión.** El tren, el coche o el barco no despegan: siguen con
  la barra recta.
- **La posición sobre el arco va por lo que falta**, igual que en la barra: a
  mitad de distancia, arriba del todo.
