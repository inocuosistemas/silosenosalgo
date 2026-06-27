# SiLoSeNoSalgo · App de seguimiento (iOS)

App nativa SwiftUI que **solo transmite tu posición** en directo durante una
carrera, al **mismo backend** (Cloudflare) que la web. Inicia sesión con el
mismo usuario/contraseña, crea una sesión de seguimiento y envía tu posición al
intervalo que elijas, también con la app en **segundo plano**.

> Pensada para iOS primero; el backend y el protocolo son agnósticos de
> plataforma, así que el futuro espejo Android será otro cliente sin tocar el
> servidor.

## Estructura

- `project.yml` — definición del proyecto para [XcodeGen](https://github.com/yonaskolb/XcodeGen) (el `.xcodeproj` se genera, no se versiona).
- `Resources/Info.plist` — modos en segundo plano (`location`) y textos de permiso de ubicación.
- `Sources/`
  - `Config.swift` — URL del backend (`https://silosenosalgo.pages.dev`) y formato del enlace `?t=`.
  - `API.swift` — cliente HTTP + modelos. Login/registro con `X-Auth-Mode: token`; el resto con `Authorization: Bearer`.
  - `Keychain.swift` — guarda el token de sesión.
  - `AuthStore.swift` — estado de sesión (login/registro/logout, `/api/auth/me`).
  - `LocationManager.swift` — `CLLocationManager` con actualizaciones continuas en segundo plano.
  - `TrackingStore.swift` — crea la sesión y envía la posición al intervalo elegido.
  - `App.swift` / `ContentView.swift` / `LoginView.swift` / `TrackingView.swift` — UI.

## Primer arranque

Requisitos: macOS con Xcode y `xcodegen` (`brew install xcodegen`).

```sh
cd ios
xcodegen generate
open SiLoSeNoSalgoTracker.xcodeproj
```

En Xcode:
1. Target **SiLoSeNoSalgoTracker** → pestaña **Signing & Capabilities**.
2. Marca **Automatically manage signing** y selecciona tu **Personal Team**
   (tu Apple ID gratis). Cambia el **Bundle Identifier** si `app.silosenosalgo.tracker`
   ya está en uso en tu cuenta (p. ej. `org.iemed.silosenosalgo.tracker`).
3. Conecta el iPhone, selecciónalo como destino y pulsa **Run** (⌘R).
   - La primera vez: en el iPhone, **Ajustes → General → VPN y gestión de
     dispositivos** → confía en tu certificado de desarrollador.
   - Con Apple ID gratis la app **caduca a los ~7 días**; vuelve a ejecutar
     desde Xcode para reinstalarla.

> Para que el `DEVELOPMENT_TEAM` no se pierda al regenerar con XcodeGen, puedes
> fijarlo en `project.yml` (`settings.base.DEVELOPMENT_TEAM: <TU_TEAM_ID>`).

## Permisos de ubicación

Al pulsar **Compartir mi ubicación** la app pide permiso. Para transmitir con la
**pantalla bloqueada / app en segundo plano** concede **"Siempre"**
(Ajustes → SiLoSeNoSalgo → Ubicación → Siempre). Con "Mientras se usa" solo
transmite con la app en primer plano.

**Límite real de iOS:** si **cierras la app por completo** (la deslizas fuera del
multitarea), iOS detiene el GPS. Mantén la app abierta o en segundo plano; verás
el indicador de ubicación activo. El visor web muestra el "visto por última vez"
para que los seguidores noten cualquier corte.

## Probar de punta a punta

1. Levanta el backend (ver `../wrangler.toml` para provisionar D1) o usa producción.
2. En la app: crea cuenta o inicia sesión → **Compartir mi ubicación**.
3. Copia el enlace `?t=<token>` (botón **Compartir enlace**).
4. Mientras llega el visor web, comprueba la posición consultando la API:
   `GET https://silosenosalgo.pages.dev/api/track/<token>` → JSON con el último `fix`.
5. En el simulador puedes simular movimiento: **Features → Location → Freeway Drive**.
