// Cloudflare Worker per "Cosa mangiamo?"
//
// Endpoint:
//   GET  /get?key=...     → legge un valore dal KV, con "version" (richiede header X-Auth)
//                           (timestamp dell'ultima scrittura, dai metadata KV)
//   POST /set             → {key, value, expectedVersion?} scrive nel KV (richiede header X-Auth)
//                           se expectedVersion è indicata e non combacia con quella corrente,
//                           risponde 409 con il valore/versione attuali invece di sovrascrivere
//                           alla cieca (evita che due dispositivi si cancellino le modifiche a vicenda)
//   POST /add-item        → {name, amount?, unit?, source?} appende (richiede header X-Auth)
//                           una voce alla lista della spesa
//   POST /alexa           → endpoint per la skill Alexa custom (verifica lo skill ID,
//                           vedi ALEXA.md nella root del repo). Gestisce:
//                             - AggiungiIntent      → aggiunge alla lista della spesa
//                             - TogliDispensaIntent  → toglie/scala dalla dispensa
//                             - ListaIntent          → legge la lista della spesa
//
// Configurazione (vedi wrangler.toml):
//   - binding KV:            namespace Workers KV
//   - secret AUTH_TOKEN:     wrangler secret put AUTH_TOKEN
//   - secret ALEXA_SKILL_ID: wrangler secret put ALEXA_SKILL_ID (opzionale ma consigliato)

const SHOPPING_KEY = "cm:s:v1";
const PANTRY_KEY = "cm:p:v1";

// Parole italiane da ignorare nel confronto tra nomi prodotto, così
// "farina di ceci" (dettato ad Alexa) combacia con "farina ceci" (nome
// salvato nell'app). Non è un match semantico: toglie solo articoli e
// preposizioni, non tocca le parole "di contenuto" (es. non confonde
// "aceto di mele" con "aceto di vino").
const STOPWORDS = new Set([
  "di", "d", "del", "dello", "della", "dei", "degli", "delle",
  "il", "lo", "la", "i", "gli", "le", "un", "uno", "una",
]);

function normalizeName(name) {
  const cleaned = String(name)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // rimuove accenti
    .toLowerCase()
    .replace(/'/g, " ") // "d'avena" → "d avena" (il "d" viene poi tolto come stopword)
    .replace(/[^a-z0-9\s]/g, " ");
  return cleaned
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ")
    .trim();
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    // La skill Alexa non può inviare header custom: autenticata tramite skill ID
    if (url.pathname === "/alexa" && request.method === "POST") {
      return handleAlexa(request, env);
    }

    if (request.headers.get("X-Auth") !== env.AUTH_TOKEN) {
      return json({ error: "unauthorized" }, 401);
    }

    if (url.pathname === "/get" && request.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "missing key" }, 400);
      const { value, metadata } = await env.KV.getWithMetadata(key);
      return json({ value, version: metadata && typeof metadata.t === "number" ? metadata.t : null });
    }

    // "expectedVersion" abilita la scrittura ottimistica: se un altro dispositivo ha scritto nel
    // frattempo (versione diversa da quella letta l'ultima volta), rifiuta con 409 e restituisce il
    // valore corrente invece di sovrascriverlo alla cieca. Omesso (client mai sincronizzato su
    // questa chiave) la scrittura procede sempre, per restare compatibile con client più vecchi.
    if (url.pathname === "/set" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
      const { key, value, expectedVersion } = body;
      if (!key) return json({ error: "missing key" }, 400);
      if (typeof expectedVersion === "number") {
        const current = await env.KV.getWithMetadata(key);
        const currentVersion = current.metadata && typeof current.metadata.t === "number" ? current.metadata.t : null;
        if (currentVersion !== expectedVersion) {
          return json({ error: "conflict", value: current.value, version: currentVersion }, 409);
        }
      }
      const version = Date.now();
      await env.KV.put(key, value, { metadata: { t: version } });
      return json({ ok: true, version });
    }

    if (url.pathname === "/add-item" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
      const { name, amount, unit, source } = body;
      if (!name || !String(name).trim()) return json({ error: "missing name" }, 400);
      // "source" e' l'origine della voce ("alexa" per il ponte Home Assistant,
      // vedi HOME_ASSISTANT.md): l'app la mostra come badge accanto all'articolo.
      const item = await addShoppingItem(env, name, amount, unit, String(source || "").trim());
      return json({ ok: true, item });
    }

    return json({ error: "not found" }, 404);
  },
};

async function addShoppingItem(env, name, amount = 0, unit = "", source = "") {
  const clean = String(name).trim();
  const raw = await env.KV.get(SHOPPING_KEY);
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];

  const target = normalizeName(clean);
  const qty = Number(amount) || 0;
  const existing = list.find(
    (i) => i.name && normalizeName(i.name) === target && !i.checked
  );
  if (existing) {
    if (qty) {
      existing.amount = (Number(existing.amount) || 0) + qty;
      await env.KV.put(SHOPPING_KEY, JSON.stringify(list), { metadata: { t: Date.now() } });
    }
    return existing;
  }

  const item = {
    id: Math.random().toString(36).slice(2, 9),
    name: clean,
    amount: qty,
    unit: String(unit || ""),
    checked: false,
    manual: true,
    category: "varie", // l'app ricategorizza le voci manuali al caricamento
  };
  if (source) item.source = source;
  list.push(item);
  await env.KV.put(SHOPPING_KEY, JSON.stringify(list), { metadata: { t: Date.now() } });
  return item;
}

