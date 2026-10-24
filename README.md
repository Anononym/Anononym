# Level Up

Persönliches Tracking-Dashboard im Game-Stil: Avatar mit Level & XP, darunter deine IRL Stats.

## Was es trackt

- **Arbeit** – heute, diese Woche, diesen Monat (Session-Timer Start/Stop oder nachtragen, z. B. `2:30`)
- **Geld** – Umsatz diesen Monat
- **Training** – Anzahl diese Woche und diesen Monat
- **Schlaf** – letzte Nacht und Ø der letzten 7 Tage (Standardziel 9:30)

Jedes Ziel änderst du jederzeit: Ziel in der Stat-Kachel antippen oder unter „Profil & Ziele“.
Unter **Lifetime** findest du alle Einträge, die Summen seit Start und eine Übersicht pro Monat.

## Dein Charakter

Ein animierter Charakter (oberkörperfrei, Jeans, auf einer leuchtenden Plattform) zeigt, wie es läuft:

- **Form** (Muskeln): wie nah du in den letzten 7 Tagen (Arbeit, Training, Schlaf) und 30 Tagen (Umsatz) an deinen Zielen warst. Wenn du sie überschreitest, wirst du breiter, bekommst ein Sixpack und eine Aura.
- **Energie** (Gesichtsausdruck, Haltung): Schlaf letzte Nacht plus Arbeit der letzten 3 Tage. Bei wenig Energie wirkt er müde: Augenringe, hängende Lider, blasse Haut, hängende Schultern, „Zzz“.

Das Fenster ist rollierend, damit der Charakter nicht jeden Montag wieder schrumpft.

## Game-Layer

- XP: 10 XP pro Arbeitsstunde, 50 XP pro Training, 1 XP pro 10 € Umsatz, 20 XP pro Nacht mit erreichtem Schlafziel
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
4. **Eigene Domain:** In Railway unter Settings → Networking → „Custom Domain“ z. B. `stats.deinedomain.de` eintragen. Railway zeigt dir einen CNAME-Eintrag, den legst du bei deinem Domain-Anbieter in den DNS-Einstellungen an. Deine Hauptseite bleibt unverändert.
5. Auf dem Handy: Seite öffnen → Teilen → „Zum Home-Bildschirm“.
