# Brief: ponte Home Assistant → lista della spesa del planner

Da incollare (o da far leggere) in una sessione Claude Code che abbia collegate
**entrambe** le repository: questa (`meal-planner`) e quella della configurazione
di Home Assistant.

---

## Obiettivo

Fare in modo che gli articoli dettati ad Alexa **in modo naturale** ("Alexa,
aggiungi il latte alla lista della spesa") finiscano automaticamente nella lista
della spesa dell'app "Cosa mangiamo?", senza dover usare l'invocation name della
skill custom.

Idea di fondo: **la lista nativa di Alexa diventa una inbox**, il planner resta
la lista vera. Home Assistant fa il ponte, legge la inbox, la svuota.

## Perché così

La List Management API di Amazon per le skill di terze parti è stata dismessa
(luglio 2024): una skill custom non può leggere né scrivere la Shopping List
nativa. L'integrazione `alexa_media_player` di Home Assistant però espone le
liste Alexa come entità `todo.*` (usa le API interne dell'app Alexa). Quella è
la via d'accesso.

## Stato attuale (già fatto, da non rifare)

- Repo `meal-planner`, Cloudflare Worker in `worker/worker.js`:
  - `POST /add-item` con header `X-Auth: <AUTH_TOKEN>` e body
    `{"name":"latte","amount":0,"unit":"","source":"alexa"}` aggiunge una voce
    alla lista della spesa. Il campo `source` è già supportato: con valore
    `"alexa"` l'app mostra il badge "Alexa" accanto alla voce.
  - `addShoppingItem` **deduplica** per nome normalizzato (ignora articoli e
    preposizioni: "farina di ceci" == "farina ceci") sulle voci non spuntate.
    Quindi un doppio invio dello stesso articolo non crea due righe.
  - **Verifica prima di modificare**: se in `worker/worker.js` il ramo
    `/add-item` non legge già `source` dal body, aggiungilo; se lo legge già,
    non toccare nulla.
- La skill Alexa custom (`/alexa`, vedi `ALEXA.md`) **resta e non va toccata**:
  serve ancora per la dispensa ("togli 2 uova dalla dispensa"), che dalla lista
  nativa non passa.

## Cosa devi implementare (repo Home Assistant)

Prima di scrivere: ispeziona la configurazione esistente e **adàttati alle sue
convenzioni** (packages/, `automations.yaml` gestito da UI, split di
`configuration.yaml`, naming delle entità, ecc.). Non imporre una struttura tua.

1. **`rest_command`** — es. `planner_aggiungi_spesa`:
   - `url`: endpoint `/add-item` del Worker
   - `method`: POST, `content_type: application/json`
   - header `X-Auth` con il token
   - payload con `name` (template dal chiamante) e `source: alexa`
   - **URL e token vanno in `secrets.yaml`**, mai in chiaro nei file versionati.
2. **Automazione** che, periodicamente, svuota la inbox:
   - trigger: `time_pattern` ogni 2–5 minuti (preferibile allo state trigger:
     `alexa_media_player` fa polling proprio, quindi lo state trigger non è più
     reattivo ma è più rumoroso). Valuta di aggiungere anche un trigger su
     `homeassistant.start`.
   - `mode: single` con `max_exceeded: silent`.
   - azione: `todo.get_items` sull'entità della lista Alexa con
     `status: needs_action` → `response_variable` → `repeat.for_each` sugli item.
3. **Per ogni item, in quest'ordine** (è il punto critico):
   - chiama `rest_command.planner_aggiungi_spesa` con `response_variable`;
   - **solo se la risposta ha status 2xx**, chiama `todo.remove_item` per
     togliere l'item dalla lista Alexa;
   - se la chiamata fallisce, **lascia l'item nella lista Alexa** e riprova al
     giro dopo. Non usare `continue_on_error` in modo che mascheri l'errore
     saltando la verifica.
   - Se al giro successivo l'articolo viene reinviato perché la `remove` è
     fallita, il Worker lo deduplica: nessun doppione. La rimozione serve a
     tenere la inbox pulita, non a garantire la correttezza.
4. **Quantità**: se il nome dell'item contiene un numero iniziale ("2 pomodori"),
   puoi provare a estrarlo e passarlo come `amount`. È un nice-to-have: se la
   cosa si complica, passa il nome intero e basta — non vale la pena introdurre
   parsing fragile.

## Dati che ti servono dall'utente (chiedili, non inventarli)

- `entity_id` esatto della lista della spesa Alexa in HA (qualcosa come
  `todo.<nome_account>_shopping_list`). Se hai accesso agli strumenti HA,
  ricavalo dalle entità `todo.*` esistenti e fallo confermare.
- Conferma che `AUTH_TOKEN` e URL del Worker siano già in `secrets.yaml` o
  vadano aggiunti (in quel caso lascia i placeholder e dillo, **non chiedere il
  token in chat e non scriverlo nei file**).

## Verifica

1. `curl` di prova su `/add-item` con `source: alexa` → l'app (tab Spesa) mostra
   la voce con badge "Alexa".
2. Ricarica la config di HA, esegui l'automazione a mano da Strumenti per
   sviluppatori con un articolo di prova nella lista Alexa.
3. Controlla che l'articolo (a) compaia nel planner e (b) sparisca dalla lista
   Alexa.
4. Prova il percorso completo a voce da un Echo.

## Documentazione

Aggiungi in questa repo un `HOME_ASSISTANT.md` (stile di `ALEXA.md`: italiano,
passo-passo, con lo YAML finale) che descriva il ponte, e linkalo dal `README.md`
e dalla nota in `ALEXA.md` che oggi dice che la lista nativa non è accessibile —
va corretta: non lo è *dalle skill*, ma lo è via Home Assistant.

## Regole operative

- Lavora su un branch dedicato in **entrambe** le repo, commit separati per repo,
  messaggi in italiano. Non pushare su `main`, non aprire PR se non richiesto.
- Nessun segreto nei commit.
- Il Worker, se modificato, va rideployato su Cloudflare (`cd worker && npx
  wrangler deploy`, oppure copia-incolla dalla dashboard): ricordalo nel
  riepilogo finale, non è automatico.
