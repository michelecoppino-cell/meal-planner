# 🗣️ Aggiungere/togliere articoli con Alexa

Guida per collegare un Echo alla lista della spesa e alla dispensa di "Cosa mangiamo?".

Risultato finale:

> **"Alexa, chiedi a lista spesa di aggiungere il latte"**
> → *"Ho aggiunto latte alla lista della spesa."*
> → la voce compare nell'app (tab Spesa, categoria assegnata automaticamente).

> **"Alexa, chiedi a lista spesa di togliere 2 uova dalla dispensa"**
> → *"Fatto. In dispensa restano 4 di uova."*
> → **"Alexa, chiedi a lista spesa di togliere il latte dalla dispensa"** (senza quantità) → toglie la voce del tutto.

> **"Alexa, chiedi a lista spesa cosa devo comprare"**
> → Alexa legge la lista.

Nota sul riconoscimento nomi: Alexa passa al Worker il testo capito dal
riconoscimento vocale così com'è. Se dici "farina di ceci" ma nell'app il
prodotto si chiama "farina ceci", il Worker le tratta come la stessa voce
(ignora articoli/preposizioni come "di/del/della" nel confronto — vedi
`normalizeName` in `worker/worker.js`), ma non è un match "intelligente":
sinonimi veri e propri (es. "pomodoro" vs "pomodori") restano voci distinte.

Nota su imperativo/infinito: in italiano, dopo *"Alexa, chiedi a X **di**..."*
il verbo va all'infinito ("aggiungere", "togliere"), mentre dopo *"Alexa,
apri X" → "aggiungi..."* (modalità dialogo) va all'imperativo. Il modello
qui sotto include entrambe le forme per ogni intent — se in futuro aggiungi
nuove frasi di esempio, ricordati di duplicarle in entrambi i modi, altrimenti
Alexa può "ingoiare" l'intera frase (invocation name compreso) dentro allo slot
invece di riconoscere solo l'articolo.

Nota sull'invocation name: scegline uno facile da pronunciare **in italiano**
(evita parole inglesi tipo "meal planner"): un nome non italiano rende meno
affidabile il riconoscimento del punto in cui l'invocation name finisce e
inizia la frase, aumentando il rischio del problema sopra.

Nota: non si può usare la lista della spesa *nativa* di Alexa perché Amazon ha
dismesso la List Management API per terze parti (luglio 2024). La skill custom
qui sotto è la strada supportata — e resta privata sul tuo account.

## Prerequisito: aggiornare il Worker

Il Worker in `worker/worker.js` include i nuovi endpoint `/add-item` e `/alexa`.

