import CoreGraphics

/**
 Lo que mide cada widget, para dar tamaño a lo que lleva dentro.

 Son constantes y no una medida del hueco de verdad a propósito: dentro de un
 widget, un reloj del sistema metido en un `GeometryReader` deja de correr, y
 la cuenta atrás se quedaba parada. Se toman los tamaños del iPhone ESTRECHO
 (los de un SE): en un móvil grande el número queda un pelo más pequeño que el
 hueco, que es mucho mejor que salirse en uno pequeño.
 */
public enum TamanoWidget {
    public static let pequeno = CGSize(width: 148, height: 148)
    public static let mediano = CGSize(width: 321, height: 148)
    public static let grande = CGSize(width: 321, height: 324)

    /// Qué parte del alto del GRANDE ocupa la foto: baja por detrás del título
    /// y se apaga justo encima de los números (ver `TarjetaGrande`). Vive aquí
    /// porque también decide la forma del marco al encuadrar ese formato, y las
    /// dos cuentas tienen que salir del mismo número.
    public static let altoDeLaFoto: CGFloat = 0.78
}
