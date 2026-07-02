// Cloudflare Worker per "Cosa mangiamo?"
//
// Endpoint:
//   GET  /get?key=...     → legge un valore dal KV            (richiede header X-Auth)
//   POST /set             → {key, value} scrive nel KV        (richiede header X-Auth)
//   POST /add-item        → {name, amount?, unit?} appende    (richiede header X-Auth)
//                           una voce alla lista della spesa
//   POST /alexa           → endpoint per la skill Alexa custom (verifica lo skill ID,
//                           vedi ALEXA.md nella root del repo)
//
// Configurazione (vedi wrangler.toml):
//   - binding KV:            namespace Workers KV
//   - secret AUTH_TOKEN:     wrangler secret put AUTH_TOKEN
//   - secret ALEXA_SKILL_ID: wrangler secret put ALEXA_SKILL_ID (opzionale ma consigliato)

const SHOPPING_KEY = "cm:s:v1";

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
      const value = await env.KV.get(key);
      return json({ value });
    }

    if (url.pathname === "/set" && request.method === "POST") {
      const { key, value } = await request.json();
      if (!key) return json({ error: "missing key" }, 400);
      await env.KV.put(key, value);
      return json({ ok: true });
    }

    if (url.pathname === "/add-item" && request.method === "POST") {
      const { name, amount, unit } = await request.json();
      if (!name || !String(name).trim()) return json({ error: "missing name" }, 400);
      const item = await addShoppingItem(env, name, amount, unit);
      return json({ ok: true, item });
    }

    return json({ error: "not found" }, 404);
  },
};

async function addShoppingItem(env, name, amount = 0, unit = "") {
  const clean = String(name).trim();
  const raw = await env.KV.get(SHOPPING_KEY);
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];

  const existing = list.find(
    (i) => i.name && i.name.toLowerCase() === clean.toLowerCase() && !i.checked
  );
  if (existing) return existing;

  const item = {
    id: Math.random().toString(36).slice(2, 9),
    name: clean,
    amount: Number(amount) || 0,
    unit: String(unit || ""),
    checked: false,
    manual: true,
    category: "varie", // l'app ricategorizza le voci manuali al caricamento
  };
  list.push(item);
  await env.KV.put(SHOPPING_KEY, JSON.stringify(list));
  return item;
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
    return alexaSpeak("Ciao! Cosa devo aggiungere alla lista della spesa?", false);
  }

  if (type === "SessionEndedRequest") {
    return json({ version: "1.0", response: {} });
  }

  if (type === "IntentRequest") {
    const intent = body.request.intent || {};

    if (intent.name === "AggiungiIntent") {
      const articolo = intent.slots?.articolo?.value;
      if (!articolo) return alexaSpeak("Cosa devo aggiungere alla lista?", false);
      await addShoppingItem(env, articolo);
      return alexaSpeak(`Ho aggiunto ${articolo} alla lista della spesa.`, true);
    }

    if (intent.name === "ListaIntent") {
      const raw = await env.KV.get(SHOPPING_KEY);
      let list = [];
      try { list = raw ? JSON.parse(raw) : []; } catch {}
      const todo = (Array.isArray(list) ? list : []).filter((i) => !i.checked).map((i) => i.name);
      if (!todo.length) return alexaSpeak("La lista della spesa è vuota.", true);
      const first = todo.slice(0, 15);
      const extra = todo.length > 15 ? `, e altri ${todo.length - 15} articoli` : "";
      return alexaSpeak(`In lista ci sono: ${first.join(", ")}${extra}.`, true);
    }

    if (intent.name === "AMAZON.HelpIntent") {
      return alexaSpeak("Puoi dire: aggiungi il latte, oppure: leggi la lista.", false);
    }

    if (intent.name === "AMAZON.StopIntent" || intent.name === "AMAZON.CancelIntent") {
      return alexaSpeak("A presto!", true);
    }
  }

  return alexaSpeak("Non ho capito. Puoi dire: aggiungi il latte, oppure: leggi la lista.", false);
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
