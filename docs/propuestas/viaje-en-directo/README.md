# Viaje en directo — propuesta de diseño

Una **Actividad en Directo** (pantalla de bloqueo + Isla Dinámica) que enseña un
viaje de un sitio a otro y cómo se avanza, con el GPS del móvil. Primer uso: un
vuelo a otro país. Después, las carreras.

Las imágenes están pintadas con las **vistas SwiftUI de verdad**
(`ios/Sources/Compartido/VistasViaje.swift`), no son un boceto: lo que se
apruebe aquí es lo que sale en el móvil. Se regeneran con:

```sh
cd ios && TEST_RUNNER_LAMINA_VIAJE="$PWD/../docs/propuestas/viaje-en-directo" \
  xcodebuild -project SiLoSeNoSalgoTracker.xcodeproj -scheme SiLoSeNoSalgoTracker \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -only-testing:SiLoSeNoSalgoTrackerTests/LaminaViajeTests test
```

Ejemplo de todas: **Barcelona (BCN) → Tokio (NRT)**, unos 10.400 km en línea recta.

## Las imágenes

| | |
|---|---|
| `00-lamina-completa.png` | Todo junto: las dos variantes, la Isla Dinámica y los 7 transportes |
| `01-a-recien-despegado.png` | Variante A al 12 % |
| `02-a-medio-camino.png` | Variante A al 58 %, con hora de llegada |
| `03-a-sin-senal.png` | Sin posición buena desde hace rato: se dice, en naranja |
| `04-a-llegado.png` | Al llegar |
| `05-b-medio-camino.png` | Variante B, más apretada |
| `06-a-contra-b.png` | A y B una encima de otra, para comparar |

## Las dos variantes

- **A (la propuesta).** Los códigos en grande en cada punta, como en un panel de
  salidas, con la ciudad debajo. Barra llena en lo hecho y punteada en lo que
  falta, con el transporte en su sitio. Debajo, los km que quedan y la hora de
  llegada.
- **B.** Los códigos a los lados de la barra y «Barcelona → Tokio» debajo.
  Ocupa menos alto, pero los códigos pierden presencia.

## Qué se configura (en la app, no en la galería de widgets)

Una Actividad en Directo la arranca la app; no se añade desde la pantalla de
inicio. Iría en la sección de cuenta atrás, como bloque propio:

- **Origen** y **destino**: buscando la ciudad (o el aeropuerto).
- **Abreviatura** de cada uno: propuesta automática (las tres primeras letras),
  editable. Hasta 4 caracteres.
- **Medio de transporte**: avión, tren, coche, autobús, barco, bici o a pie.

## Decisiones tomadas, para revisar

1. **La distancia es en línea recta por la superficie de la Tierra**, desde la
   posición actual hasta el destino. El avance se mide por lo que FALTA, no por
   lo recorrido: un avión da vueltas al despegar y al esperar para aterrizar.
   En el aeropuerto de salida puede quedar más que el total; entonces es 0 %.
2. **La hora de llegada sale de la velocidad del GPS.** Parado o sin señal, no
   aparece. Alternativa: escribirla uno (la del billete).
3. **Color:** el azul cielo de la app. Podría elegirse, como en las cuentas atrás.
4. **Los km siempre con punto de millares** (`4.389`, `10.437`) y coma decimal
   por debajo de 10 (`7,2`), sea cual sea el idioma del móvil.
5. **Tren, autobús y barco se ven de frente**: el sistema no tiene versión
   lateral que quede bien. El coche se gira para que vaya hacia la derecha.
6. **Llegada:** se da por llegado a menos de 2 km del destino, y la tarjeta se
   queda un rato con «Has llegado» antes de irse.

## Límites que no dependen de nosotros

- **8 horas activa.** Pasado ese tiempo el sistema la deja de actualizar. Un
  vuelo a Europa sobra; uno transoceánico largo se quedaría parado. Arreglo
  posible: relanzarla desde el servidor con una notificación push.
- **GPS en el avión:** funciona en modo avión (el GPS solo escucha), mejor cerca
  de la ventanilla. Sin señal, la tarjeta lo dice en vez de enseñar un número
  viejo como si fuera actual.
- **Batería:** se pide precisión de kilómetro, que para un avión sobra y gasta
  mucho menos que la de las carreras.
- **Mapa real, no:** una Actividad en Directo no puede cargar mapas; por eso la
  barra.

## Estado

Montado con la **variante A** y colores elegibles:

- **Colores:** el fondo de la tarjeta y el trayecto (uno, o dos en degradado).
  El texto y el icono se ponen solos claros u oscuros para que se lean
  (`10-colores-elegidos.png`). En la Isla Dinámica el fondo es siempre negro:
  ahí solo manda el trayecto.
- **Dónde:** Cuenta atrás ▸ En directo ▸ Viaje en directo.
- **Cuándo empieza:** con «Empezar ahora», o con un aviso a la hora de salida
  que al tocarlo la arranca. Apple no deja que empiece sola sin la app delante;
  para eso haría falta un push desde el servidor (push-to-start), que queda
  para después y solo se puede probar en TestFlight.
- **Probado en el simulador:** la Actividad arranca, avanza con una ruta GPS
  simulada y sale en la pantalla de bloqueo pintada por el sistema. La Isla
  Dinámica no se puede capturar en el simulador: queda por ver en el iPhone.

Pendiente: el push programado, y el uso en las carreras.
