# 🥗 Cosa mangiamo?

Meal planner familiare: ricette stagionali, colazioni, piano settimanale, dispensa e lista della spesa condivisa. Single-file app (`index.html`) + Cloudflare Worker/KV per la sincronizzazione tra dispositivi.

## Struttura

- `index.html` — l'app (HTML + CSS + JS vanilla)
- `manifest.json`, `sw.js`, `icon.svg` — PWA: installabile sulla home e utilizzabile offline
- `worker/worker.js` — Worker Cloudflare: storage KV, `/add-item`, endpoint `/alexa`
- `ALEXA.md` — guida per aggiungere articoli alla spesa con la voce (Alexa, Siri)
- `dist/` — output di build (copia dei file statici)

## Build & deploy

```bash
npm run build   # copia i file statici in dist/
```

Il Worker si aggiorna incollando `worker/worker.js` nell'editor su dash.cloudflare.com, oppure con `cd worker && npx wrangler deploy` (prima inserisci l'ID del namespace KV in `wrangler.toml` e imposta i segreti `AUTH_TOKEN` e `ALEXA_SKILL_ID`).

## Funzioni principali

- Piano settimanale per-settimana (frecce ← → navigano settimane indipendenti) con riempimento automatico stagionale
- Lista spesa generata da cene **e colazioni**, al netto della dispensa (sottrae le quantità quando note)
- Dispensa con categorie, import da scontrino (via prompt per Claude), quantità +/-
- Ricerca ricette per nome o ingrediente, scala porzioni ½×/1×/2×
- Condivisione lista via WhatsApp/altre app (Web Share)
- Dark mode automatica, aggiunta vocale via Alexa/Siri (vedi `ALEXA.md`)
