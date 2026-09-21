import XCTest
import SwiftUI
@testable import SiLoSeNoSalgo

/// Qué trozo de la foto se lleva el widget al encuadrar.
final class EncuadreTests: XCTestCase {
    private let marco = CGSize(width: 320, height: 150)

    func testSinTocarNadaSaleElCentro() {
        // Una foto apaisada: cabe entera de ancho y se recorta arriba y abajo.
        let r = RecortadorDeFoto.trozoVisible(
            foto: CGSize(width: 2000, height: 1000), marco: marco, escala: 1, movida: .zero)
        XCTAssertEqual(r.minX, 0, accuracy: 0.5)
        XCTAssertEqual(r.width, 2000, accuracy: 0.5)
        XCTAssertEqual(r.midY, 500, accuracy: 0.5)
        XCTAssertLessThan(r.height, 1000)
    }

    func testUnaFotoVerticalSeRecortaPorLosLadosNoPorArriba() {
        let r = RecortadorDeFoto.trozoVisible(
            foto: CGSize(width: 1000, height: 2000), marco: marco, escala: 1, movida: .zero)
        XCTAssertEqual(r.width, 1000, accuracy: 0.5, "de ancho cabe entera")
        XCTAssertEqual(r.midY, 1000, accuracy: 0.5, "y centrada de alto")
    }

    func testArrastrarHaciaAbajoEnseniaLoDeArriba() {
        let foto = CGSize(width: 1000, height: 2000)
        let centrado = RecortadorDeFoto.trozoVisible(foto: foto, marco: marco, escala: 1, movida: .zero)
        let arrastrado = RecortadorDeFoto.trozoVisible(
            foto: foto, marco: marco, escala: 1, movida: CGSize(width: 0, height: 60))
        XCTAssertLessThan(arrastrado.midY, centrado.midY)
    }

    func testAcercarSeQuedaConMenosFoto() {
        let foto = CGSize(width: 2000, height: 1000)
        let lejos = RecortadorDeFoto.trozoVisible(foto: foto, marco: marco, escala: 1, movida: .zero)
        let cerca = RecortadorDeFoto.trozoVisible(foto: foto, marco: marco, escala: 2, movida: .zero)
        XCTAssertEqual(cerca.width, lejos.width / 2, accuracy: 1)
        XCTAssertEqual(cerca.height, lejos.height / 2, accuracy: 1)
    }

    func testElTrozoNuncaSeSaleDeLaFoto() {
        let foto = CGSize(width: 1200, height: 800)
        let r = RecortadorDeFoto.trozoVisible(
            foto: foto, marco: marco, escala: 1, movida: CGSize(width: 9999, height: -9999))
        XCTAssertTrue(CGRect(origin: .zero, size: foto).contains(r) || r.isEmpty)
    }
}
