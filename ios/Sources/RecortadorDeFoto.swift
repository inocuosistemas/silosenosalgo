import SwiftUI
import UIKit

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
    let alGuardar: (UIImage) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var escala: CGFloat = 1
    @State private var escalaAlEmpezar: CGFloat = 1
    @State private var movida: CGSize = .zero
    @State private var movidaAlEmpezar: CGSize = .zero
    /// Lo que mide el marco en pantalla; se sabe al pintarlo.
    @State private var marco: CGSize = .zero

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

                Slider(value: $escala, in: 1...4)
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
                    Button("Usar") { alGuardar(recorta()); dismiss() }
                }
            }
        }
    }

    private var ventana: some View {
        GeometryReader { g in
            let w = g.size.width
            let h = w / proporcion
            ZStack {
                Image(uiImage: imagen)
                    .resizable()
                    .scaledToFill()
                    .frame(width: w, height: h)
                    .scaleEffect(escala)
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
                        movida = CGSize(
                            width: movidaAlEmpezar.width + v.translation.width,
                            height: movidaAlEmpezar.height + v.translation.height
                        )
                    }
                    .onEnded { _ in
                        movida = dentroDeLimites(movida, CGSize(width: w, height: h))
                        movidaAlEmpezar = movida
                    }
            )
            .simultaneousGesture(
                MagnificationGesture()
                    .onChanged { escala = min(4, max(1, escalaAlEmpezar * $0)) }
                    .onEnded { _ in
                        escalaAlEmpezar = escala
                        movida = dentroDeLimites(movida, CGSize(width: w, height: h))
                        movidaAlEmpezar = movida
                    }
            )
            .onAppear { marco = CGSize(width: w, height: h) }
            .onChange(of: escala) { _, _ in
                movida = dentroDeLimites(movida, CGSize(width: w, height: h))
                movidaAlEmpezar = movida
            }
        }
        .aspectRatio(proporcion, contentMode: .fit)
    }

    /// Que no se vea el fondo por ningún lado: la foto siempre tapa el marco.
    private func dentroDeLimites(_ m: CGSize, _ marco: CGSize) -> CGSize {
        let (an, al) = tamanoPintado(marco)
        let sobraX = max(0, (an - marco.width) / 2)
        let sobraY = max(0, (al - marco.height) / 2)
        return CGSize(
            width: min(sobraX, max(-sobraX, m.width)),
            height: min(sobraY, max(-sobraY, m.height))
        )
    }

    /// Lo que ocupa la foto en pantalla con el acercamiento de ahora.
    private func tamanoPintado(_ marco: CGSize) -> (CGFloat, CGFloat) {
        let s = max(marco.width / imagen.size.width, marco.height / imagen.size.height) * escala
        return (imagen.size.width * s, imagen.size.height * s)
    }

    /// La foto recortada a lo que se ve en el marco.
    private func recorta() -> UIImage {
        let marco = self.marco == .zero ? CGSize(width: 320, height: 320 / proporcion) : self.marco
        return Self.recorta(imagen, marco: marco, escala: escala, movida: movida)
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
