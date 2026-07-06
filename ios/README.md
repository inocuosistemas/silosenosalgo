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
  - `TrackingStore.swift` — crea la sesión, envía la posición y **retiene la traza completa** en disco para el visor offline.
  - `App.swift` / `ContentView.swift` / `LoginView.swift` / `TrackingView.swift` — UI.
  - **Visor offline** (ver sección más abajo): `ViewerDataProvider.swift`, `AppWebSchemeHandler.swift`, `TileCache.swift`, `PlanGeometry.swift`, `WebView.swift`, `LiveMapView.swift`, `MapDownloadView.swift`.
- `WebDist/` — visor web construido (copiado de `../dist` por `scripts/copy-webdist.sh`; git-ignored).

## Primer arranque

Requisitos: macOS con Xcode y `xcodegen` (`brew install xcodegen`). Target mínimo **iOS 16.4**.

```sh
# 1) construir el visor web y empaquetarlo en la app (ver "Visor offline")
npm run build                 # en la raíz del repo
ios/scripts/copy-webdist.sh   # copia dist/ → ios/WebDist/

# 2) generar y abrir el proyecto
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

## Visor offline (mapa incrustado)

Mientras transmites, **"Ver mi ruta en el mapa (offline)"** abre dentro de la app
el **mismo visor "live"** que ven los seguidores, pero servido **localmente**, así
que funciona **sin cobertura** (el problema que motivó esto: no poder ver tu propia
previsión de paso ni tu posición en zona sin red).

Cómo funciona (sin reescribir el visor):

- El SPA construido se empaqueta en `WebDist/` y se sirve bajo un esquema propio
  `appweb://` mediante `AppWebSchemeHandler` (un `WKURLSchemeHandler` no puede
  interceptar https, por eso el esquema propio).
- Las peticiones del visor se resuelven en local:
  - `/api/track/<token>` → `ViewerDataProvider` sintetiza el estado con la **traza
    completa** que `TrackingStore` graba y persiste (`Application Support/trails/`).
  - `/api/share/<id>` → bytes gzip del plan cacheados (`Application Support/plans/`,
    descargados una vez de `GET /api/plans/:id`).
  - `/_tile/z/x/y.png` → `TileCache` (disco → red si hay conexión → placeholder).
- `LiveViewer.tsx` detecta `?embedded=1` y enruta los tiles a `/_tile/...` para que
  pasen por la caché. El resto (plan de paso, cortes, perfil, colores) ya se calcula
  en cliente. El tiempo/radar (Open-Meteo) degradan con gracia sin conexión.

**Mapa offline:** desde el visor, el botón de descarga abre `MapDownloadView`, que
pre-descarga un **corredor de tiles** alrededor de la ruta (ancho y zoom máx.
elegibles, con estimación de tamaño) y además cachea de forma incremental lo que
veas con conexión. Respeta la política de tiles de OSM (User-Agent descriptivo,
≤2 conexiones, throttle, tope). La URL de tiles es intercambiable en `Config.swift`.

**Tras cualquier cambio en `src/`** hay que reconstruir y re-empaquetar el bundle:
`npm run build && ios/scripts/copy-webdist.sh` (y `xcodegen generate` si cambió
`project.yml`). Si no, la app embarca un visor obsoleto.

### Verificar offline

1. Inicia sesión, selecciona una **previsión** y **Compartir**. Simula movimiento
   (**Features → Location → Freeway Drive**) y observa que la traza crece.
2. Abre **"Ver mi ruta (offline)"**: ruta punteada + posición + traza coloreada
   sobre tiles OSM (online).
3. Pulsa descargar y baja el corredor (empieza con zoom bajo). Comprueba el tamaño
   de caché.
4. Fuerza sin red (**Network Link Conditioner** al 100% de pérdida, o dispositivo
   en modo avión) y reabre: el mapa sigue con tiles de disco, el overlay del plan y
   la posición/traza locales, y **no** salta "Sin conexión".
5. **Vaciar caché de mapas** → el tamaño baja a 0; offline aparecen placeholders.
