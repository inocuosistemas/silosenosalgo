import Foundation

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
            return Contador(
                id: previo?.id ?? "carrera-\(ev.id)",
                origen: .carrera,
                nombre: ev.name,
                fecha: fecha,
                conHora: true,
                color: previo?.aspectoPropio == true ? previo!.color : ColoresContador.hex(deSlug: ev.myColor),
                emoji: previo?.aspectoPropio == true ? previo!.emoji : ev.myEmoji,
                foto: previo?.foto,
                anual: false,
                // El día de la carrera el contador no desaparece: pasa a contar
                // el tiempo que llevas corriendo, que es lo que se quiere ver.
                alPasar: previo?.alPasar ?? .contarArriba,
                eventoId: ev.id,
                aspectoPropio: previo?.aspectoPropio ?? false
            )
        }

        let propios = antes.filter { $0.origen == .propio }
        AlmacenContadores.guarda(deCarrera + propios)
        RefrescoDeWidgets.pide()
    }

    /// Guarda los contadores propios (los de carrera se dejan como están).
    static func guardaPropios(_ propios: [Contador]) {
        let deCarrera = AlmacenContadores.lee().contadores.filter { $0.origen == .carrera }
        AlmacenContadores.guarda(deCarrera + propios)
        RefrescoDeWidgets.pide()
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
    }
}