1. Vai su [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → `meal-planner-api` → **Edit code**.
2. Sostituisci il codice con il contenuto di `worker/worker.js` e fai **Deploy**.
3. Verifica che nelle impostazioni del Worker:
   - il binding KV si chiami **`KV`** (Settings → Bindings). Se il tuo si chiama diversamente, rinominalo o adatta il codice.
   - esista la variabile/segreto **`AUTH_TOKEN`** con lo stesso valore che inserisci nell'app (Impostazioni → Sincronizzazione). Approfittane per sceglierne uno lungo e casuale, es. `openssl rand -hex 24`.

In alternativa, da terminale: `cd worker && npx wrangler deploy` (dopo aver messo l'ID del namespace KV in `wrangler.toml`).

Test rapido da terminale:

```bash
curl -X POST https://meal-planner-api.michelecoppino.workers.dev/add-item \
  -H "Content-Type: application/json" -H "X-Auth: IL_TUO_TOKEN" \
  -d '{"name":"latte"}'
```

Apri l'app → tab Spesa: "latte" deve comparire.

## Creare la skill Alexa (una tantum, ~15 minuti)

1. Vai su [developer.amazon.com/alexa/console/ask](https://developer.amazon.com/alexa/console/ask) e accedi **con lo stesso account Amazon dei tuoi dispositivi Echo**.
2. **Create Skill**:
   - Nome: `Lista spesa` (o come preferisci)
   - Primary locale: **Italian (IT)**
   - Type of experience: **Other** → Model: **Custom**
   - Hosting: **Provision your own**
   - Template: **Start from scratch**
3. Nel menu a sinistra, apri **Interaction Model → JSON Editor**, incolla il JSON qui sotto e premi **Save** poi **Build skill**:

```json
{
  "interactionModel": {
    "languageModel": {
      "invocationName": "lista spesa",
      "intents": [
        { "name": "AMAZON.CancelIntent", "samples": [] },
        { "name": "AMAZON.HelpIntent", "samples": [] },
        { "name": "AMAZON.StopIntent", "samples": [] },
        { "name": "AMAZON.NavigateHomeIntent", "samples": [] },
        {
          "name": "AggiungiIntent",
          "slots": [
            { "name": "articolo", "type": "AMAZON.Food" },
            { "name": "quantita", "type": "AMAZON.NUMBER" }
          ],
          "samples": [
            "aggiungi {articolo}",
            "aggiungi {articolo} alla lista",
            "aggiungi {articolo} alla spesa",
            "aggiungi {articolo} alla lista della spesa",
            "aggiungi {quantita} {articolo}",
            "aggiungi {quantita} {articolo} alla lista della spesa",
            "di aggiungere {articolo}",
            "di aggiungere {articolo} alla lista",
            "di aggiungere {articolo} alla spesa",
            "di aggiungere {articolo} alla lista della spesa",
            "di aggiungere {quantita} {articolo}",
            "di aggiungere {quantita} {articolo} alla lista della spesa",
            "metti {articolo} in lista",
            "metti {articolo} nella lista della spesa",
            "di mettere {articolo} in lista",
            "di mettere {articolo} nella lista della spesa",
            "mi serve {articolo}",
            "di dire che mi serve {articolo}",
            "dobbiamo comprare {articolo}",
            "di comprare {articolo}",
            "di dire che dobbiamo comprare {articolo}"
          ]
        },
        {
          "name": "TogliDispensaIntent",
          "slots": [
            { "name": "articolo", "type": "AMAZON.Food" },
            { "name": "quantita", "type": "AMAZON.NUMBER" }
          ],
          "samples": [
            "togli {articolo} dalla dispensa",
            "togli {quantita} {articolo} dalla dispensa",
            "di togliere {articolo} dalla dispensa",
            "di togliere {quantita} {articolo} dalla dispensa",
            "rimuovi {articolo} dalla dispensa",
            "rimuovi {quantita} {articolo} dalla dispensa",
            "di rimuovere {articolo} dalla dispensa",
            "di rimuovere {quantita} {articolo} dalla dispensa",
            "abbiamo finito {articolo}",
            "di dire che abbiamo finito {articolo}",
            "ho finito {articolo}",
            "di dire che ho finito {articolo}",
            "segna {articolo} come consumato",
            "di segnare {articolo} come consumato",
            "consuma {articolo}",
            "consuma {quantita} {articolo}",
            "di consumare {articolo}",
            "di consumare {quantita} {articolo}",
            "scala {quantita} {articolo} dalla dispensa",
            "di scalare {quantita} {articolo} dalla dispensa"
          ]
        },
        {
          "name": "ListaIntent",
          "samples": [
            "leggi la lista",
            "leggimi la lista",
            "cosa c'è in lista",
            "cosa devo comprare",
            "cosa dobbiamo comprare",
            "leggimi la spesa"
          ]
        }
      ]
    }
  }
}
```

Lo slot `articolo` usa il tipo integrato `AMAZON.Food`: copre già un vocabolario
alimentare ampio e capisce piccole variazioni ("farina di ceci", "farina
ceci", ecc. vengono comunque passate come testo libero). La normalizzazione
vera e propria (che accomuna "farina di ceci" e "farina ceci") avviene lato
Worker, non nello slot — vedi nota più sopra.

4. Menu **Endpoint**:
   - Service Endpoint Type: **HTTPS**
   - Default Region URI: `https://meal-planner-api.michelecoppino.workers.dev/alexa`
   - SSL certificate type: **"My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority"**
   - **Save**, poi di nuovo **Build skill**.
5. (Consigliato) Copia lo **Skill ID** (in alto, formato `amzn1.ask.skill.xxxx`) e impostalo sul Worker come segreto `ALEXA_SKILL_ID` (Settings → Variables, oppure `wrangler secret put ALEXA_SKILL_ID`). Così solo la tua skill può scrivere in lista.
6. Tab **Test**: attiva "Development" e prova scrivendo `chiedi a lista spesa di aggiungere il latte`, poi `chiedi a lista spesa di togliere il latte dalla dispensa`.

Fatto. La skill in modalità **Development** funziona già su tutti gli Echo del tuo account, per sempre — non serve pubblicarla.

## Frasi utili

| Dici | Succede |
|---|---|
| "Alexa, chiedi a lista spesa di aggiungere il pane" | Aggiunge "pane" alla lista della spesa |
| "Alexa, chiedi a lista spesa di aggiungere 2 pomodori" | Aggiunge "pomodori" con quantità 2 |
| "Alexa, apri lista spesa" → "aggiungi le uova" | Modalità dialogo |
| "Alexa, chiedi a lista spesa cosa devo comprare" | Legge la lista |
| "Alexa, chiedi a lista spesa di togliere il latte dalla dispensa" | Rimuove "latte" dalla dispensa |
| "Alexa, chiedi a lista spesa di togliere 2 uova dalla dispensa" | Scala la quantità di "uova" di 2 (se non tracciata a quantità, la rimuove) |

Se dici solo "aggiungi il pane" (senza numero), la quantità resta 0 — l'app
mostra comunque la voce in lista, semplicemente senza quantità indicata.

L'app ricarica la lista dal cloud ogni volta che apri il tab **Spesa** (e quando torni sull'app), quindi gli articoli aggiunti a voce compaiono da soli.

## Bonus: Siri e altro

L'endpoint `/add-item` è generico. Su iPhone puoi creare un Comando Rapido
(app Comandi → "Ottieni contenuto da URL" → POST all'URL sopra con header
`X-Auth` e corpo `{"name":"Testo dettato"}`) e dire *"Ehi Siri, aggiungi alla
spesa"*. Lo stesso vale per Tasker/Assistente su Android o qualsiasi automazione.
