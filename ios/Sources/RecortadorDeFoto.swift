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
    /// El formato que se está encuadrando ahora. Cambia la FORMA del marco.
    @Published private(set) var formato: FormatoFoto
    /// Lo ya decidido para los otros formatos, por si se vuelve a ellos.
    private var hechos: [String: EncuadreFoto]

    init(foto: CGSize, formato: FormatoFoto = .mediano, hechos: [String: EncuadreFoto] = [:]) {
        self.foto = foto
        self.formato = formato
        self.hechos = hechos
        let e = hechos[formato.rawValue] ?? EncuadreFoto()
        let z = min(4, max(1, CGFloat(e.escala)))
        escala = z
        escalaAlEmpezar = z
        let m = CGSize(width: CGFloat(e.x), height: CGFloat(e.y))
        rel = m
        relAlEmpezar = m
    }

    /// Con un solo encuadre, el del mediano: como era cuando no había formatos.
    convenience init(foto: CGSize, encuadre: EncuadreFoto?) {
        self.init(foto: foto, formato: .mediano,
                  hechos: encuadre.map { [FormatoFoto.mediano.rawValue: $0] } ?? [:])
    }

    /// Cambiar de formato: se apunta lo que había en el que se deja, y el que
    /// entra sale de lo suyo si ya se tocó, o se SACA del que se acaba de
    /// dejar si no (ver `derivado`).
    func cambiaA(_ nuevo: FormatoFoto) {
        guard nuevo != formato else { return }
        let dejado = comoQueda(formato.proporcion)
        hechos[formato.rawValue] = dejado
        let e = hechos[nuevo.rawValue]
            ?? Self.derivado(dejado, de: formato, a: nuevo, foto: foto)
        formato = nuevo
        // El marco lo vuelve a decir la pantalla al pintar el nuevo, que es de
        // otra forma; con el de antes, el primer recorte a límites se haría
        // contra un marco que ya no existe.
        marco = .zero
        escala = min(4, max(1, CGFloat(e.escala)))
        escalaAlEmpezar = escala
        rel = CGSize(width: CGFloat(e.x), height: CGFloat(e.y))
        relAlEmpezar = rel
    }

    /// Los tres encuadres: los que se han tocado, y los que no, sacados del
    /// que se está mirando ahora.
    func todos() -> [String: EncuadreFoto] {
        var t = hechos
        let actual = comoQueda(formato.proporcion)
        t[formato.rawValue] = actual
        for f in FormatoFoto.allCases where t[f.rawValue] == nil {
            t[f.rawValue] = Self.derivado(actual, de: formato, a: f, foto: foto)
        }
        return t
    }

    /**
     El mismo encuadre, con otra forma de marco.

     Lo que se conserva es el PUNTO DE LA FOTO que queda en el centro y cuánto
     se ha acercado; lo que cambia es la forma del recorte que se lleva de ahí.
     Es lo que hace que encuadrando una vez los tres formatos salgan centrados
     en lo mismo, en vez de empezar cada uno en medio de la foto.

     El desplazamiento no se puede copiar tal cual: va en fracción del marco, y
     el marco de cada formato mide otra cosa. Así que se pasa por píxeles de la
     foto, que es lo único que significa lo mismo en los tres.
     */
    static func derivado(_ e: EncuadreFoto, de: FormatoFoto, a: FormatoFoto, foto: CGSize) -> EncuadreFoto {
        guard foto.width > 0, foto.height > 0 else { return e }
        let mA = marcoPorDefecto(de.proporcion)
        let mB = marcoPorDefecto(a.proporcion)
        let movidaA = CGSize(width: CGFloat(e.x) * mA.width, height: CGFloat(e.y) * mA.height)
        let visto = RecortadorDeFoto.trozoVisible(
            foto: foto, marco: mA, escala: CGFloat(e.escala), movida: movidaA)
        guard !visto.isEmpty else { return e }
        let escala = max(1, min(4, CGFloat(e.escala)))
        let s = max(mB.width / foto.width, mB.height / foto.height) * escala
        let movidaB = CGSize(
            width: (foto.width / 2 - visto.midX) * s,
            height: (foto.height / 2 - visto.midY) * s
        )
        let bruto = CGSize(width: movidaB.width / mB.width, height: movidaB.height / mB.height)
        let cabe = Self(foto: foto, formato: a,
                        hechos: [a.rawValue: EncuadreFoto(escala: Double(escala))])
        let r = cabe.dentroDeLimites(bruto, mB)
        return EncuadreFoto(escala: Double(escala), x: Double(r.width), y: Double(r.height))
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

 Y se encuadra UNO POR UNO, porque los tres huecos tienen formas muy distintas
 (ver `FormatoFoto`): el pequeño es cuadrado, el mediano más de dos a uno.
 Encuadrando solo el mediano y estirando ese recorte al pequeño, el cuadrado
 recortaba por los lados justo lo que se acababa de elegir.

 Encuadrar tres veces sería un peaje, así que no se pide: el formato que no se
 toca se SACA del que sí (ver `AjusteDeEncuadre.derivado`), mirando al mismo
 punto de la foto con la forma que le toque. Quien quiera afinar uno, entra y
 lo afina; quien no, no se entera de que hay tres.
 */
struct RecortadorDeFoto: View {
    let imagen: UIImage
    /// Cómo queda encuadrado CADA formato (ver `FormatoFoto`). El recorte de
    /// verdad lo hace quien guarda, que es el que tiene el original a mano.
    let alGuardar: ([String: EncuadreFoto]) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var ajuste: AjusteDeEncuadre

    init(imagen: UIImage, encuadres: [String: EncuadreFoto] = [:],
         alGuardar: @escaping ([String: EncuadreFoto]) -> Void) {
        self.imagen = imagen
        self.alGuardar = alGuardar
        _ajuste = StateObject(wrappedValue: AjusteDeEncuadre(
            foto: imagen.size, formato: .mediano, hechos: encuadres))
    }

    /// Con un ajuste ya hecho — para poder moverlo desde una prueba sin tener
    /// que simular dedos.
    init(imagen: UIImage, ajuste: AjusteDeEncuadre,
         alGuardar: @escaping ([String: EncuadreFoto]) -> Void) {
        self.imagen = imagen
        self.alGuardar = alGuardar
        _ajuste = StateObject(wrappedValue: ajuste)
    }

    /// Lo apaisado que es el hueco que se está encuadrando ahora.
    private var proporcion: CGFloat { ajuste.formato.proporcion }

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text("Mueve y acerca la foto. Lo de ARRIBA se ve tal cual; lo de abajo se va apagando bajo el número.")
                    .font(.caption)
                    .foregroundStyle(Theme.slate400)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)

                // Cada formato tiene su hueco y su forma, y se encuadra aparte:
                // el pequeño es cuadrado y el mediano más de dos a uno, así que
                // lo que se elige para uno no vale para el otro. El que no se
                // toque sale del que sí (ver `AjusteDeEncuadre.derivado`), así
                // que con encuadrar uno ya hay los tres.
                Picker("Formato", selection: Binding(
                    get: { ajuste.formato },
                    set: { ajuste.cambiaA($0) }
                )) {
                    ForEach(FormatoFoto.allCases, id: \.self) { f in
                        Text(f.nombre).tag(f)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)

                ventana
                    .padding(.horizontal, 16)
                    // Que la ventana no dé un salto al cambiar de forma: se ve
                    // de dónde sale lo que ahora se está mirando.
                    .animation(.easeInOut(duration: 0.2), value: ajuste.formato)

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
        alGuardar(ajuste.todos())
    }

    /// Lo que el widget pone encima de la foto en este formato.
    private var velo: LinearGradient {
        ajuste.formato == .grande ? TarjetaGrande.veloDeCartel : FondoDeFoto.velo
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
                // El MISMO velo que pone el widget encima de la foto, y el de
                // ESTE formato: en el pequeño y el mediano el número va sobre
                // la foto (ver `FondoDeFoto`), y en el grande la foto se apaga
                // del todo por abajo porque el número cae ya fuera de ella
                // (ver `TarjetaGrande`). Así se encuadra viendo lo que se va a
                // ver, y no una foto limpia que luego sale medio apagada.
                velo
                    .allowsHitTesting(false)
                VStack {
                    Spacer()
                    Text(ajuste.formato == .grande ? "aquí se acaba la foto" : "aquí va el número")
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

    /// La foto recortada al trozo que se ve por el marco.
    ///
    /// Para un encuadre ya guardado y una forma de marco: es como se sacan los
    /// tres recortes al guardar (ver `FotosDeContador.guardaEncuadres`).
    static func recorta(_ imagen: UIImage, encuadre: EncuadreFoto, formato: FormatoFoto) -> UIImage {
        let marco = AjusteDeEncuadre.marcoPorDefecto(formato.proporcion)
        let movida = CGSize(width: CGFloat(encuadre.x) * marco.width,
                            height: CGFloat(encuadre.y) * marco.height)
        return recorta(imagen, marco: marco, escala: CGFloat(encuadre.escala), movida: movida)
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
