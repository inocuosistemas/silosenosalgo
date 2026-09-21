import SwiftUI
import UIKit

/**
 Cuánto se ha acercado y movido la foto dentro del marco.

 Es un OBJETO, y no el estado de la vista, y eso es lo que arregla el fallo.

 El botón «Usar» vive en la barra de navegación. Con el ajuste en `@State`, lo
 que ese botón leía al pulsarlo eran los valores DEL PRINCIPIO —sin mover y sin
 acercar—, así que el paneo y el zoom se veían en pantalla mientras se hacían y
 al pulsar «Usar» se guardaba la foto entera. No es una sospecha: la prueba
 `EncuadreConDedoTests` arrastra y acerca con un dedo de verdad y mira el
 recorte que queda; con el código de antes salía de 900 píxeles de ancho (la
 foto sin tocar) y con este, de 381 (acercada al triple). Guardado en un
 objeto, el botón tiene una referencia y lee lo que hay AHORA.

 La posición va en FRACCIÓN del marco y no en puntos de pantalla: es lo que se
 guarda (ver `EncuadreFoto`), el marco mide distinto en cada móvil, y así lo
 que se pinta y lo que se guarda salen de la misma cuenta.
 */
@MainActor
final class AjusteDeEncuadre: ObservableObject {
    /// El tamaño de la foto, para saber cuánto se puede mover sin destapar el fondo.
    let foto: CGSize
    @Published var escala: CGFloat
    @Published var rel: CGSize
    /// Desde dónde cuenta el gesto que está en curso.
    var escalaAlEmpezar: CGFloat
    var relAlEmpezar: CGSize
    /// Lo que mide el marco en pantalla; se sabe al pintarlo.
    var marco: CGSize = .zero

    init(foto: CGSize, encuadre: EncuadreFoto? = nil) {
        self.foto = foto
        let e = encuadre ?? EncuadreFoto()
        let z = min(4, max(1, CGFloat(e.escala)))
        escala = z
        escalaAlEmpezar = z
        let m = CGSize(width: CGFloat(e.x), height: CGFloat(e.y))
        rel = m
        relAlEmpezar = m
    }

    /// Deja la posición dentro de lo que el marco admite y la da por buena:
    /// desde ahí arranca el siguiente arrastre.
    func asienta(_ marco: CGSize) {
        self.marco = marco
        rel = dentroDeLimites(rel, marco)
        relAlEmpezar = rel
        escalaAlEmpezar = escala
    }

    /// La posición en puntos de pantalla, ya recortada a lo que cabe.
    func enPuntos(_ marco: CGSize) -> CGSize {
        let r = dentroDeLimites(rel, marco)
        return CGSize(width: r.width * marco.width, height: r.height * marco.height)
    }

    /// Que no se vea el fondo por ningún lado: la foto siempre tapa el marco.
    /// En fracción, igual que se guarda.
    func dentroDeLimites(_ rel: CGSize, _ marco: CGSize) -> CGSize {
        guard marco.width > 0, marco.height > 0, foto.width > 0, foto.height > 0 else { return rel }
        let s = max(marco.width / foto.width, marco.height / foto.height) * escala
        let sobraX = max(0, (foto.width * s - marco.width) / 2) / marco.width
        let sobraY = max(0, (foto.height * s - marco.height) / 2) / marco.height
        return CGSize(
            width: min(sobraX, max(-sobraX, rel.width)),
            height: min(sobraY, max(-sobraY, rel.height))
        )
    }

    /// El marco de referencia cuando todavía no se ha pintado nada.
    static func marcoPorDefecto(_ proporcion: CGFloat) -> CGSize {
        CGSize(width: 320, height: 320 / proporcion)
    }

