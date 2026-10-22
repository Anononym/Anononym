# Level Up

Persönliches Tracking-Dashboard im Game-Stil: Avatar mit Level & XP, darunter deine IRL Stats.

## Was es trackt

- **Arbeit** – heute, diese Woche, diesen Monat (Session-Timer Start/Stop oder nachtragen)
- **Geld** – Umsatz diesen Monat
- **Training** – Anzahl diese Woche und diesen Monat

Jeder Stat hat einen Fortschrittsbalken zu deinem Ziel (unter „Profil & Ziele“ einstellbar).

## Game-Layer

- XP: 10 XP pro Arbeitsstunde, 50 XP pro Training, 1 XP pro 10 € Umsatz
- Level steigen progressiv (100, 300, 600, 1000 … XP), mit Level-up-Animation
- Ränge: Rookie → Grinder (Lvl 5) → Locked In (10) → Elite (20) → Legend (35)
- Streak: Tage in Folge mit Arbeit oder Training

## Lokal starten

```bash
npm install
cp .env.example .env
npm start            # -> http://localhost:3000
```

Du brauchst Node.js 22.9 oder neuer. Die Daten liegen in `data/` (`db.json` + dein Avatar).

## Online stellen (Railway, ca. 5 $/Monat)

1. [railway.com](https://railway.com) → „New Project“ → „Deploy from GitHub repo“ → dieses Repo wählen.
2. Unter **Variables** `APP_PASSWORD` setzen (Pflicht, sonst kann jeder deine Daten sehen).
3. **Volume** hinzufügen, Mount-Pfad `/data`, dann Variable `DATA_DIR=/data` setzen. Ohne Volume sind deine Daten nach jedem Deploy weg.
4. Unter **Settings → Networking** auf „Generate Domain“ klicken.
5. Auf dem Handy: Seite öffnen → Teilen → „Zum Home-Bildschirm“.

## Avatar

- Am besten ein **freigestelltes PNG** (transparenter Hintergrund, z. B. über remove.bg). Es steht dann auf dem leuchtenden Ring.
- Ein normales Foto füllt die Karte aus.
- Für echte Bewegung erzeugst du aus dem Foto ein kurzes Video (z. B. mit Kling, Runway oder Hedra) und lädst das MP4 hoch. Es läuft dann als Loop.
