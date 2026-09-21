import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/// ¿Se ve una RAYA donde el cartel se funde con el fondo?
///
/// A ojo engaña: los colores a un lado y otro son casi el mismo y lo que se ve
/// es el cambio de PENDIENTE. Así que se mide: se baja por una columna de
/// píxeles y se mira cuánto cambia el brillo de una fila a la siguiente. Un
/// fundido bueno cambia poco y siempre parecido; una raya es un pico.
@MainActor
final class VistaTarjetaGrandeTests: XCTestCase {
    private func pinta() -> UIImage {
        let tam = CGSize(width: 338, height: 354)
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1
        // Un cartel CLARO y liso: sin dibujo que despiste, cualquier escalón
        // del fundido se ve tal cual.
        let foto = UIGraphicsImageRenderer(size: CGSize(width: 1200, height: 800), format: fmt).image { ctx in
            UIColor(red: 1, green: 0.93, blue: 0.95, alpha: 1).setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 1200, height: 800))
        }
        let c = Contador(nombre: "Algo muy especial...", fecha: Date().addingTimeInterval(86_400 + 6 * 3600),
                         color: "#f8fafc", emoji: "⁉️")
        let vista = TarjetaGrande(contador: c, foto: foto, tamano: tam)
            .frame(width: tam.width, height: tam.height)
            .background(Color(red: 0.06, green: 0.09, blue: 0.16))
        let host = UIHostingController(rootView: vista.ignoresSafeArea())
        host.safeAreaRegions = []
        host.view.frame = CGRect(origin: .zero, size: tam)
        let v = UIWindow(frame: host.view.frame)
        v.rootViewController = host; v.isHidden = false; v.layoutIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        let img = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        return img
    }

    func testElFundidoNoDejaRaya() {
        let img = pinta()
        let cg = img.cgImage!
        let an = cg.width, al = cg.height
        var pix = [UInt8](repeating: 0, count: an * al * 4)
        let ctx = CGContext(data: &pix, width: an, height: al, bitsPerComponent: 8,
                            bytesPerRow: an * 4, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: an, height: al))

        // Una columna por la derecha, lejos del título y del número.
        let x = Int(Double(an) * 0.93)
        func brillo(_ y: Int) -> Double {
            let i = (y * an + x) * 4
            return 0.299 * Double(pix[i]) + 0.587 * Double(pix[i + 1]) + 0.114 * Double(pix[i + 2])
        }
        // Solo la franja donde el fundido muere: más abajo empieza el número,
        // y el filo de una cifra es un escalón legítimo de 150 niveles.
        let desde = Int(Double(al) * 0.35), hasta = Int(Double(al) * 0.71)
        var peor = 0.0, dondePeor = 0.0
        for y in (desde + 1)..<hasta {
            let d = abs(brillo(y) - brillo(y - 1))
            if d > peor { peor = d; dondePeor = Double(y) / Double(al) }
        }
        print("RAYA salto máximo \(String(format: "%.2f", peor)) niveles en \(String(format: "%.3f", dondePeor)) del alto")
        // Un escalón de más de 3 niveles de 255 en una sola fila es una raya.
        XCTAssertLessThan(peor, 3.0, "hay un escalón visible a \(dondePeor) del alto")
    }
}
