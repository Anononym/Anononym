# Level Up

Persönliches Tracking-Dashboard im Game-Stil: Level-Leiste mit XP und Belohnungen, darunter deine IRL Stats.

## Was es trackt

- **Arbeit** – heute, diese Woche, diesen Monat (Session-Timer Start/Stop oder nachtragen, z. B. `2:30`)
- **Geld** – Umsatz diesen Monat
- **Training** – Anzahl diese Woche und diesen Monat
- **Schlaf** – letzte Nacht und Ø der letzten 7 Tage (Standardziel 9:30)

Jedes Ziel änderst du jederzeit: Ziel in der Stat-Kachel antippen oder unter „Profil & Ziele“.
Unter **Lifetime** findest du alle Einträge, die Summen seit Start und eine Übersicht pro Monat inklusive XP.

## Level & XP

- Ein **perfekter Tag** (alle Ziele erreicht) bringt **500 XP**: Arbeit 200, Training 100, Geld 100, Schlaf 100.
- Ein **Level** kostet **1.000 XP**, entspricht also 2 perfekten Tagen.
- Arbeit und Training zählen gegen dein Wochenziel, Geld gegen dein Monatsziel. So kostet dich ein freier Tag nichts, solange du das Wochen- oder Monatsziel schaffst.
  Bei 40 h/Woche gibt es 35 XP pro Stunde, bei 3 Trainings/Woche 233 XP pro Training.
- Schlaf zählt pro Nacht bis zum Ziel (max. 100 XP), ohne Bonus.
- **Ziel übertroffen:** Alles darüber bringt 50 % XP extra, bis zum Doppelten des Ziels.
- XP gehen auf den Tag, an dem du es gemacht hast. Jeder Eintrag zeigt seine XP. Wenn du Ziele änderst, wird alles neu berechnet.

## Belohnungen

Du legst fest, was du dir bei welchem Level gönnst. Die Level-Leiste zeigt die nächste Belohnung und wie viele perfekte Tage noch fehlen. Freigeschaltete Belohnungen markierst du als eingelöst.

## Lokal starten

```bash
npm install
cp .env.example .env
npm start            # -> http://localhost:3000
```

Du brauchst Node.js 22.9 oder neuer. Die Daten liegen in `data/` (`db.json`).

## Online stellen (Railway, ca. 5 $/Monat)

1. [railway.com](https://railway.com) → „New Project“ → „Deploy from GitHub repo“ → dieses Repo wählen.
2. Unter **Variables** `APP_PASSWORD` setzen (Pflicht, sonst kann jeder deine Daten sehen).
3. **Volume** hinzufügen, Mount-Pfad `/data`, dann Variable `DATA_DIR=/data` setzen. Ohne Volume sind deine Daten nach jedem Deploy weg.
4. **Eigene Domain:** In Railway unter Settings → Networking → „Custom Domain“ z. B. `stats.deinedomain.de` eintragen. Railway zeigt dir einen CNAME-Eintrag, den legst du bei deinem Domain-Anbieter in den DNS-Einstellungen an. Deine Hauptseite bleibt unverändert.
5. Auf dem Handy: Seite öffnen → Teilen → „Zum Home-Bildschirm“.
