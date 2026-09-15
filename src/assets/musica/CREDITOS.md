# Música del vídeo del replay

Cinco cortes de 30 s de piezas de **Kevin MacLeod (incompetech.com)**, con
licencia **Creative Commons Attribution 4.0**
(https://creativecommons.org/licenses/by/4.0/). La licencia pide el crédito a
la vista: el vídeo lo lleva escrito en los últimos segundos, y el panel donde
se elige la música también.

| Fichero | Pieza | Desde (s) |
|---|---|---|
| `epica.m4a` | Heroic Age | 54.073 |
| `rock.m4a` | Exhilarate | 0.727 |
| `electronica.m4a` | Shiny Tech | 7.375 |
| `motivadora.m4a` | Motivator | 0.020 |
| `batucada.m4a` | Lagoa v2 | 63.236 |

Cómo se sacaron: el MP3 original de incompetech, cortado en un golpe fuerte
cercano al "desde", 30 s justos, normalizado a −16 LUFS, entrada de 30 ms y
salida de 3 s (lo que dura el cierre del vídeo), en AAC-LC 128 kbps estéreo a
44,1 kHz. El vídeo copia estos paquetes AAC tal cual, sin recodificar.

```sh
ffmpeg -ss <desde> -t 30 -i "<pieza>.mp3" -vn -map_metadata -1 \
  -af loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.03,afade=t=out:st=27:d=3 \
  -ar 44100 -ac 2 -c:a aac -b:a 128k -movflags +faststart <id>.m4a
```
