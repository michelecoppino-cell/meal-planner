# 🗣️ Aggiungere articoli alla spesa con Alexa

Guida per collegare un Echo alla lista della spesa di "Cosa mangiamo?".

Risultato finale:

> **"Alexa, chiedi a lista spesa di aggiungere il latte"**
> → *"Ho aggiunto latte alla lista della spesa."*
> → la voce compare nell'app (tab Spesa, categoria assegnata automaticamente).

> **"Alexa, chiedi a lista spesa cosa devo comprare"**
> → Alexa legge la lista.

Nota: non si può usare la lista della spesa *nativa* di Alexa perché Amazon ha
dismesso la List Management API per terze parti (luglio 2024). La skill custom
qui sotto è la strada supportata — e resta privata sul tuo account.

## Prerequisito: aggiornare il Worker

Il Worker in `worker/worker.js` include i nuovi endpoint `/add-item` e `/alexa`.

1. Vai su [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → `meal-planner-api` → **Edit code**.
2. Sostituisci il codice con il contenuto di `worker/worker.js` e fai **Deploy**.
3. Verifica che nelle impostazioni del Worker:
   - il binding KV si chiami **`KV`** (Settings → Bindings). Se il tuo si chiama diversamente, rinominalo o adatta il codice.
   - esista la variabile/segreto **`AUTH_TOKEN`** con lo stesso valore usato nell'app.

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
          "slots": [ { "name": "articolo", "type": "AMAZON.Food" } ],
          "samples": [
            "aggiungi {articolo}",
            "aggiungi {articolo} alla lista",
            "aggiungi {articolo} alla spesa",
            "aggiungi {articolo} alla lista della spesa",
            "metti {articolo} in lista",
            "metti {articolo} nella lista della spesa",
            "mi serve {articolo}",
            "dobbiamo comprare {articolo}",
            "di comprare {articolo}"
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

4. Menu **Endpoint**:
   - Service Endpoint Type: **HTTPS**
   - Default Region URI: `https://meal-planner-api.michelecoppino.workers.dev/alexa`
   - SSL certificate type: **"My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority"**
   - **Save**, poi di nuovo **Build skill**.
5. (Consigliato) Copia lo **Skill ID** (in alto, formato `amzn1.ask.skill.xxxx`) e impostalo sul Worker come segreto `ALEXA_SKILL_ID` (Settings → Variables, oppure `wrangler secret put ALEXA_SKILL_ID`). Così solo la tua skill può scrivere in lista.
6. Tab **Test**: attiva "Development" e prova scrivendo `chiedi a lista spesa di aggiungere il latte`.

Fatto. La skill in modalità **Development** funziona già su tutti gli Echo del tuo account, per sempre — non serve pubblicarla.

## Frasi utili

| Dici | Succede |
|---|---|
| "Alexa, chiedi a lista spesa di aggiungere il pane" | Aggiunge "pane" |
| "Alexa, apri lista spesa" → "aggiungi le uova" | Modalità dialogo |
| "Alexa, chiedi a lista spesa cosa devo comprare" | Legge la lista |

L'app ricarica la lista dal cloud ogni volta che apri il tab **Spesa** (e quando torni sull'app), quindi gli articoli aggiunti a voce compaiono da soli.

## Bonus: Siri e altro

L'endpoint `/add-item` è generico. Su iPhone puoi creare un Comando Rapido
(app Comandi → "Ottieni contenuto da URL" → POST all'URL sopra con header
`X-Auth` e corpo `{"name":"Testo dettato"}`) e dire *"Ehi Siri, aggiungi alla
spesa"*. Lo stesso vale per Tasker/Assistente su Android o qualsiasi automazione.