    /// Cómo queda el encuadre, tal cual se guarda (ver `EncuadreFoto`).
    func comoQueda(_ proporcion: CGFloat) -> EncuadreFoto {
        let m = marco == .zero ? Self.marcoPorDefecto(proporcion) : marco
        let r = dentroDeLimites(rel, m)
        return EncuadreFoto(escala: Double(escala), x: Double(r.width), y: Double(r.height))
    }
}

/**
 Encuadrar la foto de un contador: mover y acercar dentro del marco que el
 widget va a enseñar.

 Hace falta porque el widget rellena el hueco con la foto —recorta lo que
 sobra— y el hueco es MUY apaisado. Sin poder mover la foto, una vertical se
 queda en la barriga del retrato y la cara fuera, y no hay forma de arreglarlo.

 El marco es el del widget mediano (algo más de dos a uno). El grande es un
 pelín menos apaisado y recorta un poco por los lados de lo que se elija aquí,
 así que lo importante conviene dejarlo hacia el centro.
 */
struct RecortadorDeFoto: View {
    let imagen: UIImage
    /// Devuelve el recorte Y cómo se ha hecho: lo primero es lo que se enseña,
    /// lo segundo es lo que permite volver aquí y seguir donde se dejó.
    let alGuardar: (UIImage, EncuadreFoto) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var ajuste: AjusteDeEncuadre

    init(imagen: UIImage, encuadre: EncuadreFoto? = nil,
         alGuardar: @escaping (UIImage, EncuadreFoto) -> Void) {
        self.imagen = imagen
        self.alGuardar = alGuardar
        _ajuste = StateObject(wrappedValue: AjusteDeEncuadre(foto: imagen.size, encuadre: encuadre))
    }

    /// Con un ajuste ya hecho — para poder moverlo desde una prueba sin tener
    /// que simular dedos.
    init(imagen: UIImage, ajuste: AjusteDeEncuadre,
         alGuardar: @escaping (UIImage, EncuadreFoto) -> Void) {
        self.imagen = imagen
        self.alGuardar = alGuardar
        _ajuste = StateObject(wrappedValue: ajuste)
    }

