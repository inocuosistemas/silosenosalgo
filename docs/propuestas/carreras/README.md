# Carrera en directo por tramos — propuesta

Una Actividad en Directo para las carreras, pensada por **tramos**: lo que
importa en carrera no es cuánto queda a meta, sino el tramo en el que se está.
Cuánto falta al próximo punto, cuánto sube y baja todavía, qué hay allí y con
cuánto margen se llega al corte.

Pintadas con las vistas de verdad (`ios/Sources/Compartido/TramoDeCarrera.swift`)
por `LaminaTramoTests`. Datos inventados pero verosímiles: Matxicots 26, tramo
3 de 7, Coll de Pal (control, km 18,4) → Refugi del Rebost (sólido, km 24,6),
subiendo de 2.100 a 2.420 m y bajando a 2.060. Todavía **no** lo usa ninguna
Actividad: es para decidir.

| | |
|---|---|
| `00-las-dos.png` | A y B en el mismo punto, y la Isla Dinámica con los tres colores de margen |
| `01-perfil-grande.png` | A en tres momentos: empezando la subida (+48 min), en lo alto (+18), bajando fuera de corte (−6) |
| `02-proximo-punto.png` | B en los mismos tres momentos |

## Las dos formas

- **A · Perfil grande.** El perfil del tramo ocupa el centro: lo corrido en
  color, lo que falta en gris, y un punto donde se va. Debajo, de dónde a
  dónde, y lo que queda: km, metros de subida y de bajada, y el corte con el
  margen. 157 puntos de alto (el máximo es 160).
- **B · Próximo punto.** El próximo punto en grande —su icono y su nombre—, lo
  que queda en una línea, y el perfil en una tira abajo. Más baja (121) y se lee
  de un vistazo; el perfil pierde detalle.

Arriba, en las dos: la carrera, el número de tramo y el **tiempo en carrera**,
que corre solo (es el reloj del sistema).

El **margen al corte** va en color: verde con 30 minutos o más, ámbar de 10 a
30, rojo por debajo. Sin corte en ese punto, se enseña la hora de llegada
prevista.

En la **Isla Dinámica** recogida: el icono del próximo punto y los km que
faltan a un lado, y el margen al corte, en su color, al otro.

## De dónde sale cada dato (ya existe)

- **Dónde se va (km de la ruta):** lo calcula el móvil mientras se comparte
  (`trackKm`, `PlanGeometry.projectKm`), sin necesidad de red.
- **El perfil y el desnivel:** la altitud de cada punto de la traza, que viene
  en el plan descargado (`plan.gz`). La app la descarta hoy al leerlo; habría
  que conservarla.
- **Los tramos y sus puntos:** los puntos del plan con su km, su tipo (control,
  líquido, sólido, completo, bolsa, meta) y su hora de corte.
- **La previsión de llegada y el margen:** la web ya los calcula (`livePacing`).
  En el móvil habría que traerlos: portar el cálculo a Swift, o usar el mismo
  JavaScript de la web dentro de la app, como ya se hace al importar GPX.

## Para decidir

1. **A o B.**
2. **¿Qué es un tramo?** De punto a punto, contando todos los controles, o solo
   de avituallamiento a avituallamiento (menos tramos, más largos).
3. **La previsión:** la del plan (lo que se esperaba) o la del ritmo real que
   se lleva (lo que va a pasar). La del ritmo real es más útil y es la que
   calcula la web en directo.
4. **Cuándo empieza:** propuesta, sola al empezar a compartir la baliza de la
   carrera (la app está delante en ese momento), y se va al llegar a meta.
