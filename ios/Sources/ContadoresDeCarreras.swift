import Foundation
import UIKit

/**
 Los contadores de MIS CARRERAS, para el widget.

 La app es la única que habla con el servidor: el widget es otro proceso, con
 su presupuesto de ejecución, y hacerle pedir la lista de carreras sería la
 forma más segura de que la cuenta atrás se quedara en blanco justo el día que
 importa. Así que cada vez que la app refresca sus carreras deja aquí lo poco
 que el widget necesita.

 Lo que MANDA el servidor: el nombre y la salida. Si el organizador mueve la
 hora, el contador se mueve con ella. Lo que es de uno: el aspecto (color,
 emoji, cartel), que solo se respeta si se ha tocado a mano —si no, se coge el
 de su marca en el evento, que es como le van a ver en el mapa—.
 */
enum ContadoresDeCarreras {
    /// Rehace los contadores de carrera y conserva los propios.
    static func sincroniza(_ eventos: [EventSummary]) {
        let antes = AlmacenContadores.lee().contadores
        let porEvento = Dictionary(
            antes.compactMap { c in c.eventoId.map { ($0, c) } },
            uniquingKeysWith: { a, _ in a }
        )

        // Solo las que todavía tienen salida por delante (o son de hoy): una
        // carrera terminada no es una cuenta atrás, y el histórico ya está en
        // "Mis carreras".
        let deCarrera: [Contador] = eventos.compactMap { ev in
            guard !ev.isOver, let inicio = ev.startsAt else { return nil }
            let fecha = Date(timeIntervalSince1970: inicio / 1000)
            let previo = porEvento[ev.id]
            // El cartel de fondo, de entrada, si la carrera lo tiene: es lo que
            // hace que el widget se reconozca de un vistazo. Quien haya elegido
            // otra cosa (su foto, o ninguna) se queda con lo suyo.
            let conCartel = previo?.usaCartel ?? (ev.hasPhoto == true)
            let cartel = conCartel ? CartelesDeContadores.nombre(de: ev) : nil
            return Contador(
                id: previo?.id ?? "carrera-\(ev.id)",
                origen: .carrera,
                nombre: ev.name,
                fecha: fecha,
                conHora: true,
                color: previo?.aspectoPropio == true ? previo!.color : ColoresContador.hex(deSlug: ev.myColor),
                color2: previo?.aspectoPropio == true ? previo!.color2 : nil,
                emoji: previo?.aspectoPropio == true ? previo!.emoji : ev.myEmoji,
                // Con cartel, su fichero (si ya está copiado; si no, se copia
                // ahora mismo, más abajo, y se vuelve a guardar).
                foto: conCartel ? (cartel.flatMap { CartelesDeContadores.existe($0) ? $0 : nil }) : previo?.foto,
                anual: false,
                // El día de la carrera el contador no desaparece: pasa a contar
                // el tiempo que llevas corriendo, que es lo que se quiere ver.
                alPasar: previo?.alPasar ?? .contarArriba,
                aviso: previo?.aviso ?? false,
                estilo: previo?.estilo ?? .completo,
                usaCartel: conCartel,
                eventoId: ev.id,
                aspectoPropio: previo?.aspectoPropio ?? false
            )
        }

        let propios = antes.filter { $0.origen == .propio }
        AlmacenContadores.guarda(deCarrera + propios)
        RefrescoDeWidgets.pide()
        AvisosDeContadores.reprograma()

        // Los carteles que falten en el cajón compartido (el primero, o uno que
        // la organización ha cambiado) se copian ahora, sin hacer esperar a
        // nadie, y el contador se guarda otra vez con su foto.
        let pendientes = eventos.filter { ev in
            deCarrera.contains { $0.eventoId == ev.id && $0.usaCartel && $0.foto == nil }
        }
        guard !pendientes.isEmpty else { return }
        Task {
            for ev in pendientes { _ = await CartelesDeContadores.copia(ev) }
            var todos = AlmacenContadores.lee().contadores
            for i in todos.indices where todos[i].usaCartel {
                guard let ev = pendientes.first(where: { $0.id == todos[i].eventoId }) else { continue }
                let nombre = CartelesDeContadores.nombre(de: ev)
                if CartelesDeContadores.existe(nombre) { todos[i].foto = nombre }
            }
            AlmacenContadores.guarda(todos)
            RefrescoDeWidgets.pide()
        }
    }

    /// Guarda los contadores propios (los de carrera se dejan como están).
    static func guardaPropios(_ propios: [Contador]) {
        let deCarrera = AlmacenContadores.lee().contadores.filter { $0.origen == .carrera }
        AlmacenContadores.guarda(deCarrera + propios)
        RefrescoDeWidgets.pide()
        AvisosDeContadores.reprograma()
    }

    /// Cambia el aspecto de un contador de carrera (color, emoji, cartel).
    static func guardaAspecto(_ contador: Contador) {
        var todos = AlmacenContadores.lee().contadores
        guard let i = todos.firstIndex(where: { $0.id == contador.id }) else { return }
        var c = contador
        c.aspectoPropio = true
        todos[i] = c
        AlmacenContadores.guarda(todos)
        RefrescoDeWidgets.pide()
        AvisosDeContadores.reprograma()
    }
}

/**
 El cartel de una carrera, copiado al cajón compartido para el widget.

 El cartel ya lo guarda la app (`FotosDeCarrera`), pero en SU carpeta, que el
 widget no puede leer, y a tamaño completo, que al widget le sobra: tiene muy
 poca memoria y una imagen grande lo tumba. Aquí va reducido, con la versión en
 el nombre para que un cartel nuevo sustituya al viejo.
 */
enum CartelesDeContadores {
    static func nombre(de ev: EventSummary) -> String {
        "cartel-\(ev.id)-\(Int64(ev.photoAt ?? 0)).jpg"
    }

    static func existe(_ nombre: String) -> Bool {
        FileManager.default.fileExists(atPath: AlmacenContadores.fotos.appendingPathComponent(nombre).path)
    }

    /// Baja (o lee de la caché) el cartel, lo reduce y lo deja en el cajón
    /// compartido. Devuelve el nombre del fichero, o nil si la carrera no tiene.
    @discardableResult
    static func copia(_ ev: EventSummary) async -> String? {
        guard let img = await FotosDeCarrera.carga(ev) else { return nil }
        let lado: CGFloat = 800
        let escala = min(1, lado / max(img.size.width, img.size.height))
        let tamano = CGSize(width: img.size.width * escala, height: img.size.height * escala)
        let formato = UIGraphicsImageRendererFormat.default()
        formato.scale = 1
        let pequena = UIGraphicsImageRenderer(size: tamano, format: formato).image { _ in
            img.draw(in: CGRect(origin: .zero, size: tamano))
        }
        guard let jpeg = pequena.jpegData(compressionQuality: 0.8) else { return nil }
        let destino = nombre(de: ev)
        // Fuera los carteles anteriores de esta carrera.
        let carpeta = AlmacenContadores.fotos
        let viejos = (try? FileManager.default.contentsOfDirectory(at: carpeta, includingPropertiesForKeys: nil)) ?? []
        for v in viejos where v.lastPathComponent.hasPrefix("cartel-\(ev.id)-") && v.lastPathComponent != destino {
            try? FileManager.default.removeItem(at: v)
        }
        try? jpeg.write(to: carpeta.appendingPathComponent(destino), options: .atomic)
        return destino
    }
}