    /// Lo apaisado que es el hueco del widget mediano.
    private let proporcion: CGFloat = TamanoWidget.mediano.width / TamanoWidget.mediano.height

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text("Mueve y acerca la foto. Lo de ARRIBA se ve tal cual; lo de abajo se va apagando bajo el número, y cuánto depende del tamaño del widget.")
                    .font(.caption)
                    .foregroundStyle(Theme.slate400)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)

                ventana
                    .padding(.horizontal, 16)

                Slider(value: $ajuste.escala, in: 1...4)
                    .padding(.horizontal, 24)
                    .tint(Theme.sky500)

                Spacer(minLength: 0)
            }
            .padding(.top, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.slate950)
            .navigationTitle("Encuadre")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Usar") { guarda(); dismiss() }
                }
            }
        }
    }

    /// Lo que hace el botón «Usar». Aparte, para poder comprobarlo sin dedos.
    func guarda() {
        alGuardar(recorta(), ajuste.comoQueda(proporcion))
    }

    private var ventana: some View {
        GeometryReader { g in
            let w = g.size.width
            let h = w / proporcion
            let marcoAhora = CGSize(width: w, height: h)
            // De fracción a puntos, y ya recortada a lo que el marco admite:
            // lo que se pinta sale de la misma cuenta que lo que se guarda.
            let movida = ajuste.enPuntos(marcoAhora)
            ZStack {
                Image(uiImage: imagen)
                    .resizable()
                    .scaledToFill()
                    .frame(width: w, height: h)
                    .scaleEffect(ajuste.escala)
                    .offset(movida)
                    .frame(width: w, height: h)
                    .clipped()
                // El MISMO velo que pone el widget encima de la foto (ver
                // `FondoDeFoto`): así se encuadra viendo lo que se va a ver, y
                // no una foto limpia que luego sale medio apagada.
                FondoDeFoto.velo
                    .allowsHitTesting(false)
                VStack {
                    Spacer()
                    Text("aquí va el número")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.65))
                        .padding(.bottom, 8)
                }
                .allowsHitTesting(false)
            }
            .frame(width: w, height: h)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Theme.slate700, lineWidth: 1)
            )
            .contentShape(Rectangle())
            .gesture(
                DragGesture()
                    .onChanged { v in
                        guard w > 0, h > 0 else { return }
                        ajuste.rel = CGSize(
                            width: ajuste.relAlEmpezar.width + v.translation.width / w,
                            height: ajuste.relAlEmpezar.height + v.translation.height / h
                        )
                    }
                    .onEnded { _ in ajuste.asienta(marcoAhora) }
            )
            .simultaneousGesture(
                MagnificationGesture()
                    .onChanged { ajuste.escala = min(4, max(1, ajuste.escalaAlEmpezar * $0)) }
                    .onEnded { _ in ajuste.asienta(marcoAhora) }
            )
            .onAppear { ajuste.marco = marcoAhora }
            .onChange(of: ajuste.escala) { _, _ in
                ajuste.marco = marcoAhora
                ajuste.rel = ajuste.dentroDeLimites(ajuste.rel, marcoAhora)
                ajuste.relAlEmpezar = ajuste.rel
            }
        }
        .aspectRatio(proporcion, contentMode: .fit)
    }

    /// La foto recortada a lo que se ve en el marco.
    private func recorta() -> UIImage {
        let marco = ajuste.marco == .zero ? AjusteDeEncuadre.marcoPorDefecto(proporcion) : ajuste.marco
        return Self.recorta(imagen, marco: marco, escala: ajuste.escala, movida: ajuste.enPuntos(marco))
    }

    /// La foto recortada al trozo que se ve por el marco.
    static func recorta(_ imagen: UIImage, marco: CGSize, escala: CGFloat, movida: CGSize) -> UIImage {
        // Derecha con la orientación: una foto de la cámara viene girada y
        // recortar sobre sus píxeles a lo bruto saca otro trozo.
        let derecha = derechaArriba(imagen)
        let rect = trozoVisible(foto: derecha.size, marco: marco, escala: escala, movida: movida)
        guard !rect.isEmpty, let cg = derecha.cgImage?.cropping(to: rect.integral) else { return derecha }
        return UIImage(cgImage: cg)
    }

    /// Qué trozo de la foto se está viendo por el marco, en píxeles de la foto.
    ///
    /// Aparte y sin estado a propósito: es la única cuenta del encuadre que
    /// puede salir mal en silencio —se recorta OTRA cosa y nadie se entera
    /// hasta verlo en el widget—, así que tiene sus pruebas.
    static func trozoVisible(foto: CGSize, marco: CGSize, escala: CGFloat, movida: CGSize) -> CGRect {
        guard foto.width > 0, foto.height > 0, marco.width > 0, marco.height > 0 else { return .zero }
        // Puntos de pantalla por píxel de foto: la foto RELLENA el marco.
        let s = max(marco.width / foto.width, marco.height / foto.height) * max(0.01, escala)
        let visible = CGSize(width: marco.width / s, height: marco.height / s)
        // Arrastrar la foto a la derecha enseña lo que había a su izquierda.
        let centro = CGPoint(x: foto.width / 2 - movida.width / s, y: foto.height / 2 - movida.height / s)
        let rect = CGRect(
            x: centro.x - visible.width / 2,
            y: centro.y - visible.height / 2,
            width: visible.width,
            height: visible.height
        )
        return rect.intersection(CGRect(origin: .zero, size: foto))
    }

    private static func derechaArriba(_ img: UIImage) -> UIImage {
        guard img.imageOrientation != .up else { return img }
        let formato = UIGraphicsImageRendererFormat.default()
        formato.scale = 1
        return UIGraphicsImageRenderer(size: img.size, format: formato).image { _ in
            img.draw(in: CGRect(origin: .zero, size: img.size))
        }
    }
}
