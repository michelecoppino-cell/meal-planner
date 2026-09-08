# 🥗 Cosa mangiamo?

Meal planner familiare: ricette stagionali, colazioni, piano settimanale, dispensa e lista della spesa condivisa. Single-file app (`index.html`) + Cloudflare Worker/KV per la sincronizzazione tra dispositivi.

## Struttura

- `index.html` — l'app (HTML + CSS + JS vanilla)
- `manifest.json`, `sw.js`, `icon.svg` — PWA: installabile sulla home e utilizzabile offline
- `worker/worker.js` — Worker Cloudflare: storage KV, `/add-item`, endpoint `/alexa`
- `ALEXA.md` — guida per aggiungere articoli alla spesa con la voce (Alexa, Siri)
- `HOME_ASSISTANT.md` — il ponte Home Assistant: quello che si detta alla lista della spesa *nativa* di Alexa finisce da solo nel planner
- `dist/` — output di build (copia dei file statici)

## Build & deploy

```bash
npm run build   # copia i file statici in dist/
```

Il Worker si aggiorna incollando `worker/worker.js` nell'editor su dash.cloudflare.com, oppure con `cd worker && npx wrangler deploy` (prima inserisci l'ID del namespace KV in `wrangler.toml` e imposta i segreti `AUTH_TOKEN` e `ALEXA_SKILL_ID`).

## Sicurezza / token di sincronizzazione

Il token **non è più nel codice sorgente**: si inserisce una volta per dispositivo in **Impostazioni → Sincronizzazione** (viene salvato solo in localStorage). Setup:

1. Sul Worker Cloudflare imposta un `AUTH_TOKEN` lungo e casuale (es. `openssl rand -hex 24`): dashboard → Worker → Settings → Variables, oppure `wrangler secret put AUTH_TOKEN`.
2. Apri l'app su ogni dispositivo → Impostazioni → inserisci lo stesso token → Salva.

Senza token l'app funziona comunque in locale (badge "Sync non attiva").

## Navigazione

Bottom nav con 5 sezioni: **Oggi** (colazione/pranzo/cena di oggi, promemoria 🌙 di preparare la colazione di domani, scadenze imminenti e stato della spesa, tutto in un colpo d'occhio), **Ricette** (toggle Cene/Colazioni), **Settimana**, **Dispensa**, **Spesa**, **Impostazioni** (icona ⚙️).

## Funzioni principali

- Piano settimanale per-settimana (frecce ← → navigano settimane indipendenti) con riempimento automatico stagionale che **evita ricette già usate nelle 2 settimane precedenti** e **dà priorità a chi consuma ingredienti in scadenza** in dispensa
- **Pranzo modificabile**: di default sono gli avanzi della cena precedente, ma si può sovrascrivere con una nota libera (tocca la riga "Pranzo") e tornare all'automatico con ↺
- **Porzioni scalate per singolo pasto pianificato** (½×/1×/2×, badge sulla riga cena/colazione): la lista della spesa e "✓ Usato" (scala dalla dispensa) tengono conto della scala scelta, non solo la vista di dettaglio
- Lista spesa generata da cene **e colazioni**, al netto della dispensa (sottrae le quantità quando note); **"↻ Rigenera" non perde più le voci aggiunte a mano né le spunte** — aggiorna solo le voci calcolate automaticamente
- **Scorte desiderate** (Impostazioni → lista ingredienti, colonna 📦): gli alimenti sotto la soglia desiderata finiscono in lista spesa con l'etichetta "scorta"; filtro "Con scorta impostata" e ricerca per trovarli al volo
- **Scadenze**: data di scadenza per alimento in Dispensa (📅), avviso evidenziato e pallino rosso sulla nav; giorni di preavviso configurabili
- Dispensa con categorie **riordinabili** (frecce ▲▼ in Impostazioni, per rispecchiare il percorso al supermercato), import da scontrino (via prompt per Claude), quantità +/-
- Ricerca ricette per nome o ingrediente, scala porzioni ½×/1×/2× nel dettaglio
- Condivisione lista via WhatsApp/altre app (Web Share)
- Dark mode automatica, aggiunta vocale via Alexa/Siri (vedi `ALEXA.md`) e, con Home Assistant a fare da ponte, anche dalla lista della spesa nativa di Alexa dettata in modo naturale (vedi `HOME_ASSISTANT.md`)
- **Sincronizzazione robusta**: se due dispositivi scrivono la stessa chiave quasi in contemporanea, il Worker rifiuta la scrittura più vecchia (409) invece di sovrascrivere in silenzio; il client ricarica il dato remoto (per la lista spesa fa un merge automatico) e avvisa con un messaggio. Refresh completo al ritorno in foreground e aggiornamento periodico della lista spesa mentre è aperta, per fare la spesa in due senza pestarsi i piedi
- Azioni distruttive (svuota dispensa, rimuovi comprati, disattiva sync, ripristina categorie, scala ingredienti "usato") mostrano un messaggio con **Annulla** invece di una finestra di conferma bloccante
