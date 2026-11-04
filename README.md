# Hitster Night · giftcards.group

Scorebord en spel voor Hitster-avonden. Iedereen kan een account maken en daarin meerdere spellen voorbereiden. Elk spel heeft een eigen code, dus meerdere spellen kunnen tegelijk draaien.

| Scherm | URL | Voor wie |
|---|---|---|
| Start | `/` | Spelers vullen de spelcode in |
| Spelers | `/join/CODE` | 1 telefoon per team (QR-code staat op het showscherm) |
| Show | `/show/CODE` | Groot scherm / beamer |
| Mijn spellen | `/host` | Inloggen of account maken, spellen aanmaken, dupliceren, verwijderen |
| Hostpaneel | `/host/<spel-id>` | Laptop van de host tijdens het spel |

## Online zetten (Railway)

1. Push deze code naar een GitHub-repo.
2. Ga naar [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → kies de repo.
3. Klik in het project op **+ Create** → **Database** → **PostgreSQL**.
4. Open de app-service → **Variables** en voeg toe:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (kies hem uit de lijst)
   - `SUPERADMIN_EMAIL` = jouw e-mailadres (dat account kan wachtwoorden van anderen resetten en alle spellen zien; meerdere adressen scheiden met een komma)
5. **Settings** → **Networking** → **Generate Domain**. Dat adres is de site.

Elke push naar GitHub zet automatisch een nieuwe versie online. De spelstatus staat in Postgres, dus een herstart halverwege de avond is geen probleem.

## Op de avond

- Laptop op **scherm uitbreiden** (niet dupliceren). Showscherm (`/show`) fullscreen (F11) op het grote scherm, admin (`/admin`) op de laptop.
- Log in de browser van de laptop in op **Spotify Premium** (open.spotify.com). Anders speelt de Spotify-speler maar 30 seconden.
- Geluid van de laptop naar de speakers.
- Maak vooraf een spel aan in `/host`, zet de nummers klaar en open op de avond het hostpaneel en het showscherm.
- Per ronde: **Load next song** → klik op play (in de Spotify-speler of op **Play & start timer**) → timer loopt → antwoorden → onthulling → artiest/titel goed- of afkeuren → **Done judging** → scorebord.

## Nummers toevoegen

Tab **Songs** in het hostpaneel. Plak Spotify-tracklinks (in de Spotify-desktopapp: playlist openen, Ctrl+A, Ctrl+C, plakken). Titel, artiest, hoes en jaartal worden opgezocht via Spotify en MusicBrainz. Controleer de jaartallen met ⚠: Spotify toont soms het jaar van een remaster. Zet ⭐ aan bij nummers voor de bonusronde.

## Lokaal draaien

```bash
npm install
npm run dev     # server op :3000, Vite op :5173
npm test        # spelregels testen
```

Zonder `DATABASE_URL` slaat de server alles op in `./data`.
