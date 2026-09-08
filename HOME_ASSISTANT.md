# 🏠 Il ponte Home Assistant: dalla lista di Alexa al planner

Guida per far finire nella lista della spesa di "Cosa mangiamo?" anche gli
articoli dettati ad Alexa **in modo naturale**, senza nominare la skill.

Risultato finale:

> **"Alexa, aggiungi il latte alla lista della spesa"**
> → *"Ok, ho aggiunto latte alla tua lista della spesa"* (risposta standard di Alexa)
> → entro pochi minuti "latte" compare nell'app, tab **Spesa**, con il badge "Alexa".

## Perché serve un ponte

La skill custom di `ALEXA.md` funziona, ma va invocata per nome ("Alexa,
**chiedi a lista spesa di** aggiungere il latte"). La frase corta, quella che
viene spontanea, finisce nella lista della spesa **nativa** di Amazon — e da lì
una skill di terze parti non la può prendere: Amazon ha dismesso la List
Management API a luglio 2024.

Home Assistant però la lista nativa la vede: l'integrazione **Alexa Devices**
(così come il custom component `alexa_media_player`) espone le liste
dell'account come entità `todo.*`. Da lì si passa.

L'idea: **la lista nativa di Alexa diventa una casella di posta in arrivo**, il
planner resta la lista vera. Home Assistant legge la casella, la svuota nel
planner e la ripulisce.

```
voce ──▶ lista nativa Alexa ──▶ Home Assistant ──▶ Worker ──▶ app
         (todo.*_shopping_list)    automazione     POST /add-item   tab Spesa
```

La skill custom **resta**: serve ancora per la dispensa ("Alexa, chiedi a lista
spesa di togliere 2 uova dalla dispensa"), che dalla lista nativa non passa.

## 1. Il Worker

L'endpoint `/add-item` accetta anche `source`: con valore `"alexa"` l'app mostra
il badge "Alexa" accanto alla voce.

```bash
curl -X POST https://meal-planner-api.michelecoppino.workers.dev/add-item \
  -H "Content-Type: application/json" -H "X-Auth: IL_TUO_TOKEN" \
  -d '{"name":"latte","amount":0,"unit":"","source":"alexa"}'
```

Se hai aggiornato `worker/worker.js` da questo repository, ricordati di
**rideployare** il Worker (`cd worker && npx wrangler deploy`, oppure
copia-incolla dall'editor su dash.cloudflare.com): non è automatico.

Sul doppio invio non c'è da preoccuparsi: `addShoppingItem` deduplica per nome
normalizzato sulle voci non spuntate, quindi lo stesso articolo mandato due
volte non crea due righe.

## 2. Home Assistant: i segreti

In `secrets.yaml` (che non va in git) servono due righe:

```yaml
planner_add_item_url: https://meal-planner-api.michelecoppino.workers.dev/add-item
planner_auth_token: <lo stesso AUTH_TOKEN del Worker e dell'app>
```

## 3. Home Assistant: il comando REST

In `configuration.yaml`:

```yaml
rest_command:
  planner_aggiungi_spesa:
    url: !secret planner_add_item_url
    method: post
    content_type: "application/json"
    headers:
      X-Auth: !secret planner_auth_token
    payload: '{"name": {{ nome | to_json }}, "amount": {{ quantita | default(0) | int(0) }}, "source": "alexa"}'
    timeout: 15
```

## 4. Home Assistant: l'automazione

Un file per argomento in `automations/` (qui `automations/spesa.yaml`).
Sostituisci `todo.michelecoppino_hotmail_it_shopping_list` con l'entità della
**tua** lista della spesa Alexa (Strumenti per sviluppatori → Stati, filtra per
`todo.`).

```yaml
- id: '1785090000040'
  alias: Spesa - dalla lista Alexa al planner
  triggers:
  - trigger: time_pattern
    minutes: /3
  - trigger: homeassistant
    event: start
  conditions: []
  actions:
  - action: todo.get_items
    target:
      entity_id: todo.michelecoppino_hotmail_it_shopping_list
    data:
      status: needs_action
    response_variable: inbox
  - variables:
      voci: >-
        {{ (inbox.values() | list | first).get('items', []) if inbox else [] }}
  - repeat:
      for_each: "{{ voci }}"
      sequence:
      - variables:
          testo: "{{ repeat.item.summary | trim }}"
          primo: "{{ testo.split(' ') | first if ' ' in testo else '' }}"
          quantita: "{{ primo | int(0) if primo is match('^[0-9]{1,3}$') else 0 }}"
          nome: "{{ testo.split(' ', 1)[1] | trim if quantita | int(0) > 0 else testo }}"
          esito: null
      - action: rest_command.planner_aggiungi_spesa
        data:
          nome: "{{ nome }}"
          quantita: "{{ quantita | int(0) }}"
        response_variable: esito
        continue_on_error: true
      - if:
        - condition: template
          value_template: >-
            {{ esito is mapping and esito.status is defined
               and esito.status | int(0) >= 200 and esito.status | int(0) < 300 }}
        then:
        - action: todo.remove_item
          target:
            entity_id: todo.michelecoppino_hotmail_it_shopping_list
          data:
            item: "{{ repeat.item.summary }}"
  mode: single
  max_exceeded: silent
```

Le tre cose da non cambiare distrattamente:

- **A tempo, non sul cambio di stato**: l'integrazione interroga Amazon per
  conto suo, quindi un trigger di stato non arriverebbe prima — scatterebbe
  soltanto più spesso e a vuoto.
- **Prima si aggiunge, poi si toglie**: `todo.remove_item` parte solo se la POST
  ha risposto 2xx. Se il Worker non risponde la voce resta in Alexa e si riprova
  al giro dopo. Il caso peggiore è un articolo mandato due volte (che il Worker
  deduplica), mai uno perso.
- **`esito` azzerato a ogni voce**: `continue_on_error` tiene in piedi il giro
  sulle altre voci quando la chiamata fallisce, ma senza l'azzeramento
  resterebbe la risposta riuscita del giro precedente — e si toglierebbe da
  Alexa un articolo mai arrivato nel planner.

Se la voce comincia con un numero ("2 pomodori") il numero diventa `amount` e il
resto il nome; altrimenti passa il nome intero.

## 5. Prova

1. Il `curl` del punto 1: l'app (tab Spesa) mostra la voce con badge "Alexa".
2. Ricarica la configurazione di Home Assistant (Strumenti per sviluppatori →
   YAML → "Tutto", oppure riavvia), metti un articolo di prova nella lista
   Alexa ed esegui l'automazione a mano.
3. L'articolo deve (a) comparire nel planner e (b) sparire dalla lista Alexa.
4. Poi il giro completo a voce da un Echo, aspettando i tre minuti.

Se l'articolo arriva nel planner ma non sparisce da Alexa, la lista non accetta
la cancellazione da Home Assistant: al posto di `todo.remove_item` usa
`todo.update_item` con `status: completed`, che spunta la voce invece di
toglierla (la lettura filtra `needs_action`, quindi non ripassa comunque).

## Frasi utili

| Dici | Dove finisce |
|---|---|
| "Alexa, aggiungi il latte alla lista della spesa" | Lista nativa → planner entro ~3 minuti (badge "Alexa") |
| "Alexa, aggiungi 2 pomodori alla lista della spesa" | Come sopra, con quantità 2 |
| "Alexa, chiedi a lista spesa di aggiungere il pane" | Planner subito, via skill custom (`ALEXA.md`) |
| "Alexa, chiedi a lista spesa di togliere 2 uova dalla dispensa" | Dispensa: solo via skill custom |
