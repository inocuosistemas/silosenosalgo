import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/**
 Un encuadre por formato: que cada hueco se lleve su trozo, y que el que no se
 toca mire a donde se estaba mirando.

 Viene de que la baldosa pequeña salía negra primero y mal recortada después:
 se encuadraba sobre el marco apaisado del mediano y ese mismo recorte se
 estiraba a un hueco CUADRADO, que recorta por los lados justo lo que uno
 acababa de elegir.
 */
@MainActor
final class EncuadrePorFormatoTests: XCTestCase {
    private let foto = CGSize(width: 1200, height: 600)

    /// Qué punto de la foto queda en el centro con un encuadre dado.
    private func centro(_ e: EncuadreFoto, _ f: FormatoFoto) -> CGPoint {
        let m = AjusteDeEncuadre.marcoPorDefecto(f.proporcion)
        let visto = RecortadorDeFoto.trozoVisible(
            foto: foto, marco: m, escala: CGFloat(e.escala),
            movida: CGSize(width: CGFloat(e.x) * m.width, height: CGFloat(e.y) * m.height))
        return CGPoint(x: visto.midX, y: visto.midY)
    }

    /// Lo que de verdad se pedía: encuadras en uno y el otro mira a lo mismo,
    /// aunque su hueco tenga otra forma.
    func testElFormatoSinTocarMiraAlMismoSitio() {
        // Movido a la izquierda y acercado al doble, sobre el marco apaisado.
        let enMediano = EncuadreFoto(escala: 2, x: 0.1, y: 0)
        let enPequeno = AjusteDeEncuadre.derivado(enMediano, de: .mediano, a: .pequeno, foto: foto)

        let a = centro(enMediano, .mediano)
        let b = centro(enPequeno, .pequeno)
        XCTAssertEqual(a.x, b.x, accuracy: 1, "el cuadrado tiene que quedar centrado en el mismo punto")
        XCTAssertEqual(a.y, b.y, accuracy: 1)
        XCTAssertEqual(enPequeno.escala, enMediano.escala, accuracy: 0.001, "y con el mismo zoom")
        // Y no es que salga lo mismo por casualidad: sin derivar, el cuadrado
        // se quedaría en el centro de la foto.
        XCTAssertNotEqual(b.x, foto.width / 2, accuracy: 1)
    }

    /// Y al revés, que la cuenta no valga solo en una dirección.
    func testDerivarVaYVuelve() {
        let ida = EncuadreFoto(escala: 2.5, x: -0.08, y: 0.05)
        let medio = AjusteDeEncuadre.derivado(ida, de: .pequeno, a: .grande, foto: foto)
        let vuelta = AjusteDeEncuadre.derivado(medio, de: .grande, a: .pequeno, foto: foto)
        let a = centro(ida, .pequeno), b = centro(vuelta, .pequeno)
        XCTAssertEqual(a.x, b.x, accuracy: 1)
        XCTAssertEqual(a.y, b.y, accuracy: 1)
    }

    /// El formato que SÍ se tocó se respeta: no se lo come el derivado.
    func testLoQueSeEncuadraAManoNoSePierde() {
        let ajuste = AjusteDeEncuadre(foto: foto, formato: .mediano, hechos: [:])
        ajuste.marco = AjusteDeEncuadre.marcoPorDefecto(FormatoFoto.mediano.proporcion)

        ajuste.cambiaA(.pequeno)
        ajuste.marco = AjusteDeEncuadre.marcoPorDefecto(FormatoFoto.pequeno.proporcion)
        ajuste.escala = 3
        ajuste.rel = CGSize(width: 0.2, height: 0)
        ajuste.cambiaA(.grande)

        let todos = ajuste.todos()
        XCTAssertEqual(todos[FormatoFoto.pequeno.rawValue]?.escala ?? 0, 3, accuracy: 0.001,
                       "al volver, el pequeño tiene que traer lo que se le hizo")
        XCTAssertEqual(todos.count, FormatoFoto.allCases.count, "y los tres tienen que salir")
    }

    /// Tres ficheros, y cada uno con la forma de su hueco.
    func testSeGuardaUnRecortePorFormato() throws {
        var c = Contador(id: "prueba-por-formato", nombre: "P", fecha: Date().addingTimeInterval(86_400))
        defer { FotosDeContador.borra(c) }

        let original = franjas()
        let ajuste = AjusteDeEncuadre(foto: original.size, formato: .mediano, hechos: [:])
        ajuste.marco = AjusteDeEncuadre.marcoPorDefecto(FormatoFoto.mediano.proporcion)
        ajuste.escala = 2
        let nombres = FotosDeContador.guardaEncuadres(original, ajuste.todos(), para: c)
        c.fotos = nombres
        c.foto = nombres[FormatoFoto.mediano.rawValue]

        XCTAssertEqual(Set(nombres.values).count, FormatoFoto.allCases.count,
                       "un fichero distinto por formato")
        for f in FormatoFoto.allCases {
            let img = try XCTUnwrap(FotosDeContador.imagen(de: c, f), "falta el recorte de \(f.rawValue)")
            let sale = img.size.width / img.size.height
            XCTAssertEqual(sale, f.proporcion, accuracy: f.proporcion * 0.03,
                           "el recorte de \(f.rawValue) tiene que tener la forma de su hueco")
        }
    }

    /// Lo de antes se sigue viendo: un contador guardado sin formatos enseña su
    /// foto de siempre en los tres, en vez de quedarse en blanco.
    func testLoGuardadoDeAntesSigueValiendo() {
        let c = Contador(id: "viejo", nombre: "V", fecha: Date(), foto: "viejo-123.jpg")
        for f in FormatoFoto.allCases {
            XCTAssertEqual(c.foto(f), "viejo-123.jpg")
        }
    }

    private func franjas() -> UIImage {
        let colores: [UIColor] = [.systemRed, .systemGreen, .systemBlue, .systemPurple]
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1
        return UIGraphicsImageRenderer(size: foto, format: fmt).image { ctx in
            for (i, col) in colores.enumerated() {
                col.setFill()
                ctx.fill(CGRect(x: CGFloat(i) * foto.width / 4, y: 0,
                                width: foto.width / 4, height: foto.height))
            }
        }
    }
}
