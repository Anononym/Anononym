# 🦇 Batcomputer

Dein persönliches Batman-Dashboard. Alfred begrüßt dich mit Stimme, zeigt dich animiert in Gotham
und trackt Arbeitszeit, Umsatz und Training.

## Funktionen

- **Begrüßung und Lagebericht** – „Guten Abend, Master Bruce.“ Danach liest Alfred deine Zahlen vor (ElevenLabs-Stimme, sonst Browser-Stimme).
- **Du im Bild** – du lädst ein Foto oder MP4 hoch. Es steht im Regen vor der Skyline, mit Bat-Signal, Blitzen und Parallax-Effekt.
- **Stats** – gearbeitet heute, diese Woche und diesen Monat, Umsatz im Monat, Trainings pro Woche und Monat.
- **Einsatz-Timer** – mit Start/Stopp misst du deine Arbeitszeit. Vergessene Zeiten trägst du nach.
- **Alfred-KI** – Chat oder Spracheingabe per Mikrofon. Alfred kennt deine Zahlen und antwortet mit Stimme (Claude).
- **Passwortschutz** – bevor die Seite online geht, setzt du ein Passwort.

## Lokal starten

```bash
npm install
cp .env.example .env     # Keys eintragen (alles optional)
npm start                # -> http://localhost:3000
```

Du brauchst Node.js 22.9 oder neuer. Die Daten liegen in `data/` (`db.json` + dein Foto).

## Schlüssel

| Variable | Wofür | Woher |
|---|---|---|
| `ELEVENLABS_API_KEY` | Stimme | elevenlabs.io → Profil → API Keys |
| `ELEVENLABS_VOICE_ID` | Welche Stimme | ElevenLabs Voice Library → Stimme → „ID kopieren“ |
| `ANTHROPIC_API_KEY` | Alfred denkt mit | console.anthropic.com → API Keys |
| `APP_PASSWORD` | Schutz online | selbst ausdenken |
| `HERO_NAME` | Wie Alfred dich nennt | z. B. `Bruce` |

## Online stellen (Railway)

1. Code auf GitHub (ist schon da).
2. Auf [railway.com](https://railway.com) → „New Project“ → „Deploy from GitHub repo“ → dieses Repo wählen.
3. Unter **Variables** die Werte aus `.env.example` eintragen, **`APP_PASSWORD` unbedingt setzen**.
4. **Volume** hinzufügen, Mount-Pfad `/data`, dann Variable `DATA_DIR=/data` setzen. Ohne Volume sind deine Daten nach jedem Deploy weg.
5. Unter **Settings → Networking** auf „Generate Domain“ klicken. Fertig.
6. Auf dem Handy: Seite öffnen → Teilen → „Zum Home-Bildschirm“.

## Echte Animation deines Fotos

Die Seite animiert dein Foto selbst (atmen, Licht, Regen, Parallax). Wenn du dich wirklich bewegen willst:
Erzeug aus deinem Foto ein 5–10-sekündiges Video in einem Image-to-Video-Tool (z. B. Kling, Runway oder Hedra).
Prompt-Idee: *„man standing still on a rooftop at night, cape moving in wind, rain, subtle breathing, cinematic, loopable“*.
Das MP4 lädst du unter Einstellungen hoch, danach läuft es als Loop.

Am besten wirkt ein Foto **mit transparentem Hintergrund (PNG)**, z. B. freigestellt mit remove.bg.