async function getPantry(env) {
  const raw = await env.KV.get(PANTRY_KEY);
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  return Array.isArray(list) ? list : [];
}

// Toglie un articolo dalla dispensa. Se è indicata una quantità e
// l'articolo ne tiene traccia, scala solo quella quantità (senza andare
// sotto zero); altrimenti (o se la quantità arriva a zero) lo rimuove del tutto.
async function removePantryItem(env, name, qty) {
  const target = normalizeName(name);
  const list = await getPantry(env);
  const idx = list.findIndex((p) => p.name && normalizeName(p.name) === target);
  if (idx === -1) return { found: false };

  const item = list[idx];
  if (qty && item.qty != null) {
    const remaining = Math.max(0, Math.round((item.qty - qty) * 100) / 100);
    if (remaining > 0) {
      item.qty = remaining;
      await env.KV.put(PANTRY_KEY, JSON.stringify(list), { metadata: { t: Date.now() } });
      return { found: true, removed: false, item, remaining };
    }
  }

  list.splice(idx, 1);
  await env.KV.put(PANTRY_KEY, JSON.stringify(list), { metadata: { t: Date.now() } });
  return { found: true, removed: true, item };
}

// ── Alexa custom skill ─────────────────────────────────────────────
// Skill personale in modalità sviluppo: si valida l'applicationId.
// (Per una skill pubblicata Amazon richiede anche la verifica della
// firma SignatureCertChainUrl — non necessaria per uso personale.)

async function handleAlexa(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }

  const appId =
    body?.session?.application?.applicationId ||
    body?.context?.System?.application?.applicationId;
  if (env.ALEXA_SKILL_ID && appId !== env.ALEXA_SKILL_ID) {
    return json({ error: "forbidden" }, 403);
  }

  const type = body?.request?.type;

  if (type === "LaunchRequest") {
    return alexaSpeak("Ciao! Cosa devo aggiungere al planner, o togliere dalla dispensa?", false);
  }

  if (type === "SessionEndedRequest") {
    return json({ version: "1.0", response: {} });
  }

  if (type === "IntentRequest") {
    const intent = body.request.intent || {};

    if (intent.name === "AggiungiIntent") {
      const articolo = intent.slots?.articolo?.value;
      const quantitaRaw = intent.slots?.quantita?.value;
      const quantita = quantitaRaw ? Number(quantitaRaw) : 0;
      if (!articolo) return alexaSpeak("Cosa devo aggiungere al planner?", false);
      try {
        await addShoppingItem(env, articolo, quantita, "", "alexa");
      } catch (err) {
        return alexaSpeak(`Non sono riuscito ad aggiungere ${articolo} al planner. Riprova tra poco.`, true);
      }
      const qtyText = quantita ? `${quantita} ` : "";
      return alexaSpeak(`Aggiunto ${qtyText}${articolo} al planner.`, true);
    }

    if (intent.name === "TogliDispensaIntent") {
      const articolo = intent.slots?.articolo?.value;
      const quantitaRaw = intent.slots?.quantita?.value;
      const quantita = quantitaRaw ? Number(quantitaRaw) : null;
      if (!articolo) return alexaSpeak("Cosa devo togliere dalla dispensa del planner?", false);

      let result;
      try {
        result = await removePantryItem(env, articolo, quantita);
      } catch (err) {
        return alexaSpeak(`Non sono riuscito a togliere ${articolo} dalla dispensa del planner. Riprova tra poco.`, true);
      }
      if (!result.found) {
        return alexaSpeak(`Non ho trovato ${articolo} nella dispensa del planner.`, true);
      }
      if (result.removed) {
        return alexaSpeak(`Tolto ${articolo} dalla dispensa del planner.`, true);
      }
      const unit = result.item.unit ? ` ${result.item.unit}` : "";
      return alexaSpeak(`Fatto. Nella dispensa del planner restano ${result.remaining}${unit} di ${articolo}.`, true);
    }

    if (intent.name === "ListaIntent") {
      let list = [];
      try {
        const raw = await env.KV.get(SHOPPING_KEY);
        list = raw ? JSON.parse(raw) : [];
      } catch (err) {
        return alexaSpeak("Non riesco a leggere la lista del planner in questo momento. Riprova tra poco.", true);
      }
      const todo = (Array.isArray(list) ? list : []).filter((i) => !i.checked).map((i) => i.name);
      if (!todo.length) return alexaSpeak("La lista della spesa del planner è vuota.", true);
      const first = todo.slice(0, 15);
      const extra = todo.length > 15 ? `, e altri ${todo.length - 15} articoli` : "";
      return alexaSpeak(`Nel planner ci sono: ${first.join(", ")}${extra}.`, true);
    }

    if (intent.name === "AMAZON.HelpIntent") {
      return alexaSpeak("Puoi dire: aggiungi il latte al planner, togli le uova dalla dispensa, oppure: leggi la lista.", false);
    }

    if (intent.name === "AMAZON.StopIntent" || intent.name === "AMAZON.CancelIntent") {
      return alexaSpeak("A presto!", true);
    }
  }

  return alexaSpeak("Non ho capito. Puoi dire: aggiungi il latte alla lista, oppure: togli le uova dalla dispensa.", false);
}

function alexaSpeak(text, endSession) {
  return json({
    version: "1.0",
    response: {
      outputSpeech: { type: "PlainText", text },
      shouldEndSession: endSession,
    },
  });
}
