# Avisos por Telegram

Estado: **circuito montado y desplegado, inactivo hasta configurar dos secretos.**
Mientras falten, `notifyTelegram()` no hace nada y todo lo demás funciona igual.

## Por qué NO se reutiliza el sistema de `avisapelis`

`avisapelis` usa un **userbot de Telethon**: una sesión de usuario real, con un
proceso Python vivo y un fichero `userbot.session`. Eso no se puede reutilizar
aquí, y no por falta de ganas:

- una Pages Function es efímera: no mantiene procesos ni ficheros de sesión;
- Telethon habla MTProto, no HTTP, y no corre sobre el runtime de Workers.

Tampoco hace falta. El userbot existe allí porque tiene que **leer** de canales
ajenos donde no se puede meter un bot. Aquí solo hay que **escribir** en un canal
propio, y eso es una llamada HTTPS a la API de bots, que sí funciona desde
Cloudflare.

## Lo que falta (solo lo puede hacer una persona)

1. Crear un bot hablando con [@BotFather](https://t.me/BotFather) en Telegram:
   `/newbot`, elegir nombre, y guardar el token que devuelve.
2. Decidir el destino:
   - **Chat propio** (lo más rápido para probar): escribirle algo al bot y sacar
     el `chat_id` de `https://api.telegram.org/bot<TOKEN>/getUpdates`.
   - **El canal de avisapelis**: añadir el bot al canal como administrador y usar
     el id del canal (el negativo, `-100…`).
3. Guardar los dos secretos en Cloudflare:

```sh
npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name=silosenosalgo
npx wrangler pages secret put TELEGRAM_CHAT_ID  --project-name=silosenosalgo
```

Con eso, cada ánimo nuevo dispara un mensaje. No hace falta tocar código ni
volver a desplegar: los secretos se leen en cada petición.

## Comprobar que funciona

```sh
curl -s "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d chat_id=<CHAT_ID> -d text="prueba"
```

Si eso llega, el aviso de la aplicación también llegará: usa exactamente la
misma llamada.

## Pendiente para más adelante

Hoy el destino es **uno global** para toda la aplicación, que es justo lo que se
quería para montar el circuito. Lo natural después es que cada usuario configure
el suyo en su perfil: haría falta una columna en `users` (o una tabla de
preferencias de aviso) y leer el destino del dueño de la ruta en vez de la
variable de entorno. El punto de cambio es `notifyTelegram()`; el resto no se
entera.

También queda por decidir qué más avisar (empezar o terminar una baliza, un
corte apurado…) y si conviene agrupar: con muchos ánimos seguidos, un mensaje
por cada uno puede ser demasiado.
